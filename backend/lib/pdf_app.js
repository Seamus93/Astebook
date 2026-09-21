import { getEffectiveSetting } from "./app_config.js";
import { maskOcrInputUrlPath } from "./ocr_input_store.js";
import http from "node:http";
import https from "node:https";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_POLL_TIMEOUT_MS = 90000;
const DEFAULT_POLL_INTERVAL_BASE_MS = 1000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_OCR_TIMEOUT_MS = 120000;
const DEFAULT_OCR_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_MAX_DELAY_MS = 30000;
const MAX_RETRY_AFTER_MS = 30000;

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

  if (extractionResults.length) return pageTexts.join("\n\n");
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
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
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
  return [408, 429, 500, 502, 503, 504].includes(Number(status));
}

function classifyNetworkError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  if (name === "AbortError" || code === "ABORT_ERR") return "client_timeout";
  if (["ETIMEDOUT", "ECONNABORTED", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code)) {
    return "client_timeout";
  }
  if (["ECONNRESET", "EPIPE"].includes(code) || message.includes("socket hang up") || message.includes("econnreset")) {
    return "network_reset";
  }
  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("headers timeout") ||
    message.includes("connect timeout")
  ) {
    return "client_timeout";
  }
  return "network_error";
}

function isTransientNetworkError(error) {
  return ["client_timeout", "network_reset"].includes(classifyNetworkError(error));
}

function classifyHttpStatus(status) {
  return status ? `http_${Number(status)}` : null;
}

function mapPublicOcrStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("completed")) return "completed";
  if (value.includes("empty")) return "failed";
  if (value.includes("failed") || value.includes("error")) return "failed";
  if (value.includes("suspicious") || value.includes("short")) return "completed";
  return value || null;
}

function retryAfterMs(response) {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, MAX_RETRY_AFTER_MS));
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, Math.min(dateMs - Date.now(), MAX_RETRY_AFTER_MS));
}

function retryDelayMs(attempt, baseDelayMs, maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS) {
  if (!baseDelayMs) return 0;
  const exponential = Math.min(baseDelayMs * 2 ** Math.max(0, attempt - 1), maxDelayMs);
  const jitter = Math.floor(Math.random() * Math.min(250, Math.max(1, Math.floor(exponential * 0.15))));
  return Math.min(exponential + jitter, maxDelayMs);
}

function isNativeFetchImplementation() {
  return /\[native code\]|\blazyUndici\b|\binternal\/deps\/undici\b/.test(String(globalThis.fetch || ""));
}

function headerLookup(headers = {}) {
  const entries = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), value])
  );
  return {
    get: (name) => entries.get(String(name || "").toLowerCase()) ?? null,
  };
}

function nodeHttpJsonRequest(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(endpoint);
    const client = parsed.protocol === "http:" ? http : https;
    const body = options.body ? String(options.body) : "";
    const headers = {
      ...(options.headers || {}),
    };
    if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const request = client.request(
      parsed,
      {
        method: options.method || "GET",
        headers,
        signal: options.signal,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            statusText: response.statusMessage || "",
            headers: headerLookup(response.headers),
            text: async () => text,
          });
        });
      }
    );
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function httpJsonRequest(endpoint, options = {}) {
  const method = String(options?.method || "GET").toUpperCase();
  if (method === "GET" && options?.body && isNativeFetchImplementation()) {
    return nodeHttpJsonRequest(endpoint, options);
  }
  return fetch(endpoint, options);
}

