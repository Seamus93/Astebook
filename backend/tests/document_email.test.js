import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDocumentQualityReport } from "../lib/document_email.js";
import { finalizeZapierResult } from "../lib/extraction_result.js";

test("document quality report omits proposal address recovered from Immobiliare", () => {
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

  assert.equal(report.ok, true);
  assert.equal(report.issues.length, 0);
});

test("document quality report omits announcement fields recovered from Apify", () => {
  const event = {
    result: {
      missing_fields: [
        {
          field: "Annuncio - Indirizzo",
          path: "extracted.annuncio.indirizzo",
          expected_file: "Annuncio",
          message: "Annuncio - Indirizzo: Dato non trovato o mancante. (Expected File Annuncio)",
        },
        {
          field: "Offerta Minima",
          path: "extracted.annuncio.offerta_minima",
          expected_file: "Annuncio",
          message: "Offerta Minima: Dato non trovato o mancante. (Expected File Annuncio)",
        },
        {
          field: "Data Vendita",
          path: "extracted.annuncio.data_vendita",
          expected_file: "Annuncio",
          message: "Data Vendita: Dato non trovato o mancante. (Expected File Annuncio)",
        },
        {
          field: "Ora Vendita",
          path: "extracted.annuncio.ora_vendita",
          expected_file: "Annuncio",
          message: "Ora Vendita: Dato non trovato o mancante. (Expected File Annuncio)",
        },
      ],
      extracted: {
        annuncio: {
          source: "apify",
          file_pdf: "Immobiliare.it",
          indirizzo: "viale Andrea Palladio 28, Verona, Stadio, VR",
          offerta_minima: 220000,
          data_vendita: "28/09/2026",
          ora_vendita: "11:00",
        },
        proposta: {},
      },
      merged: {
        immobile: {
          indirizzo: "viale Andrea Palladio 28",
          comune: "Verona",
          provincia: "VR",
        },
        asta: {
          data: "28/09/2026",
          ora: "11:00",
        },
        gara: {
          offerta_minima: 220000,
        },
      },
    },
  };

  const report = buildDocumentQualityReport(event);

  assert.equal(report.ok, true);
  assert.equal(report.issues.length, 0);
});

test("document quality report omits fields available as derived document values", () => {
  const event = {
    result: {
      missing_fields: [
        {
          field: "Data Vendita",
          path: "extracted.annuncio.data_vendita",
          expected_file: "Annuncio",
          message: "Data Vendita: Dato non trovato o mancante. (Expected File Annuncio)",
        },
        {
          field: "Ora Vendita",
          path: "extracted.annuncio.ora_vendita",
          expected_file: "Annuncio",
          message: "Ora Vendita: Dato non trovato o mancante. (Expected File Annuncio)",
        },
      ],
      extracted: {
        annuncio: {
          source: "apify",
          file_pdf: "Immobiliare.it",
          data_termine_deposito: "2026-09-25",
        },
        proposta: {},
      },
      merged: {
        gara: {
          data_gara: "2026-09-28",
          ora_inizio: "09:00",
        },
        deposito: {
          data_termine_deposito: "2026-09-25",
        },
      },
    },
  };

  const report = buildDocumentQualityReport(event);

  assert.equal(report.ok, true);
  assert.equal(report.issues.length, 0);
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

test("catasto diagnostics ignore unrelated commission attachments", () => {
  const event = {
    result: {
      missing_fields: [
        {
          field: "Catasto - Particella",
          path: "extracted.proposta.catasto.particella",
          expected_file: "Proposta",
          message: "Catasto - Particella: Dato non trovato o mancante. (Expected File Proposta)",
        },
      ],
      extracted: {
        annuncio: {},
        proposta: { file_pdf: "Proposta offerente.PDF", catasto: {} },
      },
    },
    steps: [
      {
        message: "Local PDF text extraction completed",
        data: { file_name: "Proposta offerente.PDF", text_length: 1200 },
      },
      {
        message: "Proposal AI extraction completed",
        data: { file_name: "Proposta offerente.PDF" },
      },
      {
        message: "DOCX text extraction completed",
        data: { file_name: "provvigione su raccolta offerte Jeggred.docx", text_length: 800 },
      },
      {
        message: "Commission AI extraction completed",
        data: { file_name: "provvigione su raccolta offerte Jeggred.docx" },
      },
    ],
  };

  const report = buildDocumentQualityReport(event);

  assert.equal(report.issues.length, 1);
  assert.match(report.issues[0].diagnostics, /Proposta offerente\.PDF/);
  assert.doesNotMatch(report.issues[0].diagnostics, /provvigione su raccolta offerte/);
  assert.doesNotMatch(report.issues[0].diagnostics, /Commission AI extraction/);
});
