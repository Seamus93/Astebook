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
    assert.match(body.fileUrl, /^https:\/\/astebook\.example\/api\/v1\/ocr-inputs\//);
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
    requestedFileUrl = body.fileUrl;
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