async function fetchJsonWithDiagnostics({
  endpoint,
  options,
  retryCount,
  maxAttempts,
  retryBaseDelayMs,
  retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
  timeoutMs = 0,
  retryTransient = true,
  label = "PDF-app request",
}) {
  const attemptsLimit = Math.max(1, Number.isFinite(maxAttempts) ? maxAttempts : Number(retryCount || 0) + 1);
  let attempt = 0;
  let lastNetworkError = null;
  const attemptDiagnostics = [];

  while (attempt < attemptsLimit) {
    attempt += 1;
    const startedAt = Date.now();
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    timeout?.unref?.();
    try {
      console.info(`${label} attempt ${attempt}/${attemptsLimit}`);
      const response = await httpJsonRequest(endpoint, {
        ...options,
        signal: controller?.signal || options?.signal,
      });
      const durationMs = Date.now() - startedAt;
      if (timeout) clearTimeout(timeout);
      const payload = await parseJsonResponse(response);
      const retryable = retryTransient && isTransientHttpStatus(response.status);
      const retryAfterDelay = retryAfterMs(response);
      const shouldRetry = retryable && attempt < attemptsLimit;
      const delay = shouldRetry
        ? retryAfterDelay ?? retryDelayMs(attempt, retryBaseDelayMs, retryMaxDelayMs)
        : null;
      attemptDiagnostics.push({
        attempt,
        result: response.ok ? "completed" : classifyHttpStatus(response.status),
        http_status: response.status,
        duration_ms: durationMs,
        retryable,
        retry_delay_ms: delay,
        retry_after_used: shouldRetry && retryAfterDelay !== null,
      });
      if (shouldRetry) {
        console.warn(`${label} attempt ${attempt}/${attemptsLimit} -> HTTP ${response.status}; retry in ${delay}ms`);
        if (delay) await sleep(delay);
        continue;
      }
      console.info(`${label} attempt ${attempt}/${attemptsLimit} -> ${response.ok ? "success" : `HTTP ${response.status}`}`);
      return {
        response,
        payload,
        attempts: attempt,
        attempt_diagnostics: attemptDiagnostics,
        request_duration_ms: durationMs,
        transient_retried: attempt > 1,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (timeout) clearTimeout(timeout);
      lastNetworkError = error;
      const result = classifyNetworkError(error);
      const retryable = retryTransient && isTransientNetworkError(error);
      const shouldRetry = retryable && attempt < attemptsLimit;
      const delay = shouldRetry ? retryDelayMs(attempt, retryBaseDelayMs, retryMaxDelayMs) : null;
      attemptDiagnostics.push({
        attempt,
        result,
        duration_ms: durationMs,
        retryable,
        retry_delay_ms: delay,
      });
      if (!shouldRetry) {
        console.warn(`${label} attempt ${attempt}/${attemptsLimit} -> ${result}`);
        return {
          response: null,
          payload: {},
          attempts: attempt,
          attempt_diagnostics: attemptDiagnostics,
          request_duration_ms: durationMs,
          network_error: error,
          final_error_type: result,
          transient_retried: attempt > 1,
        };
      }
      console.warn(`${label} attempt ${attempt}/${attemptsLimit} -> ${result}; retry in ${delay}ms`);
      if (delay) await sleep(delay);
    }
  }

  return {
    response: null,
    payload: {},
    attempts: attempt,
    attempt_diagnostics: attemptDiagnostics,
    request_duration_ms: null,
    network_error: lastNetworkError,
    final_error_type: lastNetworkError ? classifyNetworkError(lastNetworkError) : null,
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
      reason: "ocr_empty_result",
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
  attemptDiagnostics = [],
  finalErrorType = null,
}) {
  const fileUrls = Array.isArray(requestBody?.fileUrls) ? requestBody.fileUrls : [];
  const fileUrlDetails = fileUrls.map((fileUrl) => safeFileUrlDiagnostics(fileUrl));
  const finalAttempt = Array.isArray(attemptDiagnostics) ? attemptDiagnostics.at(-1) : null;
  const retryExhausted = Array.isArray(attemptDiagnostics) &&
    attemptDiagnostics.length > 1 &&
    finalAttempt?.retryable;
  const computedFinalErrorType =
    finalErrorType ||
    (response?.status ? classifyHttpStatus(response.status) : null) ||
    finalAttempt?.result ||
    null;
  return {
    status: response?.status || null,
    final_status: retryExhausted ? "ocr_retry_exhausted" : "ocr_failed",
    error_type: "ocr_infrastructure",
    final_error_type: computedFinalErrorType,
    http_status: response?.status || null,
    error: error || responseErrorDetail(responsePayload, response?.statusText || "PDF-app OCR request failed"),
    request_duration_ms: requestDurationMs,
    attempts,
    ocr_attempt_count: attempts,
    ocr_attempts: attemptDiagnostics,
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

export function buildPdfAppJobPollRequest({ jobEndpoint, jobId, apiKey }) {
  const endpoint = String(jobEndpoint || "");
  const pdfAppAsyncJobEndpoint = (() => {
    try {
      const parsed = new URL(endpoint);
      return parsed.hostname === "api.pdf-app.net" && parsed.pathname.replace(/\/+$/, "") === "/async_jobid_check";
    } catch {
      return false;
    }
  })();

  if (pdfAppAsyncJobEndpoint) {
    return {
      endpoint,
      options: {
        method: "GET",
        headers: {
          Authorization: authHeaders(apiKey).Authorization,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ job_id: jobId }),
      },
      contract: "pdf_app_async_jobid_check",
    };
  }

  const genericEndpoint = endpoint.includes("{jobId}")
    ? endpoint.replaceAll("{jobId}", encodeURIComponent(jobId))
    : `${endpoint.replace(/\/$/, "")}/${encodeURIComponent(jobId)}`;
  return {
    endpoint: genericEndpoint,
    options: {
      headers: {
        accept: "application/json",
        ...authHeaders(apiKey),
      },
    },
    contract: "generic_job_endpoint",
  };
}

async function pollPdfAppJob({
  jobId,
  apiKey,
  jobEndpoint,
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  pollIntervalBaseMs = DEFAULT_POLL_INTERVAL_BASE_MS,
  retryCount = DEFAULT_RETRY_COUNT,
  maxAttempts = DEFAULT_OCR_MAX_ATTEMPTS,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  retryMaxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS,
  requestTimeoutMs = DEFAULT_OCR_TIMEOUT_MS,
}) {
  if (!jobId || !jobEndpoint) return null;
  const startedAt = Date.now();
  let attempt = 0;
  let httpAttempts = 0;

  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    const pollRequest = buildPdfAppJobPollRequest({ jobEndpoint, jobId, apiKey });
    const endpoint = pollRequest.endpoint;
    const fetchResult = await fetchJsonWithDiagnostics({
      endpoint,
      options: pollRequest.options,
      retryCount,
      maxAttempts,
      retryBaseDelayMs,
      retryMaxDelayMs,
      timeoutMs: requestTimeoutMs,
      label: "PDF-app OCR job poll",
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
        ocr_attempt_count: fetchResult.attempts,
        ocr_attempts: fetchResult.attempt_diagnostics || [],
        request_duration_ms: fetchResult.request_duration_ms,
        final_error_type: fetchResult.final_error_type || classifyNetworkError(fetchResult.network_error),
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
        ocr_attempt_count: fetchResult.attempts,
        ocr_attempts: fetchResult.attempt_diagnostics || [],
        request_duration_ms: fetchResult.request_duration_ms,
        http_status: response.status,
        status: response.status,
        final_error_type: classifyHttpStatus(response.status),
        error: responseErrorDetail(payload, response.statusText),
        response_body: compactResponseBody(payload),
      };
      throw error;
    }

    const text = extractPdfAppText(payload);
    const status = String(payload.status || payload.state || payload.data?.status || "").toLowerCase();
    const hasExtractionResults = Array.isArray(payload?.extraction_results) || Array.isArray(payload?.data?.extraction_results);
    if (text.trim()) {
      return {
        text,
        payload,
        attempts: attempt,
        http_attempts: httpAttempts,
        poll_duration_ms: Date.now() - startedAt,
        final_status: status || null,
        credits_consumed: payload.CreditzConsumed ?? payload.credits_consumed ?? payload.data?.CreditzConsumed ?? null,
      };
    }

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
        ocr_final_status: status,
        error: payload.error || payload.message || status,
      };
      throw error;
    }

    if (status === "success" && hasExtractionResults) {
      return {
        text: "",
        payload,
        attempts: attempt,
        http_attempts: httpAttempts,
        poll_duration_ms: Date.now() - startedAt,
        final_status: status,
        credits_consumed: payload.CreditzConsumed ?? payload.credits_consumed ?? payload.data?.CreditzConsumed ?? null,
      };
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
  const maxAttempts = await getNumericSetting(
    "PDF_APP_OCR_MAX_ATTEMPTS",
    "pdf_app_ocr_max_attempts",
    retryCount + 1 || DEFAULT_OCR_MAX_ATTEMPTS,
    { min: 1, max: 6 }
  );
  const legacyRetryBaseDelayMs = await getNumericSetting(
    "PDF_APP_RETRY_BASE_DELAY_MS",
    "pdf_app_retry_base_delay_ms",
    DEFAULT_RETRY_BASE_DELAY_MS,
    { min: 0, max: 30000 }
  );
  const retryBaseDelayMs = await getNumericSetting(
    "PDF_APP_OCR_RETRY_BASE_MS",
    "pdf_app_ocr_retry_base_ms",
    legacyRetryBaseDelayMs,
    { min: 0, max: 30000 }
  );
  const retryMaxDelayMs = await getNumericSetting(
    "PDF_APP_OCR_RETRY_MAX_MS",
    "pdf_app_ocr_retry_max_ms",
    DEFAULT_RETRY_MAX_DELAY_MS,
    { min: 0, max: 120000 }
  );
  const ocrTimeoutMs = await getNumericSetting(
    "PDF_APP_OCR_TIMEOUT_MS",
    "pdf_app_ocr_timeout_ms",
    DEFAULT_OCR_TIMEOUT_MS,
    { min: 1000, max: 600000 }
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
    maxAttempts,
    retryBaseDelayMs,
    retryMaxDelayMs,
    timeoutMs: ocrTimeoutMs,
    label: "PDF-app OCR",
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
      attemptDiagnostics: initial.attempt_diagnostics || [],
      finalErrorType: initial.final_error_type || classifyNetworkError(initial.network_error),
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
      attemptDiagnostics: initial.attempt_diagnostics || [],
      finalErrorType: classifyHttpStatus(response.status),
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
        ocr_provider: "pdf-app",
        ocr_mode: mode,
        ocr_start_status: response.status,
        ocr_final_status: payload.status || payload.state || quality.status,
        ocr_text_length: text.length,
        ocr_pages: quality.page_count,
        credits_consumed: payload.CreditzConsumed ?? payload.credits_consumed ?? null,
        ocr_duration_ms: Date.now() - totalStartedAt,
        ocr_status: quality.status === "ocr_completed" ? "completed" : mapPublicOcrStatus(quality.status),
        final_status: quality.status,
        request_duration_ms: initial.request_duration_ms,
        initial_request_duration_ms: initial.request_duration_ms,
        attempts: initial.attempts,
        ocr_attempt_count: initial.attempts,
        ocr_attempts: initial.attempt_diagnostics || [],
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
      maxAttempts,
      retryBaseDelayMs,
      retryMaxDelayMs,
      requestTimeoutMs: ocrTimeoutMs,
    });
    const quality = assessPdfAppOcrQuality(job.text, job.payload);
    const ok = quality.status === "ocr_completed" || quality.status === "ocr_suspicious";
    return {
      ok,
      text: job.text,
      payload: job.payload,
      job_id: jobId,
      reason: ok ? null : quality.reason,
      attempts: initial.attempts,
      poll_attempts: job.attempts,
      quality,
      diagnostics: {
        mode: "async",
        ocr_provider: "pdf-app",
        ocr_mode: "async",
        ocr_start_status: response.status,
        ocr_job_id: jobId,
        ocr_poll_attempts: job.attempts,
        ocr_final_status: job.final_status || job.payload?.status || quality.status,
        ocr_text_length: job.text.length,
        ocr_pages: quality.page_count,
        credits_consumed: job.credits_consumed,
        ocr_duration_ms: Date.now() - totalStartedAt,
        ocr_status: ok ? "completed" : "failed",
        final_status: quality.status,
        request_duration_ms: initial.request_duration_ms,
        initial_request_duration_ms: initial.request_duration_ms,
        attempts: initial.attempts,
        ocr_attempt_count: initial.attempts,
        ocr_attempts: initial.attempt_diagnostics || [],
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
      : quality.reason,
    payload,
    job_id: jobId || null,
    quality,
    diagnostics: {
      mode,
      ocr_provider: "pdf-app",
      ocr_mode: mode,
      ocr_start_status: response.status,
      ocr_job_id: jobId || null,
      ocr_final_status: payload.status || payload.state || quality.status,
      ocr_text_length: 0,
      ocr_pages: quality.page_count,
      credits_consumed: payload.CreditzConsumed ?? payload.credits_consumed ?? null,
      ocr_duration_ms: Date.now() - totalStartedAt,
      ocr_status: "failed",
      final_status: quality.status,
      request_duration_ms: initial.request_duration_ms,
      initial_request_duration_ms: initial.request_duration_ms,
      attempts: initial.attempts,
      ocr_attempt_count: initial.attempts,
      ocr_attempts: initial.attempt_diagnostics || [],
      total_duration_ms: Date.now() - totalStartedAt,
      ...quality,
    },
  };
}
