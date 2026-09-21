#!/usr/bin/env node
import "dotenv/config";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { getEffectiveSetting } from "../backend/lib/app_config.js";
import { createOcrInputFromBuffer } from "../backend/lib/ocr_input_store.js";
import { buildPdfAppOcrPayload, findJobId } from "../backend/lib/pdf_app.js";

const defaultEndpoint = "https://api.pdf-app.net/ocr";
const defaultPdfPath = "PROPOSTA SCANDOLARA.pdf";

function authHeaders(apiKey) {
  const cleanKey = String(apiKey || "").replace(/^Bearer\s+/i, "").trim();
  return {
    Authorization: cleanKey,
  };
}

function redactOcrInputUrls(value) {
  return String(value || "").replace(
    /https?:\/\/[^\s"'<>]+\/api\/v1\/ocr-inputs\/[^/\s"'<>]+(?:\/[^\s"'<>]*)?/gi,
    (match) => {
      try {
        const parsed = new URL(match);
        return `${parsed.origin}/api/v1/ocr-inputs/[REDACTED]`;
      } catch {
        return "[REDACTED_OCR_INPUT_URL]";
      }
    }
  );
}

function sanitizeValue(value) {
  if (typeof value === "string") return redactOcrInputUrls(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["authorization", "api_key", "apikey", "token"].includes(key.toLowerCase()))
      .map(([key, item]) => [key, sanitizeValue(item)])
  );
}

function selectedHeaders(headers) {
  const output = {};
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    const useful =
      lower === "location" ||
      lower === "retry-after" ||
      lower === "content-type" ||
      lower === "date" ||
      lower.includes("job") ||
      lower.includes("request") ||
      lower.includes("correlation") ||
      lower.includes("operation") ||
      lower.includes("status");
    if (useful) output[lower] = sanitizeValue(value);
  }
  return output;
}

function parseResponseBody(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { text };
  }
}

function findLikelyStatus(body) {
  return (
    body?.status ||
    body?.state ||
    body?.data?.status ||
    body?.data?.state ||
    body?.result?.status ||
    body?.result?.state ||
    null
  );
}

function findLikelyPollingUrl(body, headers) {
  return (
    headers.location ||
    body?.polling_url ||
    body?.pollingUrl ||
    body?.poll_url ||
    body?.pollUrl ||
    body?.job_url ||
    body?.jobUrl ||
    body?.status_url ||
    body?.statusUrl ||
    body?.data?.polling_url ||
    body?.data?.pollingUrl ||
    body?.data?.job_url ||
    body?.data?.jobUrl ||
    body?.data?.status_url ||
    body?.data?.statusUrl ||
    null
  );
}

async function main() {
  const pdfPath = resolve(process.argv[2] || defaultPdfPath);
  const fileInfo = await stat(pdfPath);
  if (!fileInfo.isFile()) {
    throw new Error(`File non valido: ${pdfPath}`);
  }

  const apiKey = await getEffectiveSetting("PDF_APP_API_KEY", "pdf_app_api_key");
  const endpoint =
    (await getEffectiveSetting("PDF_APP_OCR_ENDPOINT", "pdf_app_ocr_endpoint")) || defaultEndpoint;
  if (!apiKey) {
    throw new Error("PDF_APP_API_KEY non configurata in env o runtime settings.");
  }

  const buffer = await readFile(pdfPath);
  const input = await createOcrInputFromBuffer({
    buffer,
    fileName: basename(pdfPath),
    mimeType: "application/pdf",
  });
  if (!input?.url) {
    throw new Error(
      "Impossibile generare OCR input URL. Configura OCR_PUBLIC_BASE_URL, ASTEBOOK_PUBLIC_URL, PROJECT_URL, PUBLIC_BASE_URL, PUBLIC_URL o HEALTH_URL."
    );
  }

  const requestBody = buildPdfAppOcrPayload(input.url, { async: true });
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...authHeaders(apiKey),
    },
    body: JSON.stringify(requestBody),
  });
  const durationMs = Date.now() - startedAt;
  const responseText = await response.text();
  const body = parseResponseBody(responseText);
  const headers = selectedHeaders(response.headers);
  const sanitizedBody = sanitizeValue(body);
  const jobId = findJobId(body) || null;
  const likelyStatus = findLikelyStatus(body);
  const likelyPollingUrl = findLikelyPollingUrl(body, headers);

  console.log("PDF-app async diagnostic");
  console.log("");
  console.log(`file: ${basename(pdfPath)}`);
  console.log("file_url: " + sanitizeValue(input.url));
  console.log("async: true");
  console.log("");
  console.log(`HTTP status: ${response.status}`);
  console.log(`duration_ms: ${durationMs}`);
  console.log("");
  console.log("headers:");
  console.log(JSON.stringify(headers, null, 2));
  console.log("");
  console.log("summary:");
  console.log(
    JSON.stringify(
      sanitizeValue({
        ok: response.ok,
        job_id: jobId,
        status: likelyStatus,
        polling_url: likelyPollingUrl,
        gateway_timeout: response.status === 504,
      }),
      null,
      2
    )
  );
  console.log("");
  console.log("body:");
  console.log(JSON.stringify(sanitizedBody, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: sanitizeValue(error.message || String(error)),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
