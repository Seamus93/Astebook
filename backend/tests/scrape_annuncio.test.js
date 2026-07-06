import test from "node:test";
import assert from "node:assert/strict";

import { scrapeAnnuncioFromText } from "../scrapers/scrape_annuncio.js";

test("annuncio address parser handles city-first addresses", () => {
  const result = scrapeAnnuncioFromText("Barzanò, Via Leonardo Da Vinci, 48", "Corpo email");

  assert.equal(result.indirizzo_raw, "Barzanò, Via Leonardo Da Vinci, 48");
  assert.equal(result.indirizzo, "Via Leonardo Da Vinci, 48, Barzanò");
});
