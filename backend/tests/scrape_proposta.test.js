import test from "node:test";
import assert from "node:assert/strict";

import { scrapePropostaFromText } from "../scrapers/scrape_proposta.js";

test("proposal address prefers property context over company and IBAN context", () => {
  const text = [
    "Beneficiario cauzione IRESALES SRL",
    "Sede Via V. Alfieri 1",
    "IBAN IT79U0306912711100000060740",
    "Oggetto dell'offerta immobile sito in Via Quirino Majorana n.171",
    "Identificazione catastale Foglio 463 Particella 174 Subalterno 733",
  ].join("\n");

  const result = scrapePropostaFromText(text, "Proposta scannerizzata.pdf");

  assert.equal(result.indirizzo_immobile, "Via Quirino Majorana 171");
  assert.equal(result.iban_beneficiario, "IT79U0306912711100000060740");
});
