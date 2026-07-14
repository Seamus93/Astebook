import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const mailboxIndexFile = process.env.MAILBOX_INDEX_FILE || join(runtimeDir, "mailbox-index.json");

async function ensureMailboxIndexFile() {
  await mkdir(runtimeDir, { recursive: true });
  if (!existsSync(mailboxIndexFile)) {
    await writeFile(mailboxIndexFile, JSON.stringify({ messages: [] }, null, 2), "utf8");
  }
}

export async function readMailboxIndex() {
  await ensureMailboxIndexFile();
  const raw = await readFile(mailboxIndexFile, "utf8");
  const parsed = raw.trim() ? JSON.parse(raw) : {};
  return {
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    synced_at: parsed.synced_at || null,
  };
}

async function writeMailboxIndex(index) {
  await mkdir(runtimeDir, { recursive: true });
  const messages = Array.from(index.messages || [])
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 2000);
  await writeFile(
    mailboxIndexFile,
    `${JSON.stringify({ messages, synced_at: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

function indexKey(message) {
  return `${message.mailbox || "INBOX"}:${message.uid || message.id || message.message_id || ""}`;
}

export async function upsertMailboxMessages(messages) {
  const index = await readMailboxIndex();
  const byKey = new Map(index.messages.map((message) => [indexKey(message), message]));
  (Array.isArray(messages) ? messages : [messages]).filter(Boolean).forEach((message) => {
    const key = indexKey(message);
    byKey.set(key, {
      ...(byKey.get(key) || {}),
      ...message,
      last_synced_at: new Date().toISOString(),
    });
  });
  const nextMessages = Array.from(byKey.values());
  await writeMailboxIndex({ messages: nextMessages });
  return nextMessages;
}

export async function updateMailboxMessage(match, patch) {
  const index = await readMailboxIndex();
  const messages = index.messages.map((message) => {
    const matchesUid =
      match?.uid && String(message.uid || "") === String(match.uid) && (!match.mailbox || message.mailbox === match.mailbox);
    const matchesId = match?.message_id && String(message.id || message.message_id || "") === String(match.message_id);
    if (!matchesUid && !matchesId) return message;
    return {
      ...message,
      ...patch,
      last_synced_at: new Date().toISOString(),
    };
  });
  await writeMailboxIndex({ messages });
  return messages.find((message) => {
    const matchesUid =
      match?.uid && String(message.uid || "") === String(match.uid) && (!match.mailbox || message.mailbox === match.mailbox);
    const matchesId = match?.message_id && String(message.id || message.message_id || "") === String(match.message_id);
    return matchesUid || matchesId;
  }) || null;
}

function searchText(message) {
  return [
    message.subject,
    (message.from || []).join(" "),
    (message.to || []).join(" "),
    (message.filenames || []).join(" "),
    message.id,
  ]
    .join(" ")
    .toLowerCase();
}

export async function listMailboxIndexMessages({
  includeAllSenders = false,
  limit = 50,
  query = "",
} = {}) {
  const index = await readMailboxIndex();
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const messages = index.messages
    .filter((message) => includeAllSenders || message.sender_allowed !== false)
    .filter((message) => !normalizedQuery || searchText(message).includes(normalizedQuery))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, limit);
  return {
    ok: true,
    kind: "mailbox_index",
    synced_at: index.synced_at,
    messages,
    total_indexed: index.messages.length,
  };
}
