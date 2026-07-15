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
