import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runtimeDir = await mkdtemp(join(tmpdir(), "astebook-pipeline-test-"));
process.env.RUNTIME_DIR = runtimeDir;
process.env.ASTEBOOK_AI_MOCK = "1";
process.env.GEOCODER_PROVIDER = "none";

const { createAiExtractionPipeline } = await import("../lib/extraction_pipeline.js");

test.after(async () => {
  await rm(runtimeDir, { recursive: true, force: true });
});

test("reprocess reuses cached attachment text instead of reparsing the same file", async () => {
  const buffer = Buffer.from("this is not a valid docx");
  const cacheKey = createHash("sha256").update(buffer).digest("hex");
  const steps = [];
  const events = new Map([["cache-test", { id: "cache-test", steps }]]);
  const pipeline = createAiExtractionPipeline({
    autoSendMergedDocumentEmail: async () => null,
    getProcessingEvent: async (id) => events.get(id) || null,
    updateProcessingEvent: async (id, patch = {}, step = null) => {
      const current = events.get(id) || { id, steps: [] };
      const next = {
        ...current,
        ...patch,
        steps: step ? [...(current.steps || []), step] : current.steps || [],
      };
      events.set(id, next);
      return next;
    },
  });

  const result = await pipeline({
    eventId: "cache-test",
    body: { subject: "CACHE_TEST" },
    files: [
      {
        fieldname: "email_attachment_1",
        originalname: "Proposta cache.docx",
        mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer,
      },
    ],
    previousResult: {
      attachment_text_cache: {
        [cacheKey]: {
          file_name: "Proposta cache.docx",
          format: "docx",
          text: "Proposta irrevocabile valida gia estratta.",
          text_length: 41,
          source: "docx",
        },
      },
    },
    skipAutoSend: true,
  });

  assert.equal(result.extracted.proposta.file_pdf, "Proposta cache.docx");
  assert.ok(events.get("cache-test").steps.some((step) => step.message === "Attachment text cache hit"));
});

test("reprocess prunes short local PDF text cache entries", async () => {
  const buffer = Buffer.from("%PDF short");
  const cacheKey = createHash("sha256").update(buffer).digest("hex");
  const events = new Map([["short-pdf-cache-test", { id: "short-pdf-cache-test", steps: [] }]]);
  const pipeline = createAiExtractionPipeline({
    autoSendMergedDocumentEmail: async () => null,
    getProcessingEvent: async (id) => events.get(id) || null,
    updateProcessingEvent: async (id, patch = {}, step = null) => {
      const current = events.get(id) || { id, steps: [] };
      const next = {
        ...current,
        ...patch,
        steps: step ? [...(current.steps || []), step] : current.steps || [],
      };
      events.set(id, next);
      return next;
    },
  });

  const result = await pipeline({
    eventId: "short-pdf-cache-test",
    body: { subject: "SHORT_PDF_CACHE_TEST" },
    files: [],
    previousResult: {
      attachment_text_cache: {
        [cacheKey]: {
          file_name: "Proposta scannerizzata.pdf",
          format: "pdf",
          text: "-- 1 of 10 --",
          text_length: 13,
          source: "local_pdf",
        },
      },
    },
    skipAutoSend: true,
  });

  assert.deepEqual(result.attachment_text_cache, {});
});

test("buffered PDF attachments do not fall back to local parsing when public OCR URL is missing", async () => {
  const previousProjectUrl = process.env.PROJECT_URL;
  const previousPublicUrl = process.env.PUBLIC_URL;
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const previousOcrPublicBaseUrl = process.env.OCR_PUBLIC_BASE_URL;
  const previousHealthUrl = process.env.HEALTH_URL;
  delete process.env.PROJECT_URL;
  delete process.env.PUBLIC_URL;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.OCR_PUBLIC_BASE_URL;
  delete process.env.HEALTH_URL;

  const events = new Map([["missing-ocr-url-test", { id: "missing-ocr-url-test", steps: [] }]]);
  const pipeline = createAiExtractionPipeline({
    autoSendMergedDocumentEmail: async () => null,
    getProcessingEvent: async (id) => events.get(id) || null,
    updateProcessingEvent: async (id, patch = {}, step = null) => {
      const current = events.get(id) || { id, steps: [] };
      const next = {
        ...current,
        ...patch,
        steps: step ? [...(current.steps || []), step] : current.steps || [],
      };
      events.set(id, next);
      return next;
    },
  });

  try {
    const result = await pipeline({
      eventId: "missing-ocr-url-test",
      body: { subject: "MISSING_OCR_URL_TEST" },
      files: [
        {
          fieldname: "email_attachment_1",
          originalname: "Proposta senza url pubblico.pdf",
          mimetype: "application/pdf",
          buffer: Buffer.from("%PDF scannerizzato"),
        },
      ],
      skipAutoSend: true,
    });

    const steps = events.get("missing-ocr-url-test").steps;
    assert.ok(steps.some((step) => step.message === "PDF-app OCR input unavailable"));
    assert.equal(steps.some((step) => step.message === "Local PDF text extraction started"), false);
    assert.equal(result.ocr_summary.files["Proposta senza url pubblico.pdf"].status, "pdf_app_input_unavailable");
  } finally {
    if (previousProjectUrl === undefined) delete process.env.PROJECT_URL;
    else process.env.PROJECT_URL = previousProjectUrl;
    if (previousPublicUrl === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = previousPublicUrl;
    if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    if (previousOcrPublicBaseUrl === undefined) delete process.env.OCR_PUBLIC_BASE_URL;
    else process.env.OCR_PUBLIC_BASE_URL = previousOcrPublicBaseUrl;
    if (previousHealthUrl === undefined) delete process.env.HEALTH_URL;
    else process.env.HEALTH_URL = previousHealthUrl;
  }
});

test("reprocess ignores local PDF cache and runs PDF-app OCR", async () => {
  const previousProjectUrl = process.env.PROJECT_URL;
  const previousPdfKey = process.env.PDF_APP_API_KEY;
  const previousPdfEndpoint = process.env.PDF_APP_OCR_ENDPOINT;
  const previousFetch = globalThis.fetch;
  process.env.PROJECT_URL = "https://astebook.example";
  process.env.PDF_APP_API_KEY = "pdf-key";
  process.env.PDF_APP_OCR_ENDPOINT = "https://pdf-app.example/ocr";

  const buffer = Buffer.from("%PDF valid cached local parser text");
  const cacheKey = createHash("sha256").update(buffer).digest("hex");
  let pdfAppCalled = false;
  globalThis.fetch = async (_url, options = {}) => {
    pdfAppCalled = true;
    const body = JSON.parse(options.body || "{}");
    assert.match(body.fileUrls?.[0], /^https:\/\/astebook\.example\/api\/v1\/ocr-inputs\//);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        text: "Testo OCR PDF-app prioritario ".repeat(40),
      }),
    };
  };

  const events = new Map([["local-pdf-cache-ignored-test", { id: "local-pdf-cache-ignored-test", steps: [] }]]);
  const pipeline = createAiExtractionPipeline({
    autoSendMergedDocumentEmail: async () => null,
    getProcessingEvent: async (id) => events.get(id) || null,
    updateProcessingEvent: async (id, patch = {}, step = null) => {
      const current = events.get(id) || { id, steps: [] };
      const next = {
        ...current,
        ...patch,
        steps: step ? [...(current.steps || []), step] : current.steps || [],
      };
      events.set(id, next);
      return next;
    },
  });

  try {
    const result = await pipeline({
      eventId: "local-pdf-cache-ignored-test",
      body: { subject: "LOCAL_PDF_CACHE_IGNORED_TEST" },
      files: [
        {
          fieldname: "email_attachment_1",
          originalname: "Proposta cache locale.pdf",
          mimetype: "application/pdf",
          buffer,
        },
      ],
      previousResult: {
        attachment_text_cache: {
          [cacheKey]: {
            file_name: "Proposta cache locale.pdf",
            format: "pdf",
            text: "Vecchio testo local_pdf ".repeat(80),
            text_length: "Vecchio testo local_pdf ".repeat(80).length,
            source: "local_pdf",
          },
        },
      },
      skipAutoSend: true,
    });

    assert.equal(pdfAppCalled, true);
    assert.equal(result.extracted.proposta.raw_length, "Testo OCR PDF-app prioritario ".repeat(40).length);
    assert.ok(events.get("local-pdf-cache-ignored-test").steps.some((step) => step.message === "PDF-app OCR started"));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProjectUrl === undefined) delete process.env.PROJECT_URL;
    else process.env.PROJECT_URL = previousProjectUrl;
    if (previousPdfKey === undefined) delete process.env.PDF_APP_API_KEY;
    else process.env.PDF_APP_API_KEY = previousPdfKey;
    if (previousPdfEndpoint === undefined) delete process.env.PDF_APP_OCR_ENDPOINT;
    else process.env.PDF_APP_OCR_ENDPOINT = previousPdfEndpoint;
  }
});

