import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getPrismaClient } from "./db.js";

const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const mailboxIndexFile = process.env.MAILBOX_INDEX_FILE || join(runtimeDir, "mailbox-index.json");

function useMailboxDb() {
  return Boolean(process.env.DATABASE_URL) && !process.env.MAILBOX_INDEX_FILE;
}

function dateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function mailboxMessageId(message) {
  return String(message?.id || message?.message_id || `${message?.mailbox || "INBOX"}:${message?.uid || ""}`);
}

function dbDataFromMailboxMessage(message) {
  return {
    id: mailboxMessageId(message),
    messageId: message.message_id || message.messageId || mailboxMessageId(message),
    uid: message.uid ? Number(message.uid) : null,
    mailbox: message.mailbox || "INBOX",
    subject: message.subject || null,
    from: arrayOrEmpty(message.from),
    senderCandidates: message.sender_candidates || message.senderCandidates || {},
    to: arrayOrEmpty(message.to),
    date: dateOrNull(message.date),
    seen: Boolean(message.seen),
    senderAllowed: message.sender_allowed ?? message.senderAllowed ?? null,
    allowedFrom: arrayOrEmpty(message.allowed_from || message.allowedFrom),
    processed: Boolean(message.processed),
    requiredFilenameMatch: message.required_filename_match ?? message.requiredFilenameMatch ?? null,
    requiredFilename: message.required_filename || message.requiredFilename || null,
    filenames: arrayOrEmpty(message.filenames),
    interceptor: message.interceptor || null,
    eventId: message.event_id || message.eventId || null,
    status: message.status || null,
    processingStatus: message.processing_status || message.processingStatus || null,
    lastSyncedAt: new Date(),
  };
}

function mailboxMessageFromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    message_id: row.messageId || row.id,
    uid: row.uid,
    mailbox: row.mailbox,
    subject: row.subject || "",
    from: arrayOrEmpty(row.from),
    sender_candidates: row.senderCandidates || {},
    to: arrayOrEmpty(row.to),
    date: row.date?.toISOString?.() || null,
    seen: Boolean(row.seen),
    sender_allowed: row.senderAllowed,
    allowed_from: arrayOrEmpty(row.allowedFrom),
    processed: Boolean(row.processed),
    required_filename_match: row.requiredFilenameMatch,
    required_filename: row.requiredFilename || null,
    filenames: arrayOrEmpty(row.filenames),
    interceptor: row.interceptor || null,
    event_id: row.eventId || null,
    status: row.status || null,
    processing_status: row.processingStatus || null,
    last_synced_at: row.lastSyncedAt?.toISOString?.() || null,
  };
}

function dbPatchFromMailboxPatch(patch = {}) {
  const data = {};
  if ("message_id" in patch || "messageId" in patch) data.messageId = patch.message_id || patch.messageId || null;
  if ("uid" in patch) data.uid = patch.uid ? Number(patch.uid) : null;
  if ("mailbox" in patch) data.mailbox = patch.mailbox || "INBOX";
  if ("subject" in patch) data.subject = patch.subject || null;
  if ("from" in patch) data.from = arrayOrEmpty(patch.from);
  if ("sender_candidates" in patch || "senderCandidates" in patch) {
    data.senderCandidates = patch.sender_candidates || patch.senderCandidates || {};
  }
  if ("to" in patch) data.to = arrayOrEmpty(patch.to);
  if ("date" in patch) data.date = dateOrNull(patch.date);
  if ("seen" in patch) data.seen = Boolean(patch.seen);
  if ("sender_allowed" in patch || "senderAllowed" in patch) data.senderAllowed = patch.sender_allowed ?? patch.senderAllowed ?? null;
  if ("allowed_from" in patch || "allowedFrom" in patch) data.allowedFrom = arrayOrEmpty(patch.allowed_from || patch.allowedFrom);
  if ("processed" in patch) data.processed = Boolean(patch.processed);
  if ("required_filename_match" in patch || "requiredFilenameMatch" in patch) {
    data.requiredFilenameMatch = patch.required_filename_match ?? patch.requiredFilenameMatch ?? null;
  }
  if ("required_filename" in patch || "requiredFilename" in patch) {
    data.requiredFilename = patch.required_filename || patch.requiredFilename || null;
  }
  if ("filenames" in patch) data.filenames = arrayOrEmpty(patch.filenames);
  if ("interceptor" in patch) data.interceptor = patch.interceptor || null;
  if ("event_id" in patch || "eventId" in patch) data.eventId = patch.event_id || patch.eventId || null;
  if ("status" in patch) data.status = patch.status || null;
  if ("processing_status" in patch || "processingStatus" in patch) {
    data.processingStatus = patch.processing_status || patch.processingStatus || null;
  }
  data.lastSyncedAt = new Date();
  return data;
}

