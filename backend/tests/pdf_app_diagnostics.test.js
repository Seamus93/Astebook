import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPdfAppErrorDiagnostics,
  buildPdfAppOcrPayload,
  extractPdfAppText,
  ocrFileUrlWithPdfApp,
} from "../lib/pdf_app.js";

function jsonResponse(status, payload, statusText = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => JSON.stringify(payload),
  };
}

async function withPdfAppEnv(settings, fn) {
  const previousEnv = {};
  const keys = [
    "PDF_APP_API_KEY",
    "PDF_APP_OCR_ENDPOINT",
    "PDF_APP_JOB_ENDPOINT",
    "PDF_APP_ASYNC_MODE",
    "PDF_APP_POLL_TIMEOUT_MS",
    "PDF_APP_POLL_INTERVAL_BASE_MS",
    "PDF_APP_RETRY_COUNT",
    "PDF_APP_RETRY_BASE_DELAY_MS",
  ];
  keys.forEach((key) => {
    previousEnv[key] = process.env[key];
    if (settings[key] === undefined) delete process.env[key];
    else process.env[key] = settings[key];
  });
  const previousFetch = globalThis.fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = previousFetch;
    keys.forEach((key) => {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    });
  }
}

test("PDF-app error diagnostics mask OCR input tokens", () => {
  const token = "aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb";
  const requestBody = buildPdfAppOcrPayload(
    `http://31.220.76.233:3000/api/v1/ocr-inputs/${token}/file.pdf`
  );

  const diagnostics = buildPdfAppErrorDiagnostics({
    endpoint: "https://api.pdf-app.net/ocr",
    requestBody,
    response: { status: 403 },
    responsePayload: { text: "Forbidden" },
  });

  assert.equal(diagnostics.status, 403);
  assert.equal(diagnostics.endpoint, "https://api.pdf-app.net/ocr");
  assert.deepEqual(diagnostics.file_url_origins, ["http://31.220.76.233:3000"]);
  assert.deepEqual(diagnostics.file_url_schemes, ["http"]);
  assert.deepEqual(diagnostics.file_url_ports, ["3000"]);
  assert.deepEqual(diagnostics.file_url_paths, ["/api/v1/ocr-inputs/aaaa***bbbb/file.pdf"]);
  assert.equal(JSON.stringify(diagnostics).includes(token), false);
  assert.equal(JSON.stringify(diagnostics).includes("pdf-key"), false);
});

test("PDF-app text extraction concatenates all OCR page results", () => {
  const payload = {
    message: "OCR completed successfully.",
    extraction_results: [
      {
        file: "https://example.test/proposta.pdf",
        result: [
          { page: 2, region_index: null, result: "Pagina due con prezzo Euro 60.000." },
          { page: 1, region_index: null, result: "Pagina uno con proponente DE CHI." },
          { page: 3, region_index: null, result: "Pagina tre con IBAN IT60X0542811101000000123456." },
        ],
      },
    ],
  };

  const text = extractPdfAppText(payload);

  assert.equal(
    text,
    [
      "Pagina uno con proponente DE CHI.",
      "Pagina due con prezzo Euro 60.000.",
      "Pagina tre con IBAN IT60X0542811101000000123456.",
    ].join("\n\n")
  );
});

test("PDF-app sync success preserves multi-page extraction_results order", async () => {
  await withPdfAppEnv({
    PDF_APP_API_KEY: "pdf-key",
    PDF_APP_OCR_ENDPOINT: "https://pdf-app.example/ocr",
    PDF_APP_ASYNC_MODE: "false",
  }, async () => {
    globalThis.fetch = async (_url, options = {}) => {
      const body = JSON.parse(options.body || "{}");
      assert.equal(body.async, false);
      return jsonResponse(200, {
        extraction_results: [
          {
            result: [
              { page: 3, region_index: 0, result: "Pagina tre con IBAN IT60X0542811101000000123456." },
              { page: 1, region_index: 0, result: "Pagina uno con proponente Mario Rossi." },
              { page: 2, region_index: 0, result: "Pagina due con prezzo Euro 120.000." },
            ],
          },
        ],
      });
    };

    const result = await ocrFileUrlWithPdfApp({
      fileUrl: "https://astebook.example/api/v1/ocr-inputs/aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb/file.pdf",
      fileName: "file.pdf",
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.mode, "sync");
    assert.equal(result.diagnostics.final_status, "ocr_completed");
    assert.match(result.text, /^Pagina uno/);
    assert.match(result.text, /Pagina due/);
    assert.match(result.text, /Pagina tre/);
    assert.equal(result.text.indexOf("Pagina uno") < result.text.indexOf("Pagina due"), true);
    assert.equal(result.text.indexOf("Pagina due") < result.text.indexOf("Pagina tre"), true);
    assert.equal(typeof result.diagnostics.request_duration_ms, "number");
  });
});

test("PDF-app async accepted polls job until completed text", async () => {
  await withPdfAppEnv({
    PDF_APP_API_KEY: "pdf-key",
    PDF_APP_OCR_ENDPOINT: "https://pdf-app.example/ocr",
    PDF_APP_JOB_ENDPOINT: "https://pdf-app.example/jobs/{jobId}",
    PDF_APP_POLL_INTERVAL_BASE_MS: "0",
    PDF_APP_RETRY_BASE_DELAY_MS: "0",
  }, async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "POST") {
        const body = JSON.parse(options.body || "{}");
        assert.equal(body.async, true);
        return jsonResponse(202, { job_id: "job-123", status: "accepted" });
      }
      if (calls.filter((call) => !call.options.method).length === 1) {
        return jsonResponse(200, { status: "processing" });
      }
      return jsonResponse(200, {
        status: "completed",
        extraction_results: [{ result: [{ page: 1, region_index: 0, result: "Testo OCR completo ".repeat(20) }] }],
      });
    };

    const result = await ocrFileUrlWithPdfApp({
      fileUrl: "https://astebook.example/api/v1/ocr-inputs/aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb/file.pdf",
      fileName: "file.pdf",
    });

    assert.equal(result.ok, true);
    assert.equal(result.job_id, "job-123");
    assert.equal(result.diagnostics.mode, "async");
    assert.equal(result.diagnostics.poll_attempts, 2);
    assert.equal(typeof result.diagnostics.initial_request_duration_ms, "number");
    assert.equal(typeof result.diagnostics.poll_duration_ms, "number");
    assert.equal(typeof result.diagnostics.total_duration_ms, "number");
    assert.match(result.text, /Testo OCR completo/);
  });
});

