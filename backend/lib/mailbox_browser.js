import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { evaluateEmailInterceptorDecision } from "../ai_agents/Interceptor.js";
import { collectEmailSenderAddresses } from "../ai_agents/Interceptor.js";
import { withImapRetries } from "./imap_operation_lock.js";
import {
  listMailboxIndexMessages,
  updateMailboxMessage,
  upsertMailboxMessages,
} from "./mailbox_index.js";

const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const watcherStateFile = process.env.EMAIL_WATCHER_STATE_FILE || join(runtimeDir, "email-watcher-state.json");
const legacyWatcherCutoff = new Date("2026-07-16T22:01:00.000Z");

function boolValue(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on", "si"].includes(normalized);
}

function intValue(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function batchItems(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function parseList(value) {
  return String(value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function deriveImapHost({ imapHost, smtpHost }) {
  if (imapHost) return imapHost;
  const host = String(smtpHost || "").trim();
  if (!host) return "";
  if (/^smtp\./i.test(host)) return host.replace(/^smtp\./i, "imap.");
  if (/gmail\.com$/i.test(host)) return "imap.gmail.com";
  return host;
}

function isLegacyMailboxMessage(date) {
  const parsedDate = date instanceof Date ? date : date ? new Date(date) : null;
  return Boolean(
    parsedDate &&
      Number.isFinite(parsedDate.getTime()) &&
      parsedDate.getTime() < legacyWatcherCutoff.getTime()
  );
}

async function readWatcherState() {
  await mkdir(runtimeDir, { recursive: true });
  if (!existsSync(watcherStateFile)) {
    await writeFile(watcherStateFile, JSON.stringify({ processed: [] }, null, 2), "utf8");
  }
  const raw = await readFile(watcherStateFile, "utf8");
  const parsed = raw.trim() ? JSON.parse(raw) : {};
  return {
    processed: Array.isArray(parsed.processed) ? parsed.processed : [],
  };
}

function resolveMailboxSettings(rawSettings) {
  const smtpHost = process.env.SMTP_HOST || rawSettings.smtp_host || "";
  const smtpUser = process.env.SMTP_USER || rawSettings.smtp_user || "";
  const smtpPassword = process.env.SMTP_PASSWORD || rawSettings.smtp_password || "";
  const imapHost = process.env.EMAIL_WATCHER_IMAP_HOST || rawSettings.email_watcher_imap_host || "";
  return {
    host: deriveImapHost({ imapHost, smtpHost }),
    port: intValue(process.env.EMAIL_WATCHER_IMAP_PORT || rawSettings.email_watcher_imap_port, 993),
    secure: boolValue(process.env.EMAIL_WATCHER_IMAP_SECURE || rawSettings.email_watcher_imap_secure, true),
    user: process.env.EMAIL_WATCHER_IMAP_USER || smtpUser,
    password: process.env.EMAIL_WATCHER_IMAP_PASSWORD || smtpPassword,
    mailbox: process.env.EMAIL_WATCHER_MAILBOX || rawSettings.email_watcher_mailbox || "INBOX",
    fromAllowlist: parseList(
      process.env.EMAIL_WATCHER_FROM_ALLOWLIST || rawSettings.email_watcher_from_allowlist
    ),
    requiredFilename:
      process.env.EMAIL_WATCHER_REQUIRED_FILENAME || rawSettings.email_watcher_required_filename || "proposta",
  };
}

function messageSearchText(parsed, decision) {
  return [
    parsed.subject,
    parsed.text,
    decision.filenames.join(" "),
    decision.sender_candidates.all.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function normalizeAddress(address) {
  return String(address || "").trim().toLowerCase();
}

function addressValueFromEnvelope(addresses = []) {
  return (Array.isArray(addresses) ? addresses : [])
    .map((item) => {
      const address = normalizeAddress(item.address || item.addr || item.mailbox);
      return address ? { address, name: item.name || item.label || "" } : null;
    })
    .filter(Boolean);
}

function valueFromParams(params, keys) {
  if (!params) return "";
  if (params instanceof Map) {
    for (const key of keys) {
      const value = params.get(key) || params.get(key.toLowerCase()) || params.get(key.toUpperCase());
      if (value) return String(value);
    }
    return "";
  }
  for (const key of keys) {
    const value = params[key] || params[key.toLowerCase()] || params[key.toUpperCase()];
    if (value) return String(value);
  }
  return "";
}

function attachmentFilenamesFromBodyStructure(node, acc = []) {
  if (!node || typeof node !== "object") return acc;
  const disposition = String(node.disposition || node.dispositionType || "").toLowerCase();
  const filename =
    node.filename ||
    valueFromParams(node.dispositionParameters, ["filename"]) ||
    valueFromParams(node.parameters, ["name"]);
  if (filename && (disposition === "attachment" || disposition === "inline" || node.dispositionParameters)) {
    acc.push(String(filename));
  }
  const children = node.childNodes || node.children || node.parts || [];
  if (Array.isArray(children)) {
    children.forEach((child) => attachmentFilenamesFromBodyStructure(child, acc));
  }
  return acc;
}

function parsedSummaryFromImapMessage(message) {
  const envelope = message.envelope || {};
  const date = envelope.date || message.internalDate || null;
  return {
    subject: envelope.subject || "",
    from: { value: addressValueFromEnvelope(envelope.from) },
    sender: { value: addressValueFromEnvelope(envelope.sender) },
    replyTo: { value: addressValueFromEnvelope(envelope.replyTo) },
    to: { value: addressValueFromEnvelope(envelope.to) },
    date,
    messageId: envelope.messageId || null,
    text: "",
    attachments: attachmentFilenamesFromBodyStructure(message.bodyStructure).map((filename) => ({
      filename,
    })),
  };
}

function filesFromMail(parsed) {
  return (parsed.attachments || []).map((attachment, index) => ({
    fieldname: `email_attachment_${index + 1}`,
    originalname: attachment.filename || `attachment_${index + 1}`,
    mimetype: attachment.contentType || "application/octet-stream",
    size: attachment.size || attachment.content?.length || null,
    encoding: "7bit",
    buffer: attachment.content,
  }));
}

function bodyFromMail(parsed, messageKey, settings) {
  return {
    subject: parsed.subject || "",
    from: collectEmailSenderAddresses(parsed).join(", "),
    to: (parsed.to?.value || []).map((item) => item.address).filter(Boolean).join(", "),
    date: parsed.date?.toISOString?.() || "",
    email_id: messageKey,
    message_id: parsed.messageId || messageKey,
    email_body_text: parsed.text || "",
    email_body_html: parsed.html || "",
    source_mailbox: settings.mailbox,
    watcher_required_filename: settings.requiredFilename,
    manual_mailbox_process: "true",
  };
}

export async function listMailboxMessages({
  getSettings,
  includeAllSenders = false,
  limit = 50,
  query = "",
} = {}) {
  await getSettings?.();
  return listMailboxIndexMessages({ includeAllSenders, limit, query });
}

export async function syncMailboxMessages({
  getSettings,
  findProcessingEventByExternalEmailId,
  from,
  includeAllSenders = true,
  limit = 50,
  query = "",
  daysBack = 21,
} = {}) {
  const settings = resolveMailboxSettings(await getSettings());
  if (!settings.host || !settings.user || !settings.password) {
    return {
      ok: false,
      disabled_reason: "IMAP host/user/password missing",
      messages: [],
    };
  }

  const selectedFrom = String(from || "").trim().toLowerCase();
  const filterSenders = includeAllSenders ? [] : selectedFrom ? [selectedFrom] : settings.fromAllowlist;
  const decisionAllowlist = selectedFrom ? [selectedFrom] : settings.fromAllowlist;
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const historyDays = Math.max(1, Number.parseInt(String(daysBack || "21"), 10) || 21);
  const sinceDate = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000);
  const state = await readWatcherState();
  const diagnostics = {
    scanned: 0,
    fetched: 0,
    indexed: 0,
    skipped_before_since: 0,
    skipped_query: 0,
    skipped_sender: 0,
  };
  const { messages, scanned } = await withImapRetries(async () => {
    const client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: {
        user: settings.user,
        pass: settings.password,
      },
      logger: false,
    });
    client.on("error", (error) => {
      console.warn("[mailbox_browser] IMAP client error", error.message || String(error));
    });

    const messages = [];
    let scanned = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock(settings.mailbox);
      try {
        let uids;
        try {
          uids = await client.search({ since: sinceDate }, { uid: true });
        } catch (error) {
          console.warn("[mailbox_browser] IMAP since search failed, falling back to recent UID scan", error.message || String(error));
          uids = await client.search({ all: true }, { uid: true });
        }
        const configuredBackfillLimit = intValue(process.env.MAILBOX_BACKFILL_SCAN_LIMIT, 500);
        const scanLimit = normalizedQuery
          ? Math.max(Number(limit) * 20, configuredBackfillLimit)
          : filterSenders.length
          ? Math.max(Number(limit) * 20, configuredBackfillLimit)
          : Math.max(1, Number(limit) * 3);
        const selectedUids = uids.slice(-scanLimit).reverse();
        scanned = selectedUids.length;
        diagnostics.scanned = selectedUids.length;
        for (const uidBatch of batchItems(selectedUids, 100)) {
          for await (const message of client.fetch(
            uidBatch,
            { uid: true, flags: true, envelope: true, internalDate: true, bodyStructure: true },
            { uid: true }
          )) {
            diagnostics.fetched += 1;
            const parsed = parsedSummaryFromImapMessage(message);
            if (parsed.date && parsed.date < sinceDate) {
              diagnostics.skipped_before_since += 1;
              continue;
            }
            const messageKey = parsed.messageId || `${settings.mailbox}:${message.uid}`;
            const decision = evaluateEmailInterceptorDecision({
              message: parsed,
              settings: { ...settings, fromAllowlist: decisionAllowlist },
              state,
              messageKey,
            });
            if (normalizedQuery && !messageSearchText(parsed, decision).includes(normalizedQuery)) {
              diagnostics.skipped_query += 1;
              continue;
            }
            if (!includeAllSenders && !decision.sender_allowed) {
              diagnostics.skipped_sender += 1;
              continue;
            }

            const matchingEvent = await findProcessingEventByExternalEmailId?.({
              source: "imap.email_activation",
              emailId: messageKey,
            });
            const archivedBeforeWatcherCutoff = isLegacyMailboxMessage(parsed.date);
            messages.push({
              id: messageKey,
              message_id: messageKey,
              mailbox: settings.mailbox,
              uid: message.uid,
              subject: parsed.subject || "(senza oggetto)",
              from: decision.sender_candidates.from,
              sender_candidates: decision.sender_candidates,
              to: (parsed.to?.value || []).map((item) => item.address).filter(Boolean),
              date: parsed.date?.toISOString?.() || null,
              seen: Array.from(message.flags || []).includes("\\Seen"),
              sender_allowed: decision.sender_allowed,
              allowed_from: decision.allowed_from,
              processed: Boolean(decision.processed || archivedBeforeWatcherCutoff),
              required_filename_match: decision.required_filename_match,
              required_filename: decision.required_filename,
              filenames: decision.filenames,
              interceptor: decision,
              event_id: matchingEvent?.id || null,
              status: matchingEvent?.status || (archivedBeforeWatcherCutoff ? "archived_before_watcher_cutoff" : null),
              processing_status: matchingEvent?.status || (archivedBeforeWatcherCutoff ? "archived_before_watcher_cutoff" : null),
            });
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
    return { messages, scanned };
  }, { timeoutMs: intValue(process.env.MAILBOX_SYNC_TIMEOUT_SECONDS, 180) * 1000 });

  await upsertMailboxMessages(messages);
  diagnostics.indexed = messages.length;
  messages.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return {
    ok: true,
    kind: "mailbox_sync",
    mailbox: settings.mailbox,
    from: filterSenders,
    since: sinceDate.toISOString(),
    days_back: historyDays,
    scanned,
    diagnostics,
    messages: messages.slice(0, limit),
  };
}

export async function processMailboxMessage({
  getSettings,
  findProcessingEventByExternalEmailId,
  onAcceptedMail,
  uid,
  messageId,
  force = true,
} = {}) {
  const settings = resolveMailboxSettings(await getSettings());
  if (!settings.host || !settings.user || !settings.password) {
    return {
      ok: false,
      error: "IMAP host/user/password missing",
    };
  }

  const uidNumber = Number.parseInt(String(uid || ""), 10);
  if (!Number.isFinite(uidNumber) || uidNumber <= 0) {
    return {
      ok: false,
      error: "uid obbligatorio.",
    };
  }

  const imapResult = await withImapRetries(async () => {
    const client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: {
        user: settings.user,
        pass: settings.password,
      },
      logger: false,
    });
    client.on("error", (error) => {
      console.warn("[mailbox_browser] IMAP client error", error.message || String(error));
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock(settings.mailbox);
      try {
        let found = null;
        for await (const message of client.fetch([uidNumber], { uid: true, source: true }, { uid: true })) {
          found = message;
          break;
        }
        if (!found?.source) {
          return {
            ok: false,
            error: "Email IMAP non trovata.",
          };
        }

        const parsed = await simpleParser(found.source);
        const messageKey = parsed.messageId || messageId || `${settings.mailbox}:${uidNumber}`;
        const duplicateEvent = await findProcessingEventByExternalEmailId?.({
          source: "imap.email_activation",
          emailId: messageKey,
        });
        if (duplicateEvent) {
          await updateMailboxMessage(
            { uid: uidNumber, mailbox: settings.mailbox, message_id: messageKey },
            {
              event_id: duplicateEvent.id,
              status: duplicateEvent.status,
              processing_status: duplicateEvent.status,
              processed: true,
            }
          );
          return {
            ok: true,
            duplicate: true,
            event: duplicateEvent,
            event_id: duplicateEvent.id,
          };
        }

        const decision = evaluateEmailInterceptorDecision({
          message: parsed,
          settings,
          state: force ? { processed: [] } : await readWatcherState(),
          messageKey,
        });
        return {
          ok: true,
          job: {
            uid: uidNumber,
            mailbox: settings.mailbox,
            message_id: messageKey,
            body: bodyFromMail(parsed, messageKey, settings),
            files: filesFromMail(parsed),
            metadata: {
              subject: parsed.subject || null,
              from: collectEmailSenderAddresses(parsed).join(", ") || null,
              email_id: messageKey,
              manual_mailbox_process: true,
            },
          },
          interceptor: decision,
        };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
  }, { timeoutMs: 60_000 });

  if (!imapResult?.job) return imapResult;

  const event = await onAcceptedMail({
    body: imapResult.job.body,
    files: imapResult.job.files,
    metadata: imapResult.job.metadata,
    background: true,
  });
  await updateMailboxMessage(
    { uid: imapResult.job.uid, mailbox: imapResult.job.mailbox, message_id: imapResult.job.message_id },
    {
      event_id: event?.id || null,
      status: event?.status || "extracting",
      processing_status: "extracting",
      processed: true,
    }
  );
  return {
    ok: true,
    event,
    event_id: event?.id || null,
    interceptor: imapResult.interceptor,
  };
}
