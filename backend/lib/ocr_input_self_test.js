import { maskOcrInputUrlPath } from "./ocr_input_store.js";

export function ocrInputSelfTestEnabled() {
  return ["1", "true", "yes"].includes(String(process.env.OCR_INPUT_SELF_TEST || "").trim().toLowerCase());
}

function headerValue(headers, key) {
  return headers?.get?.(key) || headers?.get?.(key.toLowerCase()) || null;
}

function safeRedirectLocation(location) {
  if (!location) return null;
  try {
    const parsed = new URL(location);
    return {
      origin: parsed.origin,
      path: maskOcrInputUrlPath(parsed.href),
    };
  } catch {
    return {
      origin: null,
      path: null,
    };
  }
}

export async function selfTestOcrInputUrl({ url, expectedContentType } = {}) {
  const startedAt = Date.now();
  const result = {
    status: null,
    content_type: null,
    content_length: null,
    redirected: false,
    redirect_location: null,
    duration_ms: null,
    pdf_header_valid: null,
    error: null,
  };

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: expectedContentType || "application/octet-stream",
      },
    });

    result.status = response.status;
    result.content_type = headerValue(response.headers, "content-type");
    result.content_length = headerValue(response.headers, "content-length");
    result.redirected = response.status >= 300 && response.status < 400;
    result.redirect_location = safeRedirectLocation(headerValue(response.headers, "location"));

    const buffer = Buffer.from(await response.arrayBuffer());
    if (String(expectedContentType || "").toLowerCase().includes("pdf")) {
      result.pdf_header_valid = buffer.subarray(0, 4).toString("utf8") === "%PDF";
    }
  } catch (error) {
    result.error = error.message || String(error);
  } finally {
    result.duration_ms = Date.now() - startedAt;
  }

  return result;
}
