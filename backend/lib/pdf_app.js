import { getEffectiveSetting } from "./app_config.js";
import { maskOcrInputUrlPath } from "./ocr_input_store.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_POLL_TIMEOUT_MS = 90000;
const DEFAULT_POLL_INTERVAL_BASE_MS = 1000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

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

export function findJobId(value) {
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

function clampNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function getNumericSetting(envName, runtimeName, fallback, bounds = {}) {
  const value = await getEffectiveSetting(envName, runtimeName);
  return clampNumber(value, fallback, bounds);
}

async function getPdfAppAsyncMode(jobEndpoint) {
  const value = String(await getEffectiveSetting("PDF_APP_ASYNC_MODE", "pdf_app_async_mode"))
    .trim()
    .toLowerCase();
  if (["1", "true", "yes", "async"].includes(value)) return true;
  if (["0", "false", "no", "sync"].includes(value)) return false;
  return Boolean(jobEndpoint);
}

function isTransientHttpStatus(status) {
  return [502, 503, 504].includes(Number(status));
}

function isTransientNetworkError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  return (
    ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code) ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("socket hang up") ||
    message.includes("econnreset")
  );
}

function retryDelayMs(attempt, baseDelayMs) {
  if (!baseDelayMs) return 0;
  return Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), 5000);
}

