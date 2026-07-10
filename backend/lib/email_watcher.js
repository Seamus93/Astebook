import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

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

async function readState() {
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

async function writeState(state) {
  await mkdir(runtimeDir, { recursive: true });
  const processed = Array.from(new Set(state.processed || [])).slice(-1000);
  await writeFile(watcherStateFile, `${JSON.stringify({ processed }, null, 2)}\n`, "utf8");
}

function senderAddresses(parsed) {
  return (parsed.from?.value || [])
    .map((item) => String(item.address || "").trim().toLowerCase())
    .filter(Boolean);
}

function hasRequiredAttachment(parsed, requiredFilename) {
  const keyword = String(requiredFilename || "").trim().toLowerCase();
  if (!keyword) return true;
  return (parsed.attachments || []).some((attachment) =>
    String(attachment.filename || "").toLowerCase().includes(keyword)
  );
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
  if (!settings.enabled) return;
  if (!settings.host || !settings.user || !settings.password) {
    console.warn("[email_watcher] disabled: IMAP host/user/password missing");
    return;
  }

  const state = await readState();
  const processed = new Set(state.processed);
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

  try {
    await client.connect();
    const lock = await client.getMailboxLock(settings.mailbox);
    try {
      for await (const message of client.fetch({ seen: false }, { uid: true, source: true })) {
        const parsed = await simpleParser(message.source);
        const messageKey = parsed.messageId || `${settings.mailbox}:${message.uid}`;
        if (processed.has(messageKey)) continue;

        const senders = senderAddresses(parsed);
        const senderAllowed =
          settings.fromAllowlist.length === 0 ||
          senders.some((sender) => settings.fromAllowlist.includes(sender));
        const filenameAllowed = hasRequiredAttachment(parsed, settings.requiredFilename);

        if (!senderAllowed || !filenameAllowed) {
          processed.add(messageKey);
          continue;
        }

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
        await client.messageFlagsAdd(message.uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
    await writeState({ processed: Array.from(processed) });
  }
}

export function createEmailWatcher({ getSettings, onAcceptedMail }) {
  let timer = null;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const settings = resolveSettings(await getSettings());
      await pollMailbox(settings, onAcceptedMail);
      schedule(settings.pollSeconds);
    } catch (error) {
      console.error("[email_watcher] poll failed", error);
      schedule(120);
    } finally {
      running = false;
    }
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
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