test("buffered PDF attachments are exposed to PDF-app OCR through a temporary URL", async () => {
  const previousProjectUrl = process.env.PROJECT_URL;
  const previousPdfKey = process.env.PDF_APP_API_KEY;
  const previousPdfEndpoint = process.env.PDF_APP_OCR_ENDPOINT;
  const previousFetch = globalThis.fetch;
  const previousMock = process.env.ASTEBOOK_AI_MOCK;
  process.env.PROJECT_URL = "https://astebook.example";
  process.env.PDF_APP_API_KEY = "pdf-key";
  process.env.PDF_APP_OCR_ENDPOINT = "https://pdf-app.example/ocr";
  process.env.ASTEBOOK_AI_MOCK = "1";

  let requestedFileUrl = "";
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    requestedFileUrl = body.fileUrls?.[0];
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        text: "Proposta OCR vera ".repeat(80),
      }),
    };
  };

  const events = new Map([["buffer-pdf-ocr-test", { id: "buffer-pdf-ocr-test", steps: [] }]]);
  const pipeline = createAiExtractionPipeline({
    autoSendMergedDocumentEmail: async () => null,
    getProcessingEvent: async (id) => events.get(id) || null,
    updateProcessingEvent: async (id, patch = {}, step = null) => {
      const current = events.get(id) || { id, steps: [] };
      const next = {
        ...current,
        ...patch,
        steps: step ? [...(current.steps || []), step] : current.steps || [],
      };
      events.set(id, next);
      return next;
    },
  });

  try {
    const result = await pipeline({
      eventId: "buffer-pdf-ocr-test",
      body: { subject: "BUFFER_PDF_OCR_TEST" },
      files: [
        {
          fieldname: "email_attachment_1",
          originalname: "Polis Proposta test.pdf",
          mimetype: "application/pdf",
          buffer: Buffer.from("%PDF scannerizzato"),
        },
      ],
      skipAutoSend: true,
    });

    assert.match(requestedFileUrl, /^https:\/\/astebook\.example\/api\/v1\/ocr-inputs\/[a-f0-9]{32}\/Polis_Proposta_test\.pdf$/);
    assert.equal(result.extracted.proposta.raw_length, "Proposta OCR vera ".repeat(80).length);
    assert.ok(Object.values(result.attachment_text_cache).some((entry) => entry.source === "pdf_app"));
    assert.ok(Object.values(result.attachment_text_cache).some((entry) => entry.parser_version === "pdf_app_multi_page_v1"));
    assert.equal(result.extraction_diagnostics.ocr_texts[0].file_name, "Polis Proposta test.pdf");
    assert.equal(result.extraction_diagnostics.ocr_texts[0].source, "pdf_app");
    assert.equal(result.extraction_diagnostics.proposta_agent_runs[0].agent_id, "proposta");
    assert.equal(result.extraction_diagnostics.proposta_agent_runs[0].schema_name, "PropostaSchema");
    assert.ok(Array.isArray(result.extraction_diagnostics.proposta_field_matrix));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProjectUrl === undefined) delete process.env.PROJECT_URL;
    else process.env.PROJECT_URL = previousProjectUrl;
    if (previousPdfKey === undefined) delete process.env.PDF_APP_API_KEY;
    else process.env.PDF_APP_API_KEY = previousPdfKey;
    if (previousPdfEndpoint === undefined) delete process.env.PDF_APP_OCR_ENDPOINT;
    else process.env.PDF_APP_OCR_ENDPOINT = previousPdfEndpoint;
    if (previousMock === undefined) delete process.env.ASTEBOOK_AI_MOCK;
    else process.env.ASTEBOOK_AI_MOCK = previousMock;
  }
});

test("PDF-app OCR errors include plain response details", async () => {
  const previousProjectUrl = process.env.PROJECT_URL;
  const previousPdfKey = process.env.PDF_APP_API_KEY;
  const previousPdfEndpoint = process.env.PDF_APP_OCR_ENDPOINT;
  const previousFetch = globalThis.fetch;
  process.env.PROJECT_URL = "https://astebook.example";
  process.env.PDF_APP_API_KEY = "pdf-key";
  process.env.PDF_APP_OCR_ENDPOINT = "https://pdf-app.example/ocr";

  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    statusText: "Forbidden",
    text: async () => "Invalid file URL",
  });

  const events = new Map([["pdf-app-error-detail-test", { id: "pdf-app-error-detail-test", steps: [] }]]);
  const pipeline = createAiExtractionPipeline({
    autoSendMergedDocumentEmail: async () => null,
    getProcessingEvent: async (id) => events.get(id) || null,
    updateProcessingEvent: async (id, patch = {}, step = null) => {
      const current = events.get(id) || { id, steps: [] };
      const next = {
        ...current,
        ...patch,
        steps: step ? [...(current.steps || []), step] : current.steps || [],
      };
      events.set(id, next);
      return next;
    },
  });

  try {
    const result = await pipeline({
      eventId: "pdf-app-error-detail-test",
      body: { subject: "PDF_APP_ERROR_DETAIL_TEST" },
      files: [
        {
          fieldname: "email_attachment_1",
          originalname: "Proposta errore pdf-app.pdf",
          mimetype: "application/pdf",
          buffer: Buffer.from("%PDF scannerizzato"),
        },
      ],
      skipAutoSend: true,
    });

    assert.match(result.ocr_summary.files["Proposta errore pdf-app.pdf"].error, /Invalid file URL/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProjectUrl === undefined) delete process.env.PROJECT_URL;
    else process.env.PROJECT_URL = previousProjectUrl;
    if (previousPdfKey === undefined) delete process.env.PDF_APP_API_KEY;
    else process.env.PDF_APP_API_KEY = previousPdfKey;
    if (previousPdfEndpoint === undefined) delete process.env.PDF_APP_OCR_ENDPOINT;
    else process.env.PDF_APP_OCR_ENDPOINT = previousPdfEndpoint;
  }
});

