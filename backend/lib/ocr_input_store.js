import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const ocrInputRoot = process.env.OCR_INPUT_DIR || join(runtimeDir, "ocr-inputs");

function safeFileName(value) {
  return basename(String(value || "attachment"))
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 160) || "attachment";
}

function publicBaseUrl() {
  const direct = String(
    process.env.OCR_PUBLIC_BASE_URL ||
      process.env.ASTEBOOK_PUBLIC_URL ||
      process.env.PROJECT_URL ||
      process.env.PUBLIC_BASE_URL ||
      process.env.PUBLIC_URL ||
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
  const baseUrl = publicBaseUrl();
  if (!baseUrl) return null;

  const token = randomUUID().replace(/-/g, "");
  const safeName = safeFileName(fileName);
  const dir = join(ocrInputRoot, token);
  const filePath = join(dir, safeName);
  const metaPath = join(dir, "meta.json");

  await mkdir(dir, { recursive: true });
  await writeFile(filePath, buffer);
  await writeFile(
    metaPath,
    `${JSON.stringify({
      file_name: fileName || safeName,
      safe_name: safeName,
      mime_type: mimeType || "application/octet-stream",
      created_at: new Date().toISOString(),
      size: buffer.length,
    }, null, 2)}\n`,
    "utf8"
  );

  return {
    token,
    file_name: safeName,
    file_path: filePath,
    url: `${baseUrl}/api/v1/ocr-inputs/${encodeURIComponent(token)}/${encodeURIComponent(safeName)}`,
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
  };
}
