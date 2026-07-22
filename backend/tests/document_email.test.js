import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDocumentQualityReport } from "../lib/document_email.js";
import { finalizeZapierResult } from "../lib/extraction_result.js";

test("document quality report explains proposal address recovered from Immobiliare", () => {
  const event = {
    result: {
      missing_fields: [
        {
          field: "Indirizzo Immobile",
          path: "extracted.proposta.indirizzo_immobile",
          expected_file: "Proposta",
          message: "Indirizzo Immobile: Dato non trovato o mancante. (Expected File Proposta)",
        },
      ],
      extracted: {
        annuncio: {
          file_pdf: "Immobiliare.it",
          source_priority: "immobiliare",
          indirizzo: "Via Macello, Cavour, TO",
        },
        proposta: {},
      },
      merged: {
        immobile: {
          indirizzo: "Via Macello",
          comune: "Cavour",
          provincia: "TO",
        },
      },
    },
    steps: [
      {
        message: "Announcement extracted data replaced from Immobiliare.it",
        data: { file_name: "Immobiliare.it" },
      },
    ],
  };

  const report = buildDocumentQualityReport(event);

  assert.equal(report.issues.length, 1);
  assert.match(report.issues[0].diagnostics, /Manca nella Proposta/);
  assert.match(report.issues[0].diagnostics, /Immobiliare\.it\/Apify/);
  assert.match(report.issues[0].diagnostics, /Descrizione immobile/);
});

test("catasto missing fields no longer advertise Visura extraction", () => {
  const result = finalizeZapierResult({
    extracted: {
      annuncio: { indirizzo: "Via Roma", offerta_minima: 100000, data_vendita: "20/07/2026", ora_vendita: "10:00" },
      proposta: {
        proponente: { nominativo: "Mario Rossi" },
        indirizzo_immobile: "Via Roma",
        prezzo_offerto: 101000,
        iban_beneficiario: "IT60X0542811101000000123456",
        catasto: {},
      },
    },
  });

  const catastoFields = result.missing_fields.filter((field) => /^Catasto/.test(field.field));

  assert.equal(catastoFields.length, 3);
  assert.deepEqual(Array.from(new Set(catastoFields.map((field) => field.expected_file))), ["Proposta"]);
  assert.equal(catastoFields.some((field) => /Visura/.test(field.message)), false);
});
