import test from "node:test";
import assert from "node:assert/strict";

import { scrapeAnnuncioFromText } from "../scrapers/scrape_annuncio.js";

test("annuncio address parser handles city-first addresses", () => {
  const result = scrapeAnnuncioFromText("Barzanò, Via Leonardo Da Vinci, 48", "Corpo email");

  assert.equal(result.indirizzo_raw, "Barzanò, Via Leonardo Da Vinci, 48");
  assert.equal(result.indirizzo, "Via Leonardo Da Vinci, 48, Barzanò");
});

test("annuncio parser extracts price caution and offer deadline", () => {
  const result = scrapeAnnuncioFromText(
    [
      "Prezzo Base: Euro 210.000,00",
      "Offerta minima: Euro 205.000,00",
      "Cauzione pari al 10%",
      "Le offerte dovranno pervenire entro il 27/07/2026 ore 12:00",
    ].join("\n"),
    "Corpo email"
  );

  assert.equal(result.prezzo_base, 210000);
  assert.equal(result.offerta_minima, 205000);
  assert.equal(result.deposito_cauzionale, null);
  assert.equal(result.deposito_cauzionale_percentuale, 10);
  assert.equal(result.data_termine_offerta, "2026-07-27");
  assert.equal(result.ora_termine_offerta, "12:00");
  assert.equal(result.data_termine_deposito, "2026-07-27");
  assert.equal(result.ora_termine_deposito, "12:00");
});

test("annuncio parser handles dotted decimal money from email html", () => {
  const result = scrapeAnnuncioFromText("Prezzo Base : Euro 210.000.00", "Corpo email");

  assert.equal(result.prezzo_base, 210000);
});