test("PDF-app polling retries transient errors before success", async () => {
  await withPdfAppEnv({
    PDF_APP_API_KEY: "pdf-key",
    PDF_APP_OCR_ENDPOINT: "https://pdf-app.example/ocr",
    PDF_APP_JOB_ENDPOINT: "https://pdf-app.example/jobs",
    PDF_APP_POLL_INTERVAL_BASE_MS: "0",
    PDF_APP_RETRY_BASE_DELAY_MS: "0",
    PDF_APP_RETRY_COUNT: "2",
  }, async () => {
    let pollCalls = 0;
    globalThis.fetch = async (_url, options = {}) => {
      if (options.method === "POST") return jsonResponse(202, { job_id: "job-123" });
      pollCalls += 1;
      if (pollCalls === 1) return jsonResponse(503, { message: "temporarily unavailable" }, "Service Unavailable");
      return jsonResponse(200, {
        status: "completed",
        extraction_results: [{ result: [{ page: 1, region_index: 0, result: "Testo OCR dopo retry ".repeat(20) }] }],
      });
    };

    const result = await ocrFileUrlWithPdfApp({
      fileUrl: "https://astebook.example/api/v1/ocr-inputs/aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb/file.pdf",
      fileName: "file.pdf",
    });

    assert.equal(result.ok, true);
    assert.equal(pollCalls, 2);
    assert.equal(result.diagnostics.poll_http_attempts, 2);
  });
});

test("PDF-app OCR 504 retries with structured failed diagnostics", async () => {
  await withPdfAppEnv({
    PDF_APP_API_KEY: "pdf-key",
    PDF_APP_OCR_ENDPOINT: "https://pdf-app.example/ocr",
    PDF_APP_ASYNC_MODE: "false",
    PDF_APP_RETRY_BASE_DELAY_MS: "0",
    PDF_APP_RETRY_COUNT: "2",
  }, async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse(504, { message: "Endpoint request timed out" }, "Gateway Timeout");
    };

    await assert.rejects(
      () => ocrFileUrlWithPdfApp({
        fileUrl: "https://astebook.example/api/v1/ocr-inputs/aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb/file.pdf",
        fileName: "file.pdf",
      }),
      (error) => {
        assert.match(error.message, /504/);
        assert.equal(calls, 3);
        assert.equal(error.diagnostics.final_status, "ocr_failed");
        assert.equal(error.diagnostics.error_type, "ocr_infrastructure");
        assert.equal(error.diagnostics.status, 504);
        assert.equal(error.diagnostics.http_status, 504);
        assert.equal(error.diagnostics.mode, "sync");
        assert.equal(error.diagnostics.attempts, 3);
        assert.equal(typeof error.diagnostics.request_duration_ms, "number");
        assert.equal(JSON.stringify(error.diagnostics).includes("aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb"), false);
        assert.equal(JSON.stringify(error.diagnostics).includes("pdf-key"), false);
        return true;
      }
    );
  });
});

test("PDF-app OCR 401 is not retried", async () => {
  await withPdfAppEnv({
    PDF_APP_API_KEY: "pdf-key",
    PDF_APP_OCR_ENDPOINT: "https://pdf-app.example/ocr",
    PDF_APP_ASYNC_MODE: "false",
    PDF_APP_RETRY_BASE_DELAY_MS: "0",
    PDF_APP_RETRY_COUNT: "2",
  }, async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse(401, { message: "Unauthorized" }, "Unauthorized");
    };

    await assert.rejects(
      () => ocrFileUrlWithPdfApp({
        fileUrl: "https://astebook.example/api/v1/ocr-inputs/aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb/file.pdf",
        fileName: "file.pdf",
      }),
      (error) => {
        assert.equal(calls, 1);
        assert.equal(error.diagnostics.status, 401);
        assert.equal(error.diagnostics.attempts, 1);
        return true;
      }
    );
  });
});