async function fetchJsonWithDiagnostics({ endpoint, options, retryCount, retryBaseDelayMs, retryTransient = true }) {
  let attempt = 0;
  let lastNetworkError = null;

  while (attempt <= retryCount) {
    attempt += 1;
    const startedAt = Date.now();
    try {
      const response = await fetch(endpoint, options);
      const durationMs = Date.now() - startedAt;
      const payload = await parseJsonResponse(response);
      const shouldRetry = retryTransient && isTransientHttpStatus(response.status) && attempt <= retryCount;
      if (shouldRetry) {
        const delay = retryDelayMs(attempt, retryBaseDelayMs);
        if (delay) await sleep(delay);
        continue;
      }
      return {
        response,
        payload,
        attempts: attempt,
        request_duration_ms: durationMs,
        transient_retried: attempt > 1,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      lastNetworkError = error;
      const shouldRetry = retryTransient && isTransientNetworkError(error) && attempt <= retryCount;
      if (!shouldRetry) {
        return {
          response: null,
          payload: {},
          attempts: attempt,
          request_duration_ms: durationMs,
          network_error: error,
          transient_retried: attempt > 1,
        };
      }
      const delay = retryDelayMs(attempt, retryBaseDelayMs);
      if (delay) await sleep(delay);
    }
  }

  return {
    response: null,
    payload: {},
    attempts: attempt,
    request_duration_ms: null,
    network_error: lastNetworkError,
    transient_retried: attempt > 1,
  };
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

function countPdfAppPages(payload) {
  const extractionResults = Array.isArray(payload?.extraction_results)
    ? payload.extraction_results
    : Array.isArray(payload?.data?.extraction_results)
    ? payload.data.extraction_results
    : [];
  const pages = new Set();
  extractionResults.forEach((fileResult) => {
    const resultItems = Array.isArray(fileResult?.result)
      ? fileResult.result
      : Array.isArray(fileResult?.results)
      ? fileResult.results
      : [];
    resultItems.forEach((item) => {
      if (item && typeof item === "object" && item.page !== undefined && item.page !== null) {
        pages.add(String(item.page));
      }
    });
  });
  return pages.size || null;
}

export function assessPdfAppOcrQuality(text, payload = null) {
  const value = String(text || "");
  const cleanText = value.trim();
  const nonWhitespaceLength = cleanText.replace(/\s/g, "").length;
  const pageCount = payload ? countPdfAppPages(payload) : null;
  if (!cleanText) {
    return {
      status: "ocr_empty",
      quality: "empty",
      reason: "ocr_text_empty",
      text_length: value.length,
      non_whitespace_length: nonWhitespaceLength,
      page_count: pageCount,
    };
  }
  if (nonWhitespaceLength < 100) {
    return {
      status: "ocr_suspicious",
      quality: "suspicious",
      reason: "ocr_text_short",
      text_length: value.length,
      non_whitespace_length: nonWhitespaceLength,
      page_count: pageCount,
    };
  }
  return {
    status: "ocr_completed",
    quality: "ok",
    reason: null,
    text_length: value.length,
    non_whitespace_length: nonWhitespaceLength,
    page_count: pageCount,
  };
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

export function buildPdfAppOcrPayload(fileUrl, options = {}) {
  const asyncMode = Boolean(options.async);
  return {
    versionMode: "2",
    v2rawText: true,
    v2Layout: false,
    v2Forms: true,
    v2Signatures: true,
    async: asyncMode,
    pdfConvertZoomFactor: 1,
    zoom_factor_img: 1,
    fileUrls: [fileUrl],
  };
}

export function buildPdfAppErrorDiagnostics({
  endpoint,
  requestBody,
  response,
  responsePayload,
  requestDurationMs = null,
  attempts = null,
  mode = null,
  error = null,
}) {
  const fileUrls = Array.isArray(requestBody?.fileUrls) ? requestBody.fileUrls : [];
  const fileUrlDetails = fileUrls.map((fileUrl) => safeFileUrlDiagnostics(fileUrl));
  return {
    status: response?.status || null,
    final_status: "ocr_failed",
    error_type: "ocr_infrastructure",
    http_status: response?.status || null,
    error: error || responseErrorDetail(responsePayload, response?.statusText || "PDF-app OCR request failed"),
    request_duration_ms: requestDurationMs,
    attempts,
    endpoint,
    mode,
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

async function pollPdfAppJob({
  jobId,
  apiKey,
  jobEndpoint,
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  pollIntervalBaseMs = DEFAULT_POLL_INTERVAL_BASE_MS,
  retryCount = DEFAULT_RETRY_COUNT,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
}) {
  if (!jobId || !jobEndpoint) return null;
  const startedAt = Date.now();
  let attempt = 0;
  let httpAttempts = 0;

  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    const endpoint = jobEndpoint.includes("{jobId}")
      ? jobEndpoint.replaceAll("{jobId}", encodeURIComponent(jobId))
      : `${jobEndpoint.replace(/\/$/, "")}/${encodeURIComponent(jobId)}`;
    const fetchResult = await fetchJsonWithDiagnostics({
      endpoint,
      options: {
        headers: {
          accept: "application/json",
          ...authHeaders(apiKey),
        },
      },
      retryCount,
      retryBaseDelayMs,
    });
    httpAttempts += fetchResult.attempts;
    if (fetchResult.network_error) {
      const error = new Error(`PDF-app job request failed: ${fetchResult.network_error.message || fetchResult.network_error}`);
      error.diagnostics = {
        final_status: "ocr_failed",
        error_type: "ocr_infrastructure",
        endpoint,
        mode: "async",
        poll_attempts: attempt,
        poll_http_attempts: httpAttempts,
        poll_duration_ms: Date.now() - startedAt,
        attempts: fetchResult.attempts,
        request_duration_ms: fetchResult.request_duration_ms,
        error: error.message,
      };
      throw error;
    }

    const { response, payload } = fetchResult;
    if (!response.ok) {
      const error = new Error(`PDF-app job status ${response.status}: ${responseErrorDetail(payload, response.statusText)}`);
      error.diagnostics = {
        final_status: "ocr_failed",
        error_type: "ocr_infrastructure",
        endpoint,
        mode: "async",
        poll_attempts: attempt,
        poll_http_attempts: httpAttempts,
        poll_duration_ms: Date.now() - startedAt,
        attempts: fetchResult.attempts,
        request_duration_ms: fetchResult.request_duration_ms,
        http_status: response.status,
        status: response.status,
        error: responseErrorDetail(payload, response.statusText),
        response_body: compactResponseBody(payload),
      };
      throw error;
    }

    const text = extractPdfAppText(payload);
    if (text) {
      return {
        text,
        payload,
        attempts: attempt,
        http_attempts: httpAttempts,
        poll_duration_ms: Date.now() - startedAt,
      };
    }

    const status = String(payload.status || payload.state || payload.data?.status || "").toLowerCase();
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      const error = new Error(`PDF-app OCR job failed: ${payload.error || payload.message || status}`);
      error.diagnostics = {
        final_status: "ocr_failed",
        error_type: "ocr_infrastructure",
        endpoint,
        mode: "async",
        poll_attempts: attempt,
        poll_http_attempts: httpAttempts,
        poll_duration_ms: Date.now() - startedAt,
        error: payload.error || payload.message || status,
      };
      throw error;
    }

    const pollDelay = Math.min(pollIntervalBaseMs * attempt, 5000);
    if (pollDelay) await sleep(pollDelay);
  }

  const error = new Error("PDF-app OCR timeout while waiting for async job.");
  error.diagnostics = {
    final_status: "ocr_failed",
    error_type: "ocr_infrastructure",
    endpoint: jobEndpoint,
    mode: "async",
    poll_attempts: attempt,
    poll_http_attempts: httpAttempts,
    poll_duration_ms: Date.now() - startedAt,
    error: error.message,
  };
  throw error;
}

export async function ocrFileUrlWithPdfApp({ fileUrl, fileName }) {
  const apiKey = await getEffectiveSetting("PDF_APP_API_KEY", "pdf_app_api_key");
  const ocrEndpoint = await getEffectiveSetting("PDF_APP_OCR_ENDPOINT", "pdf_app_ocr_endpoint");
  const jobEndpoint = await getEffectiveSetting("PDF_APP_JOB_ENDPOINT", "pdf_app_job_endpoint");
  const retryCount = await getNumericSetting("PDF_APP_RETRY_COUNT", "pdf_app_retry_count", DEFAULT_RETRY_COUNT, {
    min: 0,
    max: 5,
  });
  const retryBaseDelayMs = await getNumericSetting(
    "PDF_APP_RETRY_BASE_DELAY_MS",
    "pdf_app_retry_base_delay_ms",
    DEFAULT_RETRY_BASE_DELAY_MS,
    { min: 0, max: 30000 }
  );
  const pollTimeoutMs = await getNumericSetting(
    "PDF_APP_POLL_TIMEOUT_MS",
    "pdf_app_poll_timeout_ms",
    DEFAULT_POLL_TIMEOUT_MS,
    { min: 1000, max: 600000 }
  );
  const pollIntervalBaseMs = await getNumericSetting(
    "PDF_APP_POLL_INTERVAL_BASE_MS",
    "pdf_app_poll_interval_base_ms",
    DEFAULT_POLL_INTERVAL_BASE_MS,
    { min: 0, max: 30000 }
  );

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

  const asyncMode = await getPdfAppAsyncMode(jobEndpoint);
  const mode = asyncMode ? "async" : "sync";
  const totalStartedAt = Date.now();
  const body = buildPdfAppOcrPayload(fileUrl, { async: asyncMode });

  const initial = await fetchJsonWithDiagnostics({
    endpoint: ocrEndpoint,
    options: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...authHeaders(apiKey),
      },
      body: JSON.stringify(body),
    },
    retryCount,
    retryBaseDelayMs,
  });
  if (initial.network_error) {
    const message = initial.network_error.message || String(initial.network_error);
    const error = new Error(`PDF-app OCR request failed: ${message}`);
    error.diagnostics = buildPdfAppErrorDiagnostics({
      endpoint: ocrEndpoint,
      requestBody: body,
      response: null,
      responsePayload: {},
      requestDurationMs: initial.request_duration_ms,
      attempts: initial.attempts,
      mode,
      error: message,
    });
    throw error;
  }

  const { response, payload } = initial;

  if (!response.ok) {
    const error = new Error(`PDF-app OCR status ${response.status}: ${responseErrorDetail(payload, response.statusText)}`);
    error.diagnostics = buildPdfAppErrorDiagnostics({
      endpoint: ocrEndpoint,
      requestBody: body,
      response,
      responsePayload: payload,
      requestDurationMs: initial.request_duration_ms,
      attempts: initial.attempts,
      mode,
    });
    throw error;
  }

  const text = extractPdfAppText(payload);
  if (text) {
    const quality = assessPdfAppOcrQuality(text, payload);
    return {
      ok: true,
      text,
      payload,
      quality,
      diagnostics: {
        mode,
        final_status: quality.status,
        request_duration_ms: initial.request_duration_ms,
        initial_request_duration_ms: initial.request_duration_ms,
        attempts: initial.attempts,
        total_duration_ms: Date.now() - totalStartedAt,
        ...quality,
      },
    };
  }

  const jobId = findJobId(payload);
  if (jobId && jobEndpoint) {
    const job = await pollPdfAppJob({
      jobId,
      apiKey,
      jobEndpoint,
      timeoutMs: pollTimeoutMs,
      pollIntervalBaseMs,
      retryCount,
      retryBaseDelayMs,
    });
    const quality = assessPdfAppOcrQuality(job.text, job.payload);
    return {
      ok: true,
      text: job.text,
      payload: job.payload,
      job_id: jobId,
      attempts: initial.attempts,
      poll_attempts: job.attempts,
      quality,
      diagnostics: {
        mode: "async",
        final_status: quality.status,
        request_duration_ms: initial.request_duration_ms,
        initial_request_duration_ms: initial.request_duration_ms,
        attempts: initial.attempts,
        poll_attempts: job.attempts,
        poll_http_attempts: job.http_attempts,
        poll_duration_ms: job.poll_duration_ms,
        total_duration_ms: Date.now() - totalStartedAt,
        ...quality,
      },
    };
  }

  const quality = assessPdfAppOcrQuality("", payload);
  return {
    ok: false,
    reason: jobId
      ? "PDF-app ha restituito un job asincrono ma PDF_APP_JOB_ENDPOINT non e configurato."
      : "PDF-app non ha restituito testo OCR.",
    payload,
    job_id: jobId || null,
    quality,
    diagnostics: {
      mode,
      final_status: quality.status,
      request_duration_ms: initial.request_duration_ms,
      initial_request_duration_ms: initial.request_duration_ms,
      attempts: initial.attempts,
      total_duration_ms: Date.now() - totalStartedAt,
      ...quality,
    },
  };
}
