import test from "node:test";
import assert from "node:assert/strict";
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
