import test from "node:test";
import assert from "node:assert/strict";

import { scrapePropostaFromText } from "../scrapers/scrape_proposta.js";
import { buildDocumentFields, fillTemplate } from "../lib/document_builder.js";

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

test("proposal cadastral parser extracts foglio mappale subalterno and categoria", () => {
  const text = [
    "1. Descrizione Immobile",
    "Immobile sito a Roma in Via Quirino Majorana n. 171 censito al N.C.E.U. del medesimo Comune",
    "- foglio 463, part. 174, sub 733, cat. A/10",
  ].join("\n");

  const result = scrapePropostaFromText(text, "Proposta scannerizzata.pdf");

  assert.equal(result.indirizzo_immobile, "Via Quirino Majorana 171");
  assert.equal(result.catasto.foglio, "463");
  assert.equal(result.catasto.particella, "174");
  assert.equal(result.catasto.mappale, "174");
  assert.equal(result.catasto.subalterno, "733");
  assert.equal(result.catasto.categoria, "A/10");
});

test("proposal cadastral parser keeps multiple cadastral rows", () => {
  const text = [
    "1. Descrizione Immobile",
    "Immobile sito a Roma in Via Quirino Majorana n. 171 censito al N.C.E.U. del medesimo Comune",
    "- foglio 463, part. 174, sub 733, cat. A/10",
    "Via Quirino Majorana n. 171",
    "censito al N.C.T del medesimo Comune",
    "-foglio 463, mappale 174",
  ].join("\n");

  const result = scrapePropostaFromText(text, "Proposta scannerizzata.pdf");

  assert.equal(result.catasto_voci.length, 2);
  assert.deepEqual(result.catasto_voci[0], {
    foglio: "463",
    particella: "174",
    mappale: "174",
    subalterno: "733",
    sezione: null,
    categoria: "A/10",
  });
  assert.deepEqual(result.catasto_voci[1], {
    foglio: "463",
    particella: "174",
    mappale: "174",
    subalterno: null,
    sezione: null,
    categoria: null,
  });

  const fields = buildDocumentFields({
    result: {
      codice_pratica: "TEST",
      extracted: {
        proposta: result,
        annuncio: {},
      },
    },
  });
  assert.equal(
    fields.catasto_identificazione,
    "Foglio 463, mapp. 174, sub 733, cat A/10\nFoglio 463, mapp. 174"
  );
});

test("document placeholders without values are rendered empty", () => {
  const fields = buildDocumentFields({
    result: {
      codice_pratica: "TEST",
      extracted: {
        proposta: {
          indirizzo_immobile: "Via Quirino Majorana 171",
          catasto: {},
        },
        annuncio: {},
      },
    },
  });

  assert.equal(fields.indirizzo, "Via Quirino Majorana 171");
  assert.equal(fields.comune, " ");
  assert.equal(fields.provincia, " ");
  assert.equal(fields.cap, " ");
  assert.equal(fillTemplate("Nel Comune di {{comune}} ({{provincia}}), {{indirizzo}} {{cap}} {{missing}}", fields), "Nel Comune di   ( ), Via Quirino Majorana 171    ");
});
