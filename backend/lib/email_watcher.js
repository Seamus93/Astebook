import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  attachmentFilenameMatchesRequired,
  collectEmailSenderAddresses,
  evaluateEmailInterceptorDecision,
} from "../ai_agents/Interceptor.js";
import { withImapRetries } from "./imap_operation_lock.js";

const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const watcherStateFile = process.env.EMAIL_WATCHER_STATE_FILE || join(runtimeDir, "email-watcher-state.json");

function boolValue(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on", "si"].includes(normalized);
}

function intValue(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseList(value) {
  return String(value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export { attachmentFilenameMatchesRequired };

function deriveImapHost({ imapHost, smtpHost }) {
  if (imapHost) return imapHost;
  const host = String(smtpHost || "").trim();
  if (!host) return "";
  if (/^smtp\./i.test(host)) return host.replace(/^smtp\./i, "imap.");
  if (/gmail\.com$/i.test(host)) return "imap.gmail.com";
  return host;
}

async function readState() {
  await mkdir(runtimeDir, { recursive: true });
  if (!existsSync(watcherStateFile)) {
    await writeFile(watcherStateFile, JSON.stringify({ processed: [] }, null, 2), "utf8");
  }
  const raw = await readFile(watcherStateFile, "utf8");
  const parsed = raw.trim() ? JSON.parse(raw) : {};
  return {
    processed: Array.isArray(parsed.processed) ? parsed.processed : [],
    ignore_before: parsed.ignore_before || null,
  };
}

async function writeState(state) {
  await mkdir(runtimeDir, { recursive: true });
  const processed = Array.from(new Set(state.processed || [])).slice(-1000);
  const nextState = {
    processed,
    ...(state.ignore_before ? { ignore_before: state.ignore_before } : {}),
  };
  await writeFile(watcherStateFile, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}

export async function resetEmailWatcherState() {
  const state = await readState();
  await writeState({ processed: [], ignore_before: state.ignore_before });
  return {
    file: watcherStateFile,
    processed: 0,
    ignore_before: state.ignore_before,
  };
}

export async function forgetEmailWatcherMessageState(messageId) {
  const normalizedMessageId = String(messageId || "").trim();
  if (!normalizedMessageId) {
    throw new Error("message_id obbligatorio.");
  }

  const state = await readState();
  const before = state.processed.length;
  const processed = state.processed.filter((item) => String(item || "").trim() !== normalizedMessageId);
  await writeState({ processed, ignore_before: state.ignore_before });
  return {
    file: watcherStateFile,
    removed: before - processed.length,
    processed: processed.length,
    ignore_before: state.ignore_before,
  };
}

export async function setEmailWatcherIgnoreBefore(date = new Date()) {
  const state = await readState();
  const parsedDate = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(parsedDate.getTime())) {
    throw new Error("ignore_before non valido.");
  }
  const ignoreBefore = parsedDate.toISOString();
  await writeState({ processed: state.processed, ignore_before: ignoreBefore });
  return {
    file: watcherStateFile,
    ignore_before: ignoreBefore,
    processed: state.processed.length,
  };
}

function senderAddresses(parsed) {
  return collectEmailSenderAddresses(parsed);
}

function interceptorDecision(parsed, settings, state, messageKey) {
  return evaluateEmailInterceptorDecision({
    message: parsed,
    settings,
    state,
    messageKey,
  });
}

function addDiagnostic(stats, diagnostic) {
  stats.diagnostics.push(diagnostic);
  stats.diagnostics = stats.diagnostics.slice(-20);
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
    from: senderAddresses(parsed).join(", "),
    to: (parsed.to?.value || []).map((item) => item.address).filter(Boolean).join(", "),
    date: parsed.date?.toISOString?.() || "",
    email_id: messageKey,
    message_id: parsed.messageId || messageKey,
    email_body_text: parsed.text || "",
    email_body_html: parsed.html || "",
    source_mailbox: settings.mailbox,
    watcher_required_filename: settings.requiredFilename,
  };
}

function resolveSettings(rawSettings) {
  const smtpHost = process.env.SMTP_HOST || rawSettings.smtp_host || "";
  const smtpUser = process.env.SMTP_USER || rawSettings.smtp_user || "";
  const smtpPassword = process.env.SMTP_PASSWORD || rawSettings.smtp_password || "";
  const imapHost = process.env.EMAIL_WATCHER_IMAP_HOST || rawSettings.email_watcher_imap_host || "";
  return {
    enabled: boolValue(process.env.EMAIL_WATCHER_ENABLED || rawSettings.email_watcher_enabled, false),
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
    pollSeconds: intValue(process.env.EMAIL_WATCHER_POLL_SECONDS || rawSettings.email_watcher_poll_seconds, 120),
  };
}

async function pollMailbox(settings, onAcceptedMail) {
  const state = await readState();
  const stats = {
    enabled: settings.enabled,
    scanned: 0,
    accepted: 0,
    duplicates: 0,
    skipped_sender: 0,
    skipped_filename: 0,
    skipped_before_baseline: 0,
    ignore_before: state.ignore_before,
    diagnostics: [],
  };
  if (!settings.enabled) return stats;
  if (!settings.host || !settings.user || !settings.password) {
    console.warn("[email_watcher] disabled: IMAP host/user/password missing");
    return {
      ...stats,
      disabled_reason: "IMAP host/user/password missing",
    };
  }

  const processed = new Set(state.processed);
  try {
    await withImapRetries(async () => {
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
        console.warn("[email_watcher] IMAP client error", error.message || String(error));
      });

      try {
        await client.connect();
        const lock = await client.getMailboxLock(settings.mailbox);
        try {
          for await (const message of client.fetch({ seen: false }, { uid: true, source: true })) {
            stats.scanned += 1;
            const parsed = await simpleParser(message.source);
            const messageKey = parsed.messageId || `${settings.mailbox}:${message.uid}`;
            const decision = interceptorDecision(parsed, settings, state, messageKey);
            if (decision.before_baseline) {
              stats.skipped_before_baseline += 1;
              addDiagnostic(stats, {
                reason: "before_baseline",
                subject: parsed.subject || null,
                from: decision.sender_candidates.from,
                sender_candidates: decision.sender_candidates,
                date: parsed.date?.toISOString?.() || null,
                ignore_before: state.ignore_before,
                filenames: decision.filenames,
              });
              processed.add(messageKey);
              continue;
            }

            if (decision.processed) {
              stats.duplicates += 1;
              addDiagnostic(stats, {
                reason: "duplicate",
                subject: parsed.subject || null,
                from: decision.sender_candidates.from,
                sender_candidates: decision.sender_candidates,
                filenames: decision.filenames,
              });
              continue;
            }

            if (!decision.processable) {
              if (!decision.sender_allowed) stats.skipped_sender += 1;
              if (!decision.required_filename_match) stats.skipped_filename += 1;
              addDiagnostic(stats, {
                reason: !decision.sender_allowed && !decision.required_filename_match
                  ? "sender_and_filename"
                  : !decision.sender_allowed
                  ? "sender"
                  : "filename",
                subject: parsed.subject || null,
                from: decision.sender_candidates.from,
                sender_candidates: decision.sender_candidates,
                allowed_from: decision.allowed_from,
                required_filename: decision.required_filename,
                filenames: decision.filenames,
                interceptor: decision,
              });
              continue;
            }

            const senders = senderAddresses(parsed);
            await onAcceptedMail({
              body: bodyFromMail(parsed, messageKey, settings),
              files: filesFromMail(parsed),
              metadata: {
                subject: parsed.subject || null,
                from: senders.join(", ") || null,
                email_id: messageKey,
              },
            });

            processed.add(messageKey);
            stats.accepted += 1;
            await client.messageFlagsAdd(message.uid, ["\\Seen"], { uid: true });
          }
        } finally {
          lock.release();
        }
      } finally {
        await client.logout().catch(() => {});
      }
    });
  } finally {
    await writeState({ processed: Array.from(processed), ignore_before: state.ignore_before });
  }
  return stats;
}

export function createEmailWatcher({ getSettings, onAcceptedMail }) {
  let timer = null;
  let running = false;

  async function runOnce({ reschedule = false } = {}) {
    if (running) {
      return { ok: false, busy: true };
    }
    running = true;
    try {
      const settings = resolveSettings(await getSettings());
      const stats = await pollMailbox(settings, onAcceptedMail);
      if (reschedule) schedule(settings.pollSeconds);
      return { ok: true, ...stats };
    } catch (error) {
      console.error("[email_watcher] poll failed", error);
      if (reschedule) schedule(120);
      return { ok: false, error: error.message || String(error) };
    } finally {
      running = false;
    }
  }

  async function tick() {
    await runOnce({ reschedule: true });
  }

  function schedule(seconds) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, Math.max(30, seconds) * 1000);
    timer.unref?.();
  }

  return {
    start() {
      tick();
    },
    scanNow() {
      return runOnce({ reschedule: false });
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
