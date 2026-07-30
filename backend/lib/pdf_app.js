import { getEffectiveSetting } from "./app_config.js";
import { maskOcrInputUrlPath } from "./ocr_input_store.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

function findTextDeep(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);

  const preferredKeys = [
    "text",
    "plain_text",
    "plainText",
    "ocr_text",
    "ocrText",
    "raw_text",
    "rawText",
    "markdown",
    "content",
    "result",
  ];

  for (const key of preferredKeys) {
    const current = value[key];
    if (typeof current === "string" && current.trim()) return current;
  }

  if (Array.isArray(value)) {
    return firstString(...value.map((item) => findTextDeep(item, seen)));
  }

  return firstString(...Object.values(value).map((item) => findTextDeep(item, seen)));
}

function orderedTextParts(items = []) {
  return [...items]
    .filter((item) => item && typeof item === "object")
    .sort((a, b) => {
      const pageDelta = Number(a.page ?? 0) - Number(b.page ?? 0);
      if (pageDelta) return pageDelta;
      return Number(a.region_index ?? 0) - Number(b.region_index ?? 0);
    })
    .map((item) => firstString(item.result, item.text, item.rawText, item.raw_text, item.content))
    .filter((text) => text.trim());
}

export function extractPdfAppText(payload) {
  const extractionResults = Array.isArray(payload?.extraction_results)
    ? payload.extraction_results
    : Array.isArray(payload?.data?.extraction_results)
    ? payload.data.extraction_results
    : [];

  const pageTexts = extractionResults.flatMap((fileResult) => {
    if (Array.isArray(fileResult?.result)) return orderedTextParts(fileResult.result);
    if (typeof fileResult?.result === "string" && fileResult.result.trim()) return [fileResult.result];
    if (Array.isArray(fileResult?.results)) return orderedTextParts(fileResult.results);
    return [];
  });

  if (pageTexts.length) return pageTexts.join("\n\n");
  return findTextDeep(payload);
}

function findJobId(value) {
  if (!value || typeof value !== "object") return "";
  return firstString(
    value.job_id,
    value.jobId,
    value.jobID,
    value.id,
    value.async_job_id,
    value.asyncJobId,
    value.data?.job_id,
    value.data?.jobId,
    value.result?.job_id,
    value.result?.jobId
  );
}

function authHeaders(apiKey) {
  const cleanKey = String(apiKey || "").replace(/^Bearer\s+/i, "").trim();
  return {
    Authorization: cleanKey,
  };
}

function responseErrorDetail(payload, fallback) {
  return firstString(
    payload?.error,
    payload?.message,
    payload?.detail,
    payload?.text,
    payload?.data?.error,
    payload?.data?.message,
    fallback
  );
}

function compactResponseBody(payload) {
  const value = typeof payload?.text === "string" ? payload.text : JSON.stringify(payload || {});
  return String(value || "").slice(0, 4000);
}

function safeFileUrlDiagnostics(fileUrl) {
  try {
    const parsed = new URL(fileUrl);
    return {
      origin: parsed.origin,
      scheme: parsed.protocol.replace(/:$/, ""),
      port: parsed.port || (parsed.protocol === "https:" ? "443" : parsed.protocol === "http:" ? "80" : ""),
      path: maskOcrInputUrlPath(parsed.href),
    };
  } catch {
    return {
      origin: null,
      scheme: null,
      port: null,
      path: null,
    };
  }
}

export function buildPdfAppOcrPayload(fileUrl) {
  return {
    versionMode: "2",
    v2rawText: true,
    v2Layout: false,
    v2Forms: true,
    v2Signatures: true,
    async: false,
    pdfConvertZoomFactor: 1,
    zoom_factor_img: 1,
    fileUrls: [fileUrl],
  };
}

export function buildPdfAppErrorDiagnostics({ endpoint, requestBody, response, responsePayload }) {
  const fileUrls = Array.isArray(requestBody?.fileUrls) ? requestBody.fileUrls : [];
  const fileUrlDetails = fileUrls.map((fileUrl) => safeFileUrlDiagnostics(fileUrl));
  return {
    status: response?.status || null,
    endpoint,
    version_mode: requestBody?.versionMode || null,
    file_urls_count: fileUrls.length,
    file_url_origins: fileUrlDetails.map((item) => item.origin),
    file_url_schemes: fileUrlDetails.map((item) => item.scheme),
    file_url_ports: fileUrlDetails.map((item) => item.port),
    file_url_paths: fileUrlDetails.map((item) => item.path),
    response_body: compactResponseBody(responsePayload),
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { text };
  }
}

async function pollPdfAppJob({ jobId, apiKey, jobEndpoint, timeoutMs = 90000 }) {
  if (!jobId || !jobEndpoint) return null;
  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    const endpoint = jobEndpoint.includes("{jobId}")
      ? jobEndpoint.replaceAll("{jobId}", encodeURIComponent(jobId))
      : `${jobEndpoint.replace(/\/$/, "")}/${encodeURIComponent(jobId)}`;
    const response = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        ...authHeaders(apiKey),
      },
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(`PDF-app job status ${response.status}: ${responseErrorDetail(payload, response.statusText)}`);
    }

    const text = extractPdfAppText(payload);
    if (text) return { text, payload, attempts: attempt };

    const status = String(payload.status || payload.state || payload.data?.status || "").toLowerCase();
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(`PDF-app OCR job failed: ${payload.error || payload.message || status}`);
    }

    await sleep(Math.min(1000 * attempt, 5000));
  }

  throw new Error("PDF-app OCR timeout while waiting for async job.");
}

export async function ocrFileUrlWithPdfApp({ fileUrl, fileName }) {
  const apiKey = await getEffectiveSetting("PDF_APP_API_KEY", "pdf_app_api_key");
  const ocrEndpoint = await getEffectiveSetting("PDF_APP_OCR_ENDPOINT", "pdf_app_ocr_endpoint");
  const jobEndpoint = await getEffectiveSetting("PDF_APP_JOB_ENDPOINT", "pdf_app_job_endpoint");

  if (!apiKey || !ocrEndpoint || !fileUrl) {
    return {
      ok: false,
      skipped: true,
      reason: !apiKey
        ? "PDF_APP_API_KEY non configurata."
        : !ocrEndpoint
        ? "PDF_APP_OCR_ENDPOINT non configurato."
        : "URL file non disponibile.",
    };
  }

  const body = buildPdfAppOcrPayload(fileUrl);

  const response = await fetch(ocrEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...authHeaders(apiKey),
    },
    body: JSON.stringify(body),
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    const error = new Error(`PDF-app OCR status ${response.status}: ${responseErrorDetail(payload, response.statusText)}`);
    error.diagnostics = buildPdfAppErrorDiagnostics({
      endpoint: ocrEndpoint,
      requestBody: body,
      response,
      responsePayload: payload,
    });
    throw error;
  }

  const text = extractPdfAppText(payload);
  if (text) return { ok: true, text, payload };

  const jobId = findJobId(payload);
  if (jobId && jobEndpoint) {
    const job = await pollPdfAppJob({ jobId, apiKey, jobEndpoint });
    return { ok: true, text: job.text, payload: job.payload, job_id: jobId, attempts: job.attempts };
  }

  return {
    ok: false,
    reason: jobId
      ? "PDF-app ha restituito un job asincrono ma PDF_APP_JOB_ENDPOINT non e configurato."
      : "PDF-app non ha restituito testo OCR.",
    payload,
    job_id: jobId || null,
  };
}
