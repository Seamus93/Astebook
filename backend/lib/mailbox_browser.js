import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { evaluateEmailInterceptorDecision } from "../ai_agents/Interceptor.js";
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

function deriveImapHost({ imapHost, smtpHost }) {
  if (imapHost) return imapHost;
  const host = String(smtpHost || "").trim();
  if (!host) return "";
  if (/^smtp\./i.test(host)) return host.replace(/^smtp\./i, "imap.");
  if (/gmail\.com$/i.test(host)) return "imap.gmail.com";
  return host;
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
    ignore_before: parsed.ignore_before || null,
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

export async function listMailboxMessages({
  getSettings,
  findProcessingEventByExternalEmailId,
  from,
  includeAllSenders = false,
  limit = 50,
  query = "",
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
  const allowedSenders = includeAllSenders ? [] : selectedFrom ? [selectedFrom] : settings.fromAllowlist;
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const state = await readWatcherState();
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
        const uids = await client.search({ all: true }, { uid: true });
        const scanLimit = normalizedQuery
          ? Math.max(Number(limit) * 50, 5000)
          : allowedSenders.length
          ? Math.max(Number(limit) * 20, 1000)
          : Math.max(1, Number(limit) * 3);
        const selectedUids = uids.slice(-scanLimit);
        scanned = selectedUids.length;
        for await (const message of client.fetch(selectedUids, { uid: true, flags: true, source: true }, { uid: true })) {
          const parsed = await simpleParser(message.source);
          const messageKey = parsed.messageId || `${settings.mailbox}:${message.uid}`;
          const decision = evaluateEmailInterceptorDecision({
            message: parsed,
            settings: { ...settings, fromAllowlist: allowedSenders },
            state,
            messageKey,
          });
          if (normalizedQuery && !messageSearchText(parsed, decision).includes(normalizedQuery)) continue;
          if (!decision.sender_allowed) continue;

          const matchingEvent = await findProcessingEventByExternalEmailId?.({
            source: "imap.email_activation",
            emailId: messageKey,
          });
          messages.push({
            id: messageKey,
            uid: message.uid,
            subject: parsed.subject || "(senza oggetto)",
            from: decision.sender_candidates.from,
            sender_candidates: decision.sender_candidates,
            to: (parsed.to?.value || []).map((item) => item.address).filter(Boolean),
            date: parsed.date?.toISOString?.() || null,
            seen: Array.from(message.flags || []).includes("\\Seen"),
            sender_allowed: decision.sender_allowed,
            allowed_from: decision.allowed_from,
            processed: decision.processed,
            before_baseline: decision.before_baseline,
            ignore_before: state.ignore_before,
            required_filename_match: decision.required_filename_match,
            required_filename: decision.required_filename,
            filenames: decision.filenames,
            interceptor: decision,
            event_id: matchingEvent?.id || null,
            status: matchingEvent?.status || null,
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
    return { messages, scanned };
  });

  messages.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return {
    ok: true,
    kind: "mailbox_browser",
    mailbox: settings.mailbox,
    from: allowedSenders,
    scanned,
    messages: messages.slice(0, limit),
  };
}