test("empty PDF-app OCR does not call proposal AI", async () => {
  const previousProjectUrl = process.env.PROJECT_URL;
  const previousPdfKey = process.env.PDF_APP_API_KEY;
  const previousPdfEndpoint = process.env.PDF_APP_OCR_ENDPOINT;
  const previousPdfAsyncMode = process.env.PDF_APP_ASYNC_MODE;
  const previousRetryBaseDelay = process.env.PDF_APP_RETRY_BASE_DELAY_MS;
  const previousFetch = globalThis.fetch;
  process.env.PROJECT_URL = "https://astebook.example";
  process.env.PDF_APP_API_KEY = "pdf-key";
  process.env.PDF_APP_OCR_ENDPOINT = "https://pdf-app.example/ocr";
  process.env.PDF_APP_ASYNC_MODE = "false";
  process.env.PDF_APP_RETRY_BASE_DELAY_MS = "0";

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ extraction_results: [{ result: [{ page: 1, region_index: 0, result: "   " }] }] }),
  });

  const events = new Map([["empty-ocr-test", { id: "empty-ocr-test", steps: [] }]]);
  const pipeline = createAiExtractionPipeline({
    autoSendMergedDocumentEmail: async () => null,
    getProcessingEvent: async (id) => events.get(id) || null,
    updateProcessingEvent: async (id, patch = {}, step = null) => {
      const current = events.get(id) || { id, steps: [] };
      const next = {
        ...current,
        ...patch,
        steps: step ? [...(current.steps || []), step] : current.steps || [],
      };
      events.set(id, next);
      return next;
    },
  });

  try {
    const result = await pipeline({
      eventId: "empty-ocr-test",
      body: { subject: "EMPTY_OCR_TEST" },
      files: [
        {
          fieldname: "email_attachment_1",
          originalname: "Proposta vuota.pdf",
          mimetype: "application/pdf",
          buffer: Buffer.from("%PDF scannerizzato"),
        },
      ],
      skipAutoSend: true,
    });

    assert.equal(result.extracted.proposta, null);
    assert.equal(result.ocr_summary.files["Proposta vuota.pdf"].status, "pdf_app_empty");
    assert.equal(result.ocr_summary.files["Proposta vuota.pdf"].ocr_final_status, "ocr_empty");
    assert.equal(result.extraction_diagnostics?.proposta_agent_runs?.length || 0, 0);
    assert.equal(Object.values(result.attachment_text_cache || {}).some((entry) => entry.file_name === "Proposta vuota.pdf"), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProjectUrl === undefined) delete process.env.PROJECT_URL;
    else process.env.PROJECT_URL = previousProjectUrl;
    if (previousPdfKey === undefined) delete process.env.PDF_APP_API_KEY;
    else process.env.PDF_APP_API_KEY = previousPdfKey;
    if (previousPdfEndpoint === undefined) delete process.env.PDF_APP_OCR_ENDPOINT;
    else process.env.PDF_APP_OCR_ENDPOINT = previousPdfEndpoint;
    if (previousPdfAsyncMode === undefined) delete process.env.PDF_APP_ASYNC_MODE;
    else process.env.PDF_APP_ASYNC_MODE = previousPdfAsyncMode;
    if (previousRetryBaseDelay === undefined) delete process.env.PDF_APP_RETRY_BASE_DELAY_MS;
    else process.env.PDF_APP_RETRY_BASE_DELAY_MS = previousRetryBaseDelay;
  }
});

test("async PDF-app OCR populates attachment text cache with full multi-page text", async () => {
  const previousProjectUrl = process.env.PROJECT_URL;
  const previousPdfKey = process.env.PDF_APP_API_KEY;
  const previousPdfEndpoint = process.env.PDF_APP_OCR_ENDPOINT;
  const previousPdfJobEndpoint = process.env.PDF_APP_JOB_ENDPOINT;
  const previousPollInterval = process.env.PDF_APP_POLL_INTERVAL_BASE_MS;
  const previousRetryBaseDelay = process.env.PDF_APP_RETRY_BASE_DELAY_MS;
  const previousFetch = globalThis.fetch;
  process.env.PROJECT_URL = "https://astebook.example";
  process.env.PDF_APP_API_KEY = "pdf-key";
  process.env.PDF_APP_OCR_ENDPOINT = "https://pdf-app.example/ocr";
  process.env.PDF_APP_JOB_ENDPOINT = "https://pdf-app.example/jobs/{jobId}";
  process.env.PDF_APP_POLL_INTERVAL_BASE_MS = "0";
  process.env.PDF_APP_RETRY_BASE_DELAY_MS = "0";

  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === "POST") {
      const body = JSON.parse(options.body || "{}");
      assert.equal(body.async, true);
      return {
        ok: true,
        status: 202,
        text: async () => JSON.stringify({ job_id: "job-cache-1", status: "accepted" }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: "completed",
        extraction_results: [
          {
            result: [
              { page: 2, region_index: 0, result: "Pagina due prezzo Euro 150.000. ".repeat(12) },
              { page: 1, region_index: 0, result: "Pagina uno proponente Laura Bianchi. ".repeat(12) },
              { page: 3, region_index: 0, result: "Pagina tre IBAN IT60X0542811101000000123456. ".repeat(12) },
            ],
          },
        ],
      }),
    };
  };

  const events = new Map([["async-cache-test", { id: "async-cache-test", steps: [] }]]);
  const pipeline = createAiExtractionPipeline({
    autoSendMergedDocumentEmail: async () => null,
    getProcessingEvent: async (id) => events.get(id) || null,
    updateProcessingEvent: async (id, patch = {}, step = null) => {
      const current = events.get(id) || { id, steps: [] };
      const next = {
        ...current,
        ...patch,
        steps: step ? [...(current.steps || []), step] : current.steps || [],
      };
      events.set(id, next);
      return next;
    },
  });

  try {
    const result = await pipeline({
      eventId: "async-cache-test",
      body: { subject: "ASYNC_CACHE_TEST" },
      files: [
        {
          fieldname: "email_attachment_1",
          originalname: "Proposta async.pdf",
          mimetype: "application/pdf",
          buffer: Buffer.from("%PDF scannerizzato async"),
        },
      ],
      skipAutoSend: true,
    });

    const cacheEntry = Object.values(result.attachment_text_cache).find((entry) => entry.file_name === "Proposta async.pdf");
    assert.ok(cacheEntry);
    assert.equal(cacheEntry.source, "pdf_app");
    assert.equal(cacheEntry.parser_version, "pdf_app_multi_page_v1");
    assert.match(cacheEntry.text, /Pagina uno/);
    assert.match(cacheEntry.text, /Pagina due/);
    assert.match(cacheEntry.text, /Pagina tre/);
    assert.equal(cacheEntry.text.indexOf("Pagina uno") < cacheEntry.text.indexOf("Pagina due"), true);
    assert.equal(cacheEntry.text.indexOf("Pagina due") < cacheEntry.text.indexOf("Pagina tre"), true);
    assert.equal(result.ocr_summary.files["Proposta async.pdf"].pdf_app_diagnostics.mode, "async");
    assert.equal(typeof result.ocr_summary.files["Proposta async.pdf"].pdf_app_diagnostics.total_duration_ms, "number");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProjectUrl === undefined) delete process.env.PROJECT_URL;
    else process.env.PROJECT_URL = previousProjectUrl;
    if (previousPdfKey === undefined) delete process.env.PDF_APP_API_KEY;
    else process.env.PDF_APP_API_KEY = previousPdfKey;
    if (previousPdfEndpoint === undefined) delete process.env.PDF_APP_OCR_ENDPOINT;
    else process.env.PDF_APP_OCR_ENDPOINT = previousPdfEndpoint;
    if (previousPdfJobEndpoint === undefined) delete process.env.PDF_APP_JOB_ENDPOINT;
    else process.env.PDF_APP_JOB_ENDPOINT = previousPdfJobEndpoint;
    if (previousPollInterval === undefined) delete process.env.PDF_APP_POLL_INTERVAL_BASE_MS;
    else process.env.PDF_APP_POLL_INTERVAL_BASE_MS = previousPollInterval;
    if (previousRetryBaseDelay === undefined) delete process.env.PDF_APP_RETRY_BASE_DELAY_MS;
    else process.env.PDF_APP_RETRY_BASE_DELAY_MS = previousRetryBaseDelay;
  }
});

