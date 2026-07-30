import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getEffectiveSetting } from "./app_config.js";

const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const ocrInputRoot = process.env.OCR_INPUT_DIR || join(runtimeDir, "ocr-inputs");
const defaultOcrInputTtlSeconds = 3600;

function safeFileName(value) {
  return basename(String(value || "attachment"))
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 160) || "attachment";
}

export async function getOcrPublicBaseUrl() {
  const direct = String(
    process.env.OCR_PUBLIC_BASE_URL ||
      process.env.ASTEBOOK_PUBLIC_URL ||
      process.env.PROJECT_URL ||
      process.env.PUBLIC_BASE_URL ||
      process.env.PUBLIC_URL ||
      (await getEffectiveSetting("OCR_PUBLIC_BASE_URL", "ocr_public_base_url")) ||
      ""
  ).trim();
  if (direct) return direct.replace(/\/$/, "");

  try {
    const healthUrl = String(process.env.HEALTH_URL || "").trim();
    return healthUrl ? new URL(healthUrl).origin.replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

export async function createOcrInputFromBuffer({ buffer, fileName, mimeType }) {
  if (!buffer?.length) return null;
  const baseUrl = await getOcrPublicBaseUrl();
  if (!baseUrl) return null;

  const token = randomUUID().replace(/-/g, "");
  const safeName = safeFileName(fileName);
  const ttlSeconds = Number.parseInt(process.env.OCR_INPUT_TTL_SECONDS || "", 10) || defaultOcrInputTtlSeconds;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);
  const dir = join(ocrInputRoot, token);
  const filePath = join(dir, safeName);
  const metaPath = join(dir, "meta.json");
  const contentType = mimeType || "application/octet-stream";

  await mkdir(dir, { recursive: true });
  await writeFile(filePath, buffer);
  await writeFile(
    metaPath,
    `${JSON.stringify({
      file_name: fileName || safeName,
      safe_name: safeName,
      mime_type: contentType,
      created_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      ttl_seconds: ttlSeconds,
      size: buffer.length,
    }, null, 2)}\n`,
    "utf8"
  );

  const url = `${baseUrl}/api/v1/ocr-inputs/${encodeURIComponent(token)}/${encodeURIComponent(safeName)}`;
  return {
    token,
    file_name: safeName,
    file_path: filePath,
    url,
    expires_at: expiresAt.toISOString(),
    content_type: contentType,
    size: buffer.length,
    diagnostics: describeOcrInputUrl({
      url,
      fileName: safeName,
      expiresAt: expiresAt.toISOString(),
      contentType,
      size: buffer.length,
    }),
  };
}

export async function readOcrInput({ token, fileName }) {
  const cleanToken = String(token || "").trim();
  if (!/^[a-f0-9]{32}$/i.test(cleanToken)) return null;

  const metaPath = join(ocrInputRoot, cleanToken, "meta.json");
  if (!existsSync(metaPath)) return null;

  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  const safeName = safeFileName(fileName || meta.safe_name || meta.file_name);
  if (safeName !== meta.safe_name) return null;

  const filePath = join(ocrInputRoot, cleanToken, meta.safe_name);
  if (!existsSync(filePath)) return null;

  return {
    buffer: await readFile(filePath),
    mime_type: meta.mime_type || "application/octet-stream",
    file_name: meta.file_name || meta.safe_name,
    safe_name: meta.safe_name,
    size: meta.size || null,
    expires_at: meta.expires_at || null,
  };
}

export function maskOcrInputToken(token) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return "";
  if (cleanToken.length <= 8) return `${cleanToken.slice(0, 2)}***${cleanToken.slice(-2)}`;
  return `${cleanToken.slice(0, 4)}***${cleanToken.slice(-4)}`;
}

export function maskOcrInputUrlPath(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/");
    const markerIndex = parts.findIndex((part) => part === "ocr-inputs");
    if (markerIndex >= 0 && parts[markerIndex + 1]) {
      parts[markerIndex + 1] = maskOcrInputToken(decodeURIComponent(parts[markerIndex + 1]));
      return parts.join("/") || "/";
    }
    return url.pathname;
  } catch {
    return null;
  }
}

export function describeOcrInputUrl({ url, fileName, expiresAt, contentType, size } = {}) {
  let parsed = null;
  try {
    parsed = url ? new URL(url) : null;
  } catch {
    parsed = null;
  }

  return {
    ocr_url_origin: parsed?.origin || null,
    ocr_url_path: parsed ? maskOcrInputUrlPath(parsed.href) : null,
    ocr_url_expires_at: expiresAt || null,
    ocr_file_name: fileName || null,
    ocr_content_type: contentType || null,
    ocr_file_size: Number.isFinite(size) ? size : size || null,
  };
}
