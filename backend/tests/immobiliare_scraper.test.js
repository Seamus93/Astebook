import test from "node:test";
import assert from "node:assert/strict";

import {
  extractImmobiliareAnnouncementUrls,
  parseImmobiliareHtml,
  scrapeImmobiliareAnnouncement,
} from "../lib/immobiliare_scraper.js";

test("immobiliare scraper extracts only announcement detail urls", () => {
  const urls = extractImmobiliareAnnouncementUrls(`
    Vedi https://www.immobiliare.it/annunci/123456789/
    Ignora https://www.immobiliare.it/search-list/?id=1
    Duplicato https://www.immobiliare.it/annunci/123456789/.
  `);

  assert.deepEqual(urls, ["https://www.immobiliare.it/annunci/123456789/"]);
});

test("immobiliare scraper parses listing metadata without using it for merge", () => {
  const parsed = parseImmobiliareHtml(
    `<!doctype html>
    <html>
      <head>
        <title>Ufficio in vendita</title>
        <meta name="description" content="Uffici siti al quinto piano, liberi da subito." />
        <script type="application/ld+json">
          {
            "@type": "Product",
            "name": "Ufficio in Piazza Roma",
            "description": "Descrizione da annuncio Immobiliare.",
            "address": {
              "streetAddress": "Piazza Roma 1",
              "addressLocality": "Ancona"
            },
            "offers": {
              "price": "151000",
              "availability": "https://schema.org/InStock"
            }
          }
        </script>
      </head>
    </html>`,
    "https://www.immobiliare.it/annunci/123456789/"
  );

  assert.equal(parsed.title, "Ufficio in Piazza Roma");
  assert.equal(parsed.descrizione, undefined);
  assert.equal(parsed.description, "Descrizione da annuncio Immobiliare.");
  assert.equal(parsed.prezzo, 151000);
  assert.equal(parsed.disponibilita, "InStock");
  assert.equal(parsed.indirizzo, "Piazza Roma 1, Ancona");
});

test("immobiliare scraper fetches one supported announcement url", async () => {
  const result = await scrapeImmobiliareAnnouncement("https://www.immobiliare.it/annunci/123456789/", {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => `<meta property="og:title" content="Annuncio test"><meta property="og:description" content="Descrizione test">`,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.title, "Annuncio test");
  assert.equal(result.data.description, "Descrizione test");
});

test("immobiliare scraper reports blocked access clearly", async () => {
  const result = await scrapeImmobiliareAnnouncement("https://www.immobiliare.it/annunci/123456789/", {
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      text: async () => "",
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.http_status, 403);
  assert.equal(result.error, "Accesso bloccato da Immobiliare.it.");
});

test("immobiliare scraper can use Apify actor dataset output", async () => {
  const calls = [];
  const result = await scrapeImmobiliareAnnouncement("https://www.immobiliare.it/annunci/123456789/", {
    provider: "apify",
    apifyConfig: {
      apiBaseUrl: "https://api.apify.test",
      token: "token",
      actorId: "user/immobiliare-scraper",
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === "https://api.apify.test/v2/actors/user~immobiliare-scraper/run-sync-get-dataset-items?token=token") {
        assert.equal(options.method, "POST");
        assert.deepEqual(JSON.parse(options.body), {
          startUrls: [{ url: "https://www.immobiliare.it/annunci/123456789/" }],
          maxItems: 1,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ([
            {
              url: "https://www.immobiliare.it/annunci/123456789/",
              title: "Ufficio in vendita",
              description: "Uffici al quinto piano.",
              price: "€ 151.000",
              availability: "libero",
              address: {
                street: "Piazza Roma",
                streetNumber: "1",
                city: "Ancona",
                province: "AN",
              },
            },
          ]),
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.provider, "apify");
  assert.equal(result.data.source, "apify");
  assert.equal(result.data.title, "Ufficio in vendita");
  assert.equal(result.data.prezzo, 151000);
  assert.equal(result.data.disponibilita, "libero");
  assert.equal(result.data.indirizzo, "Piazza Roma 1 Ancona AN");
});

test("immobiliare scraper adapts input for Azzouzana search-url actor", async () => {
  const result = await scrapeImmobiliareAnnouncement("https://www.immobiliare.it/annunci/123456789/", {
    provider: "apify",
    apifyConfig: {
      apiBaseUrl: "https://api.apify.test",
      token: "token",
      actorId: "azzouzana/immobiliare-it-listing-page-scraper-by-search-url",
    },
    fetchImpl: async (url, options = {}) => {
      assert.equal(
        url,
        "https://api.apify.test/v2/actors/azzouzana~immobiliare-it-listing-page-scraper-by-search-url/run-sync-get-dataset-items?token=token"
      );
      assert.deepEqual(JSON.parse(options.body), {
        startUrl: "https://www.immobiliare.it/annunci/123456789/",
        maxItems: 10,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ([{ title: "Da search actor", price: "100000" }]),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.title, "Da search actor");
});

test("immobiliare scraper normalizes nested Azzouzana-like listing fields", async () => {
  const result = await scrapeImmobiliareAnnouncement("https://www.immobiliare.it/annunci/123456789/", {
    provider: "apify",
    apifyConfig: {
      apiBaseUrl: "https://api.apify.test",
      token: "token",
      actorId: "azzouzana/immobiliare-it-listing-page-scraper-by-search-url",
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ([{
        realEstate: {
          url: "https://www.immobiliare.it/annunci/123456789/",
          title: "Ufficio in Piazza Roma",
          description: "Uffici siti al quinto piano.",
          price: { value: 200000, formattedValue: "€ 200.000" },
          state: { name: "Libero" },
          typology: { name: "Ufficio" },
          location: {
            address: "Piazza Roma",
            streetNumber: "1",
            city: { name: "Ancona" },
            province: { name: "AN" },
          },
          properties: [{
            mainFeatures: [
              { label: "superficie", value: "285 m²" },
              { label: "locali", value: "9" },
            ],
          }],
        },
      }]),
    }),
  });

  assert.equal(result.data.title, "Ufficio in Piazza Roma");
  assert.equal(result.data.description, "Uffici siti al quinto piano.");
  assert.equal(result.data.prezzo, 200000);
  assert.equal(result.data.prezzo_raw, "200000");
  assert.equal(result.data.disponibilita, "Libero");
  assert.equal(result.data.indirizzo, "Piazza Roma 1 Ancona AN");
  assert.equal(result.data.superficie_mq, "285 m²");
  assert.equal(result.data.rooms, "9");
  assert.equal(result.data.property_type, "Ufficio");
});