test("async PDF-app OCR text reaches Proposal Agent with Scandolara fields", async () => {
  const previousProjectUrl = process.env.PROJECT_URL;
  const previousPdfKey = process.env.PDF_APP_API_KEY;
  const previousPdfEndpoint = process.env.PDF_APP_OCR_ENDPOINT;
  const previousPdfJobEndpoint = process.env.PDF_APP_JOB_ENDPOINT;
  const previousAsyncMode = process.env.PDF_APP_ASYNC_MODE;
  const previousPollInterval = process.env.PDF_APP_POLL_INTERVAL_BASE_MS;
  const previousRetryBaseDelay = process.env.PDF_APP_RETRY_BASE_DELAY_MS;
  const previousFetch = globalThis.fetch;
  process.env.PROJECT_URL = "https://astebook.example";
  process.env.PDF_APP_API_KEY = "pdf-key";
  process.env.PDF_APP_OCR_ENDPOINT = "https://api.pdf-app.net/ocr";
  process.env.PDF_APP_JOB_ENDPOINT = "https://api.pdf-app.net/async_jobid_check";
  process.env.PDF_APP_ASYNC_MODE = "true";
  process.env.PDF_APP_POLL_INTERVAL_BASE_MS = "0";
  process.env.PDF_APP_RETRY_BASE_DELAY_MS = "0";

  const page1 = [
    "Proposta irrevocabile di acquisto dell'immobile",
    "identificato al Catasto Fabbricati al Foglio 6,",
    "Particella 305, Sub 501",
    "La sottoscritta LI JIN quale Proponente Acquirente",
    "il prezzo offerto per l'acquisto e Euro 25.000,00",
    "Proprietà SAVOY REOCO S.r.l.",
  ].join("\n");
  const page6 = [
    "conto corrente intestato a Savoy",
    "IBAN IT48 T030 6912 7111 0000 0012 823",
    "Condizioni, dichiarazioni e allegati della proposta di acquisto.".repeat(8),
  ].join("\n");
  const ocrText = [page1, "test pagina 2", page6].join("\n\n");

  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === "POST") return {
      ok: true,
      status: 202,
      text: async () => JSON.stringify({
        message: "Async job started, check job_id status later",
        job_id: "job-scandolara",
      }),
    };
    assert.equal(options.method, "GET");
    assert.deepEqual(JSON.parse(options.body || "{}"), { job_id: "job-scandolara" });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        URLs: [],
        CreditzConsumed: 47.63,
        statusCode: 200,
        status: "success",
        message: "OCR completed successfully.",
        job_id: "job-scandolara",
        extraction_results: [
          {
            file: "PROPOSTA SCANDOLARA.pdf",
            v2: true,
            result: [
              { page: 6, result: page6 },
              { page: 2, result: "test pagina 2" },
              { page: 1, result: page1 },
            ],
          },
        ],
      }),
    };
  };

  const events = new Map([["async-scandolara-proposal-agent-test", { id: "async-scandolara-proposal-agent-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  try {
    const result = await pipeline({
      eventId: "async-scandolara-proposal-agent-test",
      body: { subject: "ASYNC_SCANDOLARA_PROPOSAL_AGENT_TEST" },
      files: [
        {
          fieldname: "email_attachment_1",
          originalname: "PROPOSTA SCANDOLARA.pdf",
          mimetype: "application/pdf",
          buffer: Buffer.from("%PDF scanned proposal async Scandolara"),
        },
      ],
      skipAutoSend: true,
    });

    const diagnostic = result.extraction_diagnostics.attachments.find((item) => item.file_name === "PROPOSTA SCANDOLARA.pdf");
    const agentRun = result.extraction_diagnostics.proposta_agent_runs[0];
    const ocrDiagnostic = result.extraction_diagnostics.ocr_texts.find((item) => item.file_name === "PROPOSTA SCANDOLARA.pdf");
    const observedOcrText = ocrDiagnostic.text.text;
    const cachedText = Object.values(result.attachment_text_cache || {}).find((entry) => entry.file_name === "PROPOSTA SCANDOLARA.pdf")?.text || "";

    assert.equal(diagnostic.passed_to_ai, true);
    assert.equal(agentRun.input_text_length, observedOcrText.length);
    assert.equal(agentRun.input_text_length, ocrText.length);
    assert.equal(cachedText, observedOcrText);
    assert.match(observedOcrText, /LI JIN/);
    assert.match(observedOcrText, /Euro 25\.000,00/);
    assert.match(observedOcrText, /Foglio 6/);
    assert.match(observedOcrText, /Particella 305/);
    assert.match(observedOcrText, /Sub 501/);
    assert.match(observedOcrText, /IBAN IT48 T030 6912 7111 0000 0012 823/);
    assert.equal(result.ocr_summary.files["PROPOSTA SCANDOLARA.pdf"].pdf_app_diagnostics.credits_consumed, 47.63);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProjectUrl === undefined) delete process.env.PROJECT_URL;
    else process.env.PROJECT_URL = previousProjectUrl;
    if (previousPdfKey === undefined) delete process.env.PDF_APP_API_KEY;
    else process.env.PDF_APP_API_KEY = previousPdfKey;
    if (previousPdfEndpoint === undefined) delete process.env.PDF_APP_OCR_ENDPOINT;
    else process.env.PDF_APP_OCR_ENDPOINT = previousPdfEndpoint;
    if (previousPdfJobEndpoint === undefined) delete process.env.PDF_APP_JOB_ENDPOINT;
    else process.env.PDF_APP_JOB_ENDPOINT = previousPdfJobEndpoint;
    if (previousAsyncMode === undefined) delete process.env.PDF_APP_ASYNC_MODE;
    else process.env.PDF_APP_ASYNC_MODE = previousAsyncMode;
    if (previousPollInterval === undefined) delete process.env.PDF_APP_POLL_INTERVAL_BASE_MS;
    else process.env.PDF_APP_POLL_INTERVAL_BASE_MS = previousPollInterval;
    if (previousRetryBaseDelay === undefined) delete process.env.PDF_APP_RETRY_BASE_DELAY_MS;
    else process.env.PDF_APP_RETRY_BASE_DELAY_MS = previousRetryBaseDelay;
  }
});

test("Apify announcement data replaces extracted announcement while keeping AI fallback", async () => {
  const previousProvider = process.env.IMMOBILIARE_SCRAPER_PROVIDER;
  const previousToken = process.env.APIFY_TOKEN;
  const previousActor = process.env.APIFY_IMMOBILIARE_ACTOR_ID;
  const previousFetch = globalThis.fetch;
  process.env.IMMOBILIARE_SCRAPER_PROVIDER = "apify";
  process.env.APIFY_TOKEN = "token";
  process.env.APIFY_IMMOBILIARE_ACTOR_ID = "user/immobiliare-scraper";

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ([
      {
        url: "https://www.immobiliare.it/annunci/123456789/",
        title: "Locale commerciale in Vendita",
        description: "Descrizione certificata da Apify.",
        price: { value: 220000, formattedValue: "EUR 220.000" },
        availability: "attivo",
        address: {
          street: "Scali Manzoni",
          streetNumber: "13-25",
          city: "Livorno",
          province: "LI",
        },
        propertyType: { name: "Negozio - Locale commerciale" },
      },
    ]),
  });

  const events = new Map();
  const pipeline = createAiExtractionPipeline({
    autoSendMergedDocumentEmail: async () => null,
    getProcessingEvent: async (id) => events.get(id) || null,
    updateProcessingEvent: async (id, patch = {}) => {
      const current = events.get(id) || { id };
      events.set(id, { ...current, ...patch });
    },
  });

  try {
    const result = await pipeline({
      eventId: "apify-annuncio-test",
      body: {
        subject: "LI_LIVO_NEB_R0035904 procedura",
        email_body_text: [
          "https://www.immobiliare.it/annunci/123456789/",
          "Localizzazione:",
          "Via Vecchia 1, Pisa",
          "Descrizione fallback da email.",
        ].join("\n"),
      },
      files: [],
      skipAutoSend: true,
    });

    assert.equal(result.extracted.annuncio.source, "apify");
    assert.equal(result.extracted.annuncio.indirizzo, "Scali Manzoni 13-25, Livorno, LI");
    assert.equal(result.extracted.annuncio.descrizione, "Descrizione certificata da Apify.");
    assert.equal(result.extracted.annuncio.offerta_minima, 220000);
    assert.equal(result.extracted.annuncio.categoria_macro, "Negozio - Locale commerciale");
    assert.equal(result.extracted.annuncio.fallback_annuncio.indirizzo, "Via Vecchia 1, Pisa");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProvider === undefined) delete process.env.IMMOBILIARE_SCRAPER_PROVIDER;
    else process.env.IMMOBILIARE_SCRAPER_PROVIDER = previousProvider;
    if (previousToken === undefined) delete process.env.APIFY_TOKEN;
    else process.env.APIFY_TOKEN = previousToken;
    if (previousActor === undefined) delete process.env.APIFY_IMMOBILIARE_ACTOR_ID;
    else process.env.APIFY_IMMOBILIARE_ACTOR_ID = previousActor;
  }
});

