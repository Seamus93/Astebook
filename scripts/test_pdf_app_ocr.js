#!/usr/bin/env node
import "dotenv/config";
import { getEffectiveSetting } from "../backend/lib/app_config.js";
import { buildPdfAppOcrPayload, buildPdfAppErrorDiagnostics } from "../backend/lib/pdf_app.js";

const publicPdfUrl =
  process.env.PDF_APP_TEST_PUBLIC_URL ||
  "https://www.learningcontainer.com/wp-content/uploads/2019/09/sample-pdf-file.pdf";

function authHeaders(apiKey) {
  const cleanKey = String(apiKey || "").replace(/^Bearer\s+/i, "").trim();
  return {
    Authorization: cleanKey,
  };
}

function relevantHeaders(headers) {
  const keys = [
    "content-type",
    "content-length",
    "date",
    "server",
    "x-request-id",
    "x-correlation-id",
    "cf-ray",
  ];
  return Object.fromEntries(
    keys
      .map((key) => [key, headers.get(key)])
      .filter(([, value]) => value)
  );
}

async function main() {
  const apiKey = await getEffectiveSetting("PDF_APP_API_KEY", "pdf_app_api_key");
  const endpoint = await getEffectiveSetting("PDF_APP_OCR_ENDPOINT", "pdf_app_ocr_endpoint");

  if (!apiKey) {
    throw new Error("PDF_APP_API_KEY non configurata.");
  }
  if (!endpoint) {
    throw new Error("PDF_APP_OCR_ENDPOINT non configurato.");
  }

  const requestBody = buildPdfAppOcrPayload(publicPdfUrl);
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
  const responseText = await response.text();
  let responsePayload = { text: responseText };
  try {
    responsePayload = responseText ? JSON.parse(responseText) : {};
  } catch {
    responsePayload = { text: responseText };
  }

  const output = {
    ok: response.ok,
    status: response.status,
    status_text: response.statusText,
    duration_ms: Date.now() - startedAt,
    endpoint,
    public_pdf_url: publicPdfUrl,
    headers: relevantHeaders(response.headers),
  };

  if (!response.ok) {
    output.error_diagnostics = buildPdfAppErrorDiagnostics({
      endpoint,
      requestBody,
      response,
      responsePayload,
    });
  } else {
    output.body_preview = responseText.slice(0, 4000);
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message || String(error),
  }, null, 2));
  process.exitCode = 1;
});
