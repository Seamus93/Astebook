import { getEffectiveSetting } from "./app_config.js";

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
  return {
    "x-api-key": apiKey,
    "X-API-Key": apiKey,
    Authorization: apiKey,
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
      throw new Error(`PDF-app job status ${response.status}: ${payload?.error || payload?.message || response.statusText}`);
    }

    const text = findTextDeep(payload);
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

  const body = {
    versionMode: "2",
    v2rawText: true,
    v2Layout: false,
    v2Forms: true,
    v2Signatures: true,
    async: false,
    pdfConvertZoomFactor: 1,
    zoom_factor_img: 1,
    fileUrls: [fileUrl],
    file_url: fileUrl,
    fileUrl,
    url: fileUrl,
    urls: [fileUrl],
    filename: fileName,
    file_name: fileName,
    extract_plain_text: true,
    extractPlainText: true,
    extract_layout: false,
    extractLayout: false,
    extract_forms: false,
    extractForms: false,
    extract_tables: false,
    extractTables: false,
    detect_signatures: false,
    detectSignatures: false,
    async: false,
    asynchronous: false,
  };

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
    throw new Error(`PDF-app OCR status ${response.status}: ${payload?.error || payload?.message || response.statusText}`);
  }

  const text = findTextDeep(payload);
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
