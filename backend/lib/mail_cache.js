import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const cacheRoot = process.env.MAILBOX_CACHE_DIR || join(runtimeDir, "mailbox-cache");

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120) || "mail";
}

async function sourceToBuffer(source) {
  if (!source) return null;
  if (Buffer.isBuffer(source)) return source;
  if (source instanceof Uint8Array) return Buffer.from(source);
  if (typeof source === "string") return Buffer.from(source, "utf8");
  if (typeof source[Symbol.asyncIterator] === "function") {
    const chunks = [];
    for await (const chunk of source) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  return Buffer.from(String(source));
}

export async function cacheMailboxSource({ messageKey, uid, mailbox = "INBOX", source }) {
  const buffer = await sourceToBuffer(source);
  if (!buffer?.length) return null;

  await mkdir(cacheRoot, { recursive: true });
  const hash = createHash("sha256").update(buffer).digest("hex");
  const filename = `${safeSegment(mailbox)}-${safeSegment(uid || messageKey)}-${hash.slice(0, 16)}.eml`;
  const rawPath = join(cacheRoot, filename);
  await writeFile(rawPath, buffer);

  return {
    version: 1,
    cached_at: new Date().toISOString(),
    source: "imap",
    raw_path: rawPath,
    sha256: hash,
    size: buffer.length,
    mailbox,
    uid: uid ? Number(uid) : null,
    message_id: messageKey || null,
  };
}

export async function readCachedMailboxSource(mailCache) {
  const rawPath = mailCache?.raw_path || mailCache?.rawPath;
  if (!rawPath || !existsSync(rawPath)) return null;
  return readFile(rawPath);
}