function cachedTextEntry({ buffer, fileName, format, text, source = format }) {
  return [
    createHash("sha256").update(buffer).digest("hex"),
    {
      file_name: fileName,
      format,
      text,
      text_length: text.length,
      source,
      parser_version: source === "pdf_app" ? "pdf_app_multi_page_v1" : null,
    },
  ];
}

function compiledProposalText(extra = "") {
  return [
    "Proposta irrevocabile di acquisto di immobile",
    "Il sottoscritto Mario Rossi in qualità di Proponente Acquirente",
    "codice fiscale RSSMRA80A01H501U",
    "identificato al Catasto Fabbricati al Foglio 6, Particella 305, Sub 501",
    "Via Vicolo Magenta n. 3",
    "Prezzo offerto Euro 150.000,00",
    "Firma e sottoscrizione",
    extra,
  ].join("\n");
}

function proposalTemplateText(extra = "") {
  return [
    "Proposta irrevocabile di acquisto",
    "Il sottoscritto/a __________________",
    "Proponente Acquirente [●]",
    "Codice fiscale __________________",
    "Catasto Fabbricati: Foglio ____ Particella ____ Sub ____",
    "Indirizzo immobile __________________",
    "Importo Euro __________",
    "Firma __________________",
    "Da compilare a cura del proponente",
    extra,
  ].join("\n").repeat(80);
}

function makePipeline(events) {
  return createAiExtractionPipeline({
    autoSendMergedDocumentEmail: async () => null,
    getProcessingEvent: async (id) => events.get(id) || null,
    updateProcessingEvent: async (id, patch = {}, step = null) => {
      const current = events.get(id) || { id, steps: [] };
      const next = {
        ...current,
        ...patch,
        steps: step ? [...(current.steps || []), step] : current.steps || [],
      };
      events.set(id, next);
      return next;
    },
  });
}

function installPdfAppEnv() {
  const previous = {
    PROJECT_URL: process.env.PROJECT_URL,
    PDF_APP_API_KEY: process.env.PDF_APP_API_KEY,
    PDF_APP_OCR_ENDPOINT: process.env.PDF_APP_OCR_ENDPOINT,
    PDF_APP_ASYNC_MODE: process.env.PDF_APP_ASYNC_MODE,
    PDF_APP_RETRY_COUNT: process.env.PDF_APP_RETRY_COUNT,
    PDF_APP_RETRY_BASE_DELAY_MS: process.env.PDF_APP_RETRY_BASE_DELAY_MS,
    PDF_APP_OCR_MAX_ATTEMPTS: process.env.PDF_APP_OCR_MAX_ATTEMPTS,
    PDF_APP_OCR_RETRY_BASE_MS: process.env.PDF_APP_OCR_RETRY_BASE_MS,
    PDF_APP_OCR_TIMEOUT_MS: process.env.PDF_APP_OCR_TIMEOUT_MS,
    fetch: globalThis.fetch,
  };
  process.env.PROJECT_URL = "https://astebook.example";
  process.env.PDF_APP_API_KEY = "pdf-key";
  process.env.PDF_APP_OCR_ENDPOINT = "https://pdf-app.example/ocr";
  process.env.PDF_APP_ASYNC_MODE = "false";
  process.env.PDF_APP_RETRY_COUNT = "0";
  process.env.PDF_APP_OCR_MAX_ATTEMPTS = "1";
  process.env.PDF_APP_RETRY_BASE_DELAY_MS = "0";
  process.env.PDF_APP_OCR_RETRY_BASE_MS = "0";
  process.env.PDF_APP_OCR_TIMEOUT_MS = "120000";
  return () => {
    if (previous.PROJECT_URL === undefined) delete process.env.PROJECT_URL;
    else process.env.PROJECT_URL = previous.PROJECT_URL;
    if (previous.PDF_APP_API_KEY === undefined) delete process.env.PDF_APP_API_KEY;
    else process.env.PDF_APP_API_KEY = previous.PDF_APP_API_KEY;
    if (previous.PDF_APP_OCR_ENDPOINT === undefined) delete process.env.PDF_APP_OCR_ENDPOINT;
    else process.env.PDF_APP_OCR_ENDPOINT = previous.PDF_APP_OCR_ENDPOINT;
    if (previous.PDF_APP_ASYNC_MODE === undefined) delete process.env.PDF_APP_ASYNC_MODE;
    else process.env.PDF_APP_ASYNC_MODE = previous.PDF_APP_ASYNC_MODE;
    if (previous.PDF_APP_RETRY_COUNT === undefined) delete process.env.PDF_APP_RETRY_COUNT;
    else process.env.PDF_APP_RETRY_COUNT = previous.PDF_APP_RETRY_COUNT;
    if (previous.PDF_APP_RETRY_BASE_DELAY_MS === undefined) delete process.env.PDF_APP_RETRY_BASE_DELAY_MS;
    else process.env.PDF_APP_RETRY_BASE_DELAY_MS = previous.PDF_APP_RETRY_BASE_DELAY_MS;
    if (previous.PDF_APP_OCR_MAX_ATTEMPTS === undefined) delete process.env.PDF_APP_OCR_MAX_ATTEMPTS;
    else process.env.PDF_APP_OCR_MAX_ATTEMPTS = previous.PDF_APP_OCR_MAX_ATTEMPTS;
    if (previous.PDF_APP_OCR_RETRY_BASE_MS === undefined) delete process.env.PDF_APP_OCR_RETRY_BASE_MS;
    else process.env.PDF_APP_OCR_RETRY_BASE_MS = previous.PDF_APP_OCR_RETRY_BASE_MS;
    if (previous.PDF_APP_OCR_TIMEOUT_MS === undefined) delete process.env.PDF_APP_OCR_TIMEOUT_MS;
    else process.env.PDF_APP_OCR_TIMEOUT_MS = previous.PDF_APP_OCR_TIMEOUT_MS;
    globalThis.fetch = previous.fetch;
  };
}