async function ensureMailboxIndexFile() {
  await mkdir(runtimeDir, { recursive: true });
  if (!existsSync(mailboxIndexFile)) {
    await writeFile(mailboxIndexFile, JSON.stringify({ messages: [] }, null, 2), "utf8");
  }
}

async function quarantineCorruptMailboxIndex(raw, error) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const corruptFile = `${mailboxIndexFile}.corrupt-${stamp}`;
  try {
    if (raw) await copyFile(mailboxIndexFile, corruptFile);
  } catch (copyError) {
    console.warn("[mailbox_index] failed to copy corrupt index", copyError);
  }
  console.warn("[mailbox_index] corrupt index reset", {
    file: mailboxIndexFile,
    backup: corruptFile,
    error: error.message || String(error),
  });
  await writeFile(mailboxIndexFile, `${JSON.stringify({ messages: [] }, null, 2)}\n`, "utf8");
  return { messages: [], synced_at: null };
}

export async function readMailboxIndex() {
  await ensureMailboxIndexFile();
  const raw = await readFile(mailboxIndexFile, "utf8");
  let parsed = {};
  try {
    parsed = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    return quarantineCorruptMailboxIndex(raw, error);
  }
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
  const tempFile = `${mailboxIndexFile}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempFile, `${JSON.stringify({ messages, synced_at: new Date().toISOString() }, null, 2)}\n`, "utf8");
  await rename(tempFile, mailboxIndexFile);
}

function indexKey(message) {
  return `${message.mailbox || "INBOX"}:${message.uid || message.id || message.message_id || ""}`;
}

export async function upsertMailboxMessages(messages) {
  if (useMailboxDb()) {
    const prisma = getPrismaClient();
    const entries = (Array.isArray(messages) ? messages : [messages]).filter(Boolean).map(dbDataFromMailboxMessage);
    if (!entries.length) return [];
    await prisma.$transaction(
      entries.map((data) => {
        const { id, processed, ...update } = data;
        const updateData = {
          ...update,
          ...(processed ? { processed: true } : {}),
        };
        return prisma.mailboxMessage.upsert({
          where: { id },
          create: data,
          update: updateData,
        });
      })
    );
    return entries;
  }

  const index = await readMailboxIndex();
  const byKey = new Map(index.messages.map((message) => [indexKey(message), message]));
  (Array.isArray(messages) ? messages : [messages]).filter(Boolean).forEach((message) => {
    const key = indexKey(message);
    byKey.set(key, {
      ...(byKey.get(key) || {}),
      ...message,
      processed: Boolean(byKey.get(key)?.processed || message.processed),
      last_synced_at: new Date().toISOString(),
    });
  });
  const nextMessages = Array.from(byKey.values());
  await writeMailboxIndex({ messages: nextMessages });
  return nextMessages;
}

export async function findMailboxIndexMessage(match = {}) {
  if (useMailboxDb()) {
    const prisma = getPrismaClient();
    const mailbox = match.mailbox || "INBOX";
    const uid = Number.parseInt(String(match.uid || ""), 10);
    const byUid = Number.isFinite(uid)
      ? await prisma.mailboxMessage.findUnique({ where: { mailbox_uid: { mailbox, uid } } })
      : null;
    if (byUid) return mailboxMessageFromDb(byUid);
    const messageId = String(match.message_id || match.messageId || match.id || "").trim();
    if (!messageId) return null;
    const byMessageId = await prisma.mailboxMessage.findFirst({
      where: {
        OR: [
          { id: messageId },
          { messageId },
        ],
      },
    });
    return mailboxMessageFromDb(byMessageId);
  }

  const index = await readMailboxIndex();
  const mailbox = match.mailbox || "INBOX";
  const uid = String(match.uid || "");
  const messageId = String(match.message_id || match.messageId || match.id || "").trim();
  return index.messages.find((message) => {
    const matchesUid = uid && String(message.uid || "") === uid && (!mailbox || message.mailbox === mailbox);
    const matchesId = messageId && String(message.id || message.message_id || "") === messageId;
    return matchesUid || matchesId;
  }) || null;
}

export async function updateMailboxMessage(match, patch) {
  if (useMailboxDb()) {
    const prisma = getPrismaClient();
    const patchData = dbPatchFromMailboxPatch(patch);

    const mailbox = match?.mailbox || "INBOX";
    const uid = Number.parseInt(String(match?.uid || ""), 10);
    let existing = Number.isFinite(uid)
      ? await prisma.mailboxMessage.findUnique({ where: { mailbox_uid: { mailbox, uid } } })
      : null;
    if (!existing && match?.message_id) {
      existing = await prisma.mailboxMessage.findFirst({
          where: {
            OR: [
              { id: String(match?.message_id || "") },
              { messageId: String(match?.message_id || "") },
            ],
          },
        });
    }
    if (!existing) return null;
    const updated = await prisma.mailboxMessage.update({
      where: { id: existing.id },
      data: Object.fromEntries(Object.entries(patchData).filter(([, value]) => value !== undefined)),
    });
    return mailboxMessageFromDb(updated);
  }

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
  if (useMailboxDb()) {
    const prisma = getPrismaClient();
    const normalizedQuery = String(query || "").trim().toLowerCase();
    const take = Math.min(Math.max(Number(limit) * (normalizedQuery ? 10 : 3), Number(limit)), 500);
    const where = includeAllSenders ? {} : { senderAllowed: { not: false } };
    const [rows, totalIndexed, latestSync] = await Promise.all([
      prisma.mailboxMessage.findMany({
        where,
        orderBy: [{ date: "desc" }, { lastSyncedAt: "desc" }],
        take,
      }),
      prisma.mailboxMessage.count(),
      prisma.mailboxMessage.findFirst({
        orderBy: { lastSyncedAt: "desc" },
        select: { lastSyncedAt: true },
      }),
    ]);
    const messages = rows
      .map(mailboxMessageFromDb)
      .filter((message) => !normalizedQuery || searchText(message).includes(normalizedQuery))
      .slice(0, limit);
    return {
      ok: true,
      kind: "mailbox_db",
      synced_at: latestSync?.lastSyncedAt?.toISOString?.() || null,
      messages,
      total_indexed: totalIndexed,
    };
  }

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

export async function listPendingMailboxMessagesForProcessing({ limit = 5 } = {}) {
  const take = Math.min(Math.max(Number(limit) || 5, 1), 25);
  if (useMailboxDb()) {
    const prisma = getPrismaClient();
    const rows = await prisma.mailboxMessage.findMany({
      where: {
        eventId: null,
        processed: false,
        uid: { not: null },
        senderAllowed: { not: false },
      },
      orderBy: [{ date: "asc" }, { lastSyncedAt: "asc" }],
      take,
    });
    return rows.map(mailboxMessageFromDb);
  }

  const index = await readMailboxIndex();
  return index.messages
    .filter((message) => !message.event_id && !message.processed && message.uid && message.sender_allowed !== false)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .slice(0, take);
}
