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