test("proposal selection prefers compiled PDF source over proposal template DOCX", async () => {
  const templateBuffer = Buffer.from("PK template");
  const sourceBuffer = Buffer.from("%PDF source");
  const templateText = "FORMAT PROPOSTA\nNome Cognome __________________\nCodice fiscale __________________\nDa compilare a cura del proponente.";
  const sourceText = `${compiledProposalText("LI JIN\nSAVOY REOCO S.r.l.")}\n`.repeat(8);
  const events = new Map([["proposal-selection-test", { id: "proposal-selection-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  const result = await pipeline({
    eventId: "proposal-selection-test",
    body: { subject: "PROPOSAL_SELECTION_TEST" },
    files: [
      {
        fieldname: "email_attachment_1",
        originalname: "Allegato B_Format Proposta Savoy Procedura Proprietà.docx",
        mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: templateBuffer,
      },
      {
        fieldname: "email_attachment_2",
        originalname: "Proposta irrevocabile di acquisto.pdf",
        mimetype: "application/pdf",
        buffer: sourceBuffer,
      },
    ],
    previousResult: {
      attachment_text_cache: Object.fromEntries([
        cachedTextEntry({ buffer: templateBuffer, fileName: "Allegato B_Format Proposta Savoy Procedura Proprietà.docx", format: "docx", text: templateText, source: "docx" }),
        cachedTextEntry({ buffer: sourceBuffer, fileName: "Proposta irrevocabile di acquisto.pdf", format: "pdf", text: sourceText, source: "pdf_app" }),
      ]),
    },
    skipAutoSend: true,
  });

  const byName = new Map(result.extraction_diagnostics.attachments.map((item) => [item.file_name, item]));
  assert.equal(byName.get("Allegato B_Format Proposta Savoy Procedura Proprietà.docx").document_role, "template");
  assert.equal(byName.get("Allegato B_Format Proposta Savoy Procedura Proprietà.docx").proposal_candidate, false);
  assert.equal(byName.get("Allegato B_Format Proposta Savoy Procedura Proprietà.docx").passed_to_ai, false);
  assert.equal(byName.get("Proposta irrevocabile di acquisto.pdf").document_role, "source");
  assert.equal(byName.get("Proposta irrevocabile di acquisto.pdf").proposal_primary, true);
  assert.equal(result.extraction_diagnostics.proposta_agent_runs.length, 1);
  assert.equal(result.extraction_diagnostics.proposta_agent_runs[0].file_name, "Proposta irrevocabile di acquisto.pdf");
});

test("compiled DOCX proposal can be selected as source", async () => {
  const buffer = Buffer.from("PK compiled docx");
  const text = compiledProposalText("Documento compilato in formato DOCX.");
  const events = new Map([["compiled-docx-proposal-test", { id: "compiled-docx-proposal-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  const result = await pipeline({
    eventId: "compiled-docx-proposal-test",
    body: { subject: "COMPILED_DOCX_PROPOSAL_TEST" },
    files: [
      {
        fieldname: "email_attachment_1",
        originalname: "Proposta acquisto Rossi.docx",
        mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer,
      },
    ],
    previousResult: {
      attachment_text_cache: Object.fromEntries([
        cachedTextEntry({ buffer, fileName: "Proposta acquisto Rossi.docx", format: "docx", text, source: "docx" }),
      ]),
    },
    skipAutoSend: true,
  });

  assert.equal(result.extraction_diagnostics.proposal_selection.primary_file_name, "Proposta acquisto Rossi.docx");
  assert.equal(result.extraction_diagnostics.proposta_agent_runs.length, 1);
  assert.equal(result.extracted.proposta.file_pdf, "Proposta acquisto Rossi.docx");
  assert.equal(result.extracted.proposta.source_format, "docx");
});

test("multiple real proposal sources are diagnosed instead of silently first or last winning", async () => {
  const firstBuffer = Buffer.from("PK compiled source one");
  const secondBuffer = Buffer.from("PK compiled source two");
  const firstText = compiledProposalText("Fonte uno.");
  const secondText = compiledProposalText("Fonte due.");
  const events = new Map([["multiple-proposal-sources-test", { id: "multiple-proposal-sources-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  const result = await pipeline({
    eventId: "multiple-proposal-sources-test",
    body: { subject: "MULTIPLE_PROPOSAL_SOURCES_TEST" },
    files: [
      {
        fieldname: "email_attachment_1",
        originalname: "Proposta acquisto Rossi.docx",
        mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: firstBuffer,
      },
      {
        fieldname: "email_attachment_2",
        originalname: "Offerta irrevocabile Bianchi.docx",
        mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: secondBuffer,
      },
    ],
    previousResult: {
      attachment_text_cache: Object.fromEntries([
        cachedTextEntry({ buffer: firstBuffer, fileName: "Proposta acquisto Rossi.docx", format: "docx", text: firstText, source: "docx" }),
        cachedTextEntry({ buffer: secondBuffer, fileName: "Offerta irrevocabile Bianchi.docx", format: "docx", text: secondText, source: "docx" }),
      ]),
    },
    skipAutoSend: true,
  });

  assert.equal(result.extraction_diagnostics.proposal_selection.status, "ambiguous_sources");
  assert.deepEqual(
    result.extraction_diagnostics.proposal_selection.ambiguous_file_names,
    ["Proposta acquisto Rossi.docx", "Offerta irrevocabile Bianchi.docx"]
  );
  assert.equal(result.extraction_diagnostics.proposta_agent_runs.length, 2);
  assert.ok(result.notes.some((note) => note.includes("Più proposte compilate con pari priorità")));
});

test("scanned proposal PDF uses PDF-app OCR before proposal selection", async () => {
  const restore = installPdfAppEnv();
  const pdfBuffer = Buffer.from("%PDF scanned proposal without native text");
  const ocrText = `${compiledProposalText("LI JIN\nSAVOY REOCO S.r.l.")}\n`.repeat(8);
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      extraction_results: [{ result: [{ page: 1, region_index: 0, result: ocrText }] }],
    }),
  });
  const events = new Map([["scanned-pdf-ocr-selection-test", { id: "scanned-pdf-ocr-selection-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  try {
    const result = await pipeline({
      eventId: "scanned-pdf-ocr-selection-test",
      body: { subject: "SCANNED_PDF_OCR_SELECTION_TEST" },
      files: [{
        fieldname: "email_attachment_1",
        originalname: "PROPOSTA SCANDOLARA.pdf",
        mimetype: "application/pdf",
        buffer: pdfBuffer,
      }],
      skipAutoSend: true,
    });

    const diagnostic = result.extraction_diagnostics.attachments.find((item) => item.file_name === "PROPOSTA SCANDOLARA.pdf");
    assert.equal(diagnostic.ocr_attempted, true);
    assert.equal(diagnostic.ocr_status, "completed");
    assert.equal(diagnostic.text_source, "pdf_app_ocr");
    assert.equal(diagnostic.usable_text, true);
    assert.equal(diagnostic.proposal_candidate, true);
    assert.equal(diagnostic.proposal_primary, true);
    assert.equal(diagnostic.passed_to_ai, true);
  } finally {
    restore();
  }
});

test("native proposal PDF text can be selected without PDF-app OCR", async () => {
  const pdfBuffer = Buffer.from("%PDF native proposal cached");
  const nativeText = `${compiledProposalText("Documento PDF testuale.")}\n`.repeat(8);
  const events = new Map([["native-pdf-proposal-test", { id: "native-pdf-proposal-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  const result = await pipeline({
    eventId: "native-pdf-proposal-test",
    body: { subject: "NATIVE_PDF_PROPOSAL_TEST" },
    files: [{
      fieldname: "email_attachment_1",
      originalname: "Proposta irrevocabile di acquisto.pdf",
      mimetype: "application/pdf",
      buffer: pdfBuffer,
    }],
    previousResult: {
      attachment_text_cache: Object.fromEntries([
        cachedTextEntry({ buffer: pdfBuffer, fileName: "Proposta irrevocabile di acquisto.pdf", format: "pdf", text: nativeText, source: "pdf_native" }),
      ]),
    },
    skipAutoSend: true,
  });

  const diagnostic = result.extraction_diagnostics.attachments.find((item) => item.file_name === "Proposta irrevocabile di acquisto.pdf");
  assert.equal(diagnostic.ocr_attempted, false);
  assert.equal(diagnostic.ocr_status, "cache_hit");
  assert.equal(diagnostic.text_source, "pdf_native_cache");
  assert.equal(diagnostic.usable_text, true);
  assert.equal(diagnostic.proposal_primary, true);
});

test("empty PDF-app OCR leaves scanned proposal PDF unusable", async () => {
  const restore = installPdfAppEnv();
  const pdfBuffer = Buffer.from("%PDF scanned empty ocr");
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      extraction_results: [{ result: [{ page: 1, region_index: 0, result: "   \n " }] }],
    }),
  });
  const events = new Map([["empty-pdf-ocr-selection-test", { id: "empty-pdf-ocr-selection-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  try {
    const result = await pipeline({
      eventId: "empty-pdf-ocr-selection-test",
      body: { subject: "EMPTY_PDF_OCR_SELECTION_TEST" },
      files: [{
        fieldname: "email_attachment_1",
        originalname: "PROPOSTA SCANDOLARA.pdf",
        mimetype: "application/pdf",
        buffer: pdfBuffer,
      }],
      skipAutoSend: true,
    });

    const diagnostic = result.extraction_diagnostics.attachments.find((item) => item.file_name === "PROPOSTA SCANDOLARA.pdf");
    assert.equal(diagnostic.ocr_attempted, true);
    assert.equal(diagnostic.ocr_status, "empty");
    assert.equal(diagnostic.usable_text, false);
    assert.equal(diagnostic.unusable_reason, "ocr_empty_text");
    assert.equal(diagnostic.passed_to_ai, false);
  } finally {
    restore();
  }
});

test("PDF-app OCR timeout is diagnosed without crashing proposal fallback", async () => {
  const restore = installPdfAppEnv();
  const pdfBuffer = Buffer.from("%PDF scanned timeout");
  globalThis.fetch = async () => ({
    ok: false,
    status: 504,
    statusText: "Gateway Timeout",
    text: async () => "Gateway Timeout",
  });
  const events = new Map([["timeout-pdf-ocr-selection-test", { id: "timeout-pdf-ocr-selection-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  try {
    const result = await pipeline({
      eventId: "timeout-pdf-ocr-selection-test",
      body: { subject: "TIMEOUT_PDF_OCR_SELECTION_TEST" },
      files: [{
        fieldname: "email_attachment_1",
        originalname: "PROPOSTA SCANDOLARA.pdf",
        mimetype: "application/pdf",
        buffer: pdfBuffer,
      }],
      skipAutoSend: true,
    });

    const diagnostic = result.extraction_diagnostics.attachments.find((item) => item.file_name === "PROPOSTA SCANDOLARA.pdf");
    assert.equal(diagnostic.ocr_attempted, true);
    assert.equal(diagnostic.ocr_status, "http_504");
    assert.equal(diagnostic.usable_text, false);
    assert.equal(diagnostic.unusable_reason, "ocr_http_504");
    assert.equal(diagnostic.passed_to_ai, false);
  } finally {
    restore();
  }
});

test("PDF-app OCR retry exhausted leaves scanned proposal unusable without caching failure", async () => {
  const restore = installPdfAppEnv();
  process.env.PDF_APP_OCR_MAX_ATTEMPTS = "3";
  const pdfBuffer = Buffer.from("%PDF scanned retry exhausted");
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return {
      ok: false,
      status: 504,
      statusText: "Gateway Timeout",
      text: async () => "Gateway Timeout",
    };
  };
  const events = new Map([["retry-exhausted-pdf-ocr-selection-test", { id: "retry-exhausted-pdf-ocr-selection-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  try {
    const result = await pipeline({
      eventId: "retry-exhausted-pdf-ocr-selection-test",
      body: { subject: "RETRY_EXHAUSTED_PDF_OCR_SELECTION_TEST" },
      files: [{
        fieldname: "email_attachment_1",
        originalname: "PROPOSTA SCANDOLARA.pdf",
        mimetype: "application/pdf",
        buffer: pdfBuffer,
      }],
      skipAutoSend: true,
    });

    const diagnostic = result.extraction_diagnostics.attachments.find((item) => item.file_name === "PROPOSTA SCANDOLARA.pdf");
    assert.equal(calls, 3);
    assert.equal(diagnostic.ocr_attempted, true);
    assert.equal(diagnostic.ocr_status, "retry_exhausted");
    assert.equal(diagnostic.ocr_attempt_count, 3);
    assert.equal(diagnostic.final_error_type, "http_504");
    assert.equal(diagnostic.usable_text, false);
    assert.equal(diagnostic.unusable_reason, "ocr_retry_exhausted");
    assert.equal(diagnostic.passed_to_ai, false);
    assert.equal(Object.values(result.attachment_text_cache || {}).some((entry) => entry.file_name === "PROPOSTA SCANDOLARA.pdf"), false);
    assert.equal(result.extraction_diagnostics.proposal_selection.status, "no_source_candidate");
  } finally {
    restore();
  }
});

test("failed PDF-app OCR is not permanently cached and can succeed on reprocess", async () => {
  const restore = installPdfAppEnv();
  process.env.PDF_APP_OCR_MAX_ATTEMPTS = "3";
  const pdfBuffer = Buffer.from("%PDF failed then reprocess success");
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls <= 3) {
      return {
        ok: false,
        status: 504,
        statusText: "Gateway Timeout",
        text: async () => "Gateway Timeout",
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ text: `${compiledProposalText("Reprocess OCR success.")}\n`.repeat(8) }),
    };
  };
  const events = new Map([
    ["failed-ocr-first-test", { id: "failed-ocr-first-test", steps: [] }],
    ["failed-ocr-second-test", { id: "failed-ocr-second-test", steps: [] }],
  ]);
  const pipeline = makePipeline(events);

  try {
    const first = await pipeline({
      eventId: "failed-ocr-first-test",
      body: { subject: "FAILED_OCR_FIRST_TEST" },
      files: [{
        fieldname: "email_attachment_1",
        originalname: "PROPOSTA SCANDOLARA.pdf",
        mimetype: "application/pdf",
        buffer: pdfBuffer,
      }],
      skipAutoSend: true,
    });
    assert.equal(first.extraction_diagnostics.proposal_selection.status, "no_source_candidate");

    const second = await pipeline({
      eventId: "failed-ocr-second-test",
      body: { subject: "FAILED_OCR_SECOND_TEST" },
      files: [{
        fieldname: "email_attachment_1",
        originalname: "PROPOSTA SCANDOLARA.pdf",
        mimetype: "application/pdf",
        buffer: pdfBuffer,
      }],
      previousResult: first,
      skipAutoSend: true,
    });

    const diagnostic = second.extraction_diagnostics.attachments.find((item) => item.file_name === "PROPOSTA SCANDOLARA.pdf");
    assert.equal(calls, 4);
    assert.equal(diagnostic.ocr_status, "completed");
    assert.equal(diagnostic.passed_to_ai, true);
    assert.ok(Object.values(second.attachment_text_cache || {}).some((entry) => entry.source === "pdf_app"));
  } finally {
    restore();
  }
});

test("real scenario selects scanned PDF OCR source over long template DOCX", async () => {
  const restore = installPdfAppEnv();
  process.env.PDF_APP_OCR_MAX_ATTEMPTS = "2";
  const pdfBuffer = Buffer.from("%PDF real scenario scanned");
  const templateBuffer = Buffer.from("PK real scenario template");
  const ocrText = `${compiledProposalText("LI JIN\nSAVOY REOCO S.r.l.")}\nFoglio 6\nParticella 305\nSub 501\n`.repeat(8);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 504,
        statusText: "Gateway Timeout",
        text: async () => "Gateway Timeout",
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        extraction_results: [{ result: [{ page: 1, region_index: 0, result: ocrText }] }],
      }),
    };
  };
  const events = new Map([["real-scenario-pdf-vs-template-test", { id: "real-scenario-pdf-vs-template-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  try {
    const result = await pipeline({
      eventId: "real-scenario-pdf-vs-template-test",
      body: { subject: "REAL_SCENARIO_PDF_VS_TEMPLATE_TEST" },
      files: [
        {
          fieldname: "email_attachment_1",
          originalname: "PROPOSTA SCANDOLARA.pdf",
          mimetype: "application/pdf",
          buffer: pdfBuffer,
        },
        {
          fieldname: "email_attachment_2",
          originalname: "Allegato B_Format Proposta Savoy Procedura Proprietà.docx",
          mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: templateBuffer,
        },
      ],
      previousResult: {
        attachment_text_cache: Object.fromEntries([
          cachedTextEntry({ buffer: templateBuffer, fileName: "Allegato B_Format Proposta Savoy Procedura Proprietà.docx", format: "docx", text: proposalTemplateText(), source: "docx" }),
        ]),
      },
      skipAutoSend: true,
    });

    const byName = new Map(result.extraction_diagnostics.attachments.map((item) => [item.file_name, item]));
    assert.equal(byName.get("PROPOSTA SCANDOLARA.pdf").document_role, "source");
    assert.equal(byName.get("PROPOSTA SCANDOLARA.pdf").ocr_attempt_count, 2);
    assert.equal(byName.get("PROPOSTA SCANDOLARA.pdf").ocr_attempts[0].result, "http_504");
    assert.equal(byName.get("PROPOSTA SCANDOLARA.pdf").proposal_primary, true);
    assert.equal(byName.get("PROPOSTA SCANDOLARA.pdf").passed_to_ai, true);
    assert.equal(byName.get("Allegato B_Format Proposta Savoy Procedura Proprietà.docx").document_role, "template");
    assert.equal(byName.get("Allegato B_Format Proposta Savoy Procedura Proprietà.docx").proposal_primary || false, false);
    assert.equal(byName.get("Allegato B_Format Proposta Savoy Procedura Proprietà.docx").passed_to_ai, false);
  } finally {
    restore();
  }
});

test("OCR failure plus uncompiled template does not promote the template", async () => {
  const restore = installPdfAppEnv();
  const pdfBuffer = Buffer.from("%PDF failed source");
  const templateBuffer = Buffer.from("PK fallback template");
  globalThis.fetch = async () => ({
    ok: false,
    status: 504,
    statusText: "Gateway Timeout",
    text: async () => "Gateway Timeout",
  });
  const events = new Map([["ocr-failure-template-fallback-test", { id: "ocr-failure-template-fallback-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  try {
    const result = await pipeline({
      eventId: "ocr-failure-template-fallback-test",
      body: { subject: "OCR_FAILURE_TEMPLATE_FALLBACK_TEST" },
      files: [
        {
          fieldname: "email_attachment_1",
          originalname: "PROPOSTA SCANDOLARA.pdf",
          mimetype: "application/pdf",
          buffer: pdfBuffer,
        },
        {
          fieldname: "email_attachment_2",
          originalname: "Allegato B_Format Proposta Savoy Procedura Proprietà.docx",
          mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: templateBuffer,
        },
      ],
      previousResult: {
        attachment_text_cache: Object.fromEntries([
          cachedTextEntry({ buffer: templateBuffer, fileName: "Allegato B_Format Proposta Savoy Procedura Proprietà.docx", format: "docx", text: proposalTemplateText(), source: "docx" }),
        ]),
      },
      skipAutoSend: true,
    });

    const byName = new Map(result.extraction_diagnostics.attachments.map((item) => [item.file_name, item]));
    assert.equal(byName.get("PROPOSTA SCANDOLARA.pdf").ocr_status, "http_504");
    assert.equal(byName.get("PROPOSTA SCANDOLARA.pdf").usable_text, false);
    assert.equal(byName.get("Allegato B_Format Proposta Savoy Procedura Proprietà.docx").document_role, "template");
    assert.equal(byName.get("Allegato B_Format Proposta Savoy Procedura Proprietà.docx").passed_to_ai, false);
    assert.equal(result.extraction_diagnostics.proposal_selection.status, "no_source_candidate");
    assert.equal(result.extraction_diagnostics.proposta_agent_runs.length, 0);
  } finally {
    restore();
  }
});

test("cached PDF-app OCR text is reused without a new OCR request", async () => {
  const restore = installPdfAppEnv();
  const pdfBuffer = Buffer.from("%PDF cached ocr source");
  const ocrText = `${compiledProposalText("Cached OCR source.")}\n`.repeat(8);
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ text: ocrText }),
    };
  };
  const events = new Map([["cached-ocr-proposal-test", { id: "cached-ocr-proposal-test", steps: [] }]]);
  const pipeline = makePipeline(events);

  try {
    const result = await pipeline({
      eventId: "cached-ocr-proposal-test",
      body: { subject: "CACHED_OCR_PROPOSAL_TEST" },
      files: [{
        fieldname: "email_attachment_1",
        originalname: "PROPOSTA SCANDOLARA.pdf",
        mimetype: "application/pdf",
        buffer: pdfBuffer,
      }],
      previousResult: {
        attachment_text_cache: Object.fromEntries([
          cachedTextEntry({ buffer: pdfBuffer, fileName: "PROPOSTA SCANDOLARA.pdf", format: "pdf", text: ocrText, source: "pdf_app" }),
        ]),
      },
      skipAutoSend: true,
    });

    const diagnostic = result.extraction_diagnostics.attachments.find((item) => item.file_name === "PROPOSTA SCANDOLARA.pdf");
    assert.equal(fetchCalled, false);
    assert.equal(diagnostic.ocr_status, "cache_hit");
    assert.equal(diagnostic.text_source, "pdf_app_ocr_cache");
    assert.equal(diagnostic.usable_text, true);
    assert.equal(diagnostic.passed_to_ai, true);
  } finally {
    restore();
  }
});

test("concurrent OCR for the same attachment hash uses one in-process PDF-app request", async () => {
  const restore = installPdfAppEnv();
  const pdfBuffer = Buffer.from("%PDF concurrent same hash");
  const ocrText = `${compiledProposalText("Concurrent OCR source.")}\n`.repeat(8);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ text: ocrText }),
    };
  };
  const events = new Map([
    ["concurrent-ocr-test-a", { id: "concurrent-ocr-test-a", steps: [] }],
    ["concurrent-ocr-test-b", { id: "concurrent-ocr-test-b", steps: [] }],
  ]);
  const pipeline = makePipeline(events);
  const request = (eventId) => pipeline({
    eventId,
    body: { subject: eventId },
    files: [{
      fieldname: "email_attachment_1",
      originalname: "PROPOSTA SCANDOLARA.pdf",
      mimetype: "application/pdf",
      buffer: pdfBuffer,
    }],
    skipAutoSend: true,
  });

  try {
    const [first, second] = await Promise.all([
      request("concurrent-ocr-test-a"),
      request("concurrent-ocr-test-b"),
    ]);

    assert.equal(calls, 1);
    assert.equal(first.extraction_diagnostics.attachments.find((item) => item.file_name === "PROPOSTA SCANDOLARA.pdf").ocr_status, "completed");
    assert.equal(second.extraction_diagnostics.attachments.find((item) => item.file_name === "PROPOSTA SCANDOLARA.pdf").ocr_status, "completed");
  } finally {
    restore();
  }
});
