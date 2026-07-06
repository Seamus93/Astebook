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

test("proposal parser extracts company proponente block", () => {
  const text = [
    "In caso di società:",
    "La Società italiana Investimenti Immobiliari S.r.l., con sede in Ascoli Piceno (AP), Via degli Anemoni n. 9/a, iscritta",
    "al Registro delle Imprese di Ascoli Piceno n. REA – AP-206487, c.f. e P.IVA 02359420441 in persona del Dott.",
    "Augusto Paolini, amministratore unico e legale rappresentante, documento di identità (C.I.) n. CA66060LP, cell.",
    "3208183295, munito dei poteri di legale rappresentanza come esso dichiara (il “Proponente”)",
    "*****",
  ].join("\n");

  const result = scrapePropostaFromText(text, "Proposta scannerizzata.pdf");

  assert.equal(result.proponente.nominativo, "italiana Investimenti Immobiliari S.r.l.");
  assert.equal(result.proponente.societa, "italiana Investimenti Immobiliari S.r.l.");
  assert.equal(result.proponente.sede, "Ascoli Piceno (AP), Via degli Anemoni n. 9/a");
  assert.equal(result.proponente.rappresentante, "Augusto Paolini");
  assert.equal(result.proponente.codice_fiscale, "02359420441");
  assert.equal(result.proponente.partita_iva, "02359420441");
  assert.equal(result.proponente.documento, "CA66060LP");
  assert.equal(result.proponente.cellulare, "3208183295");
});

test("proposal cadastral parser ignores non numeric mappale false positives", () => {
  const result = scrapePropostaFromText(
    "Identificazione catastale foglio 463 particolare descrizione sub 733 cat. A/10",
    "Proposta scannerizzata.pdf"
  );

  assert.equal(result.catasto.foglio, "463");
  assert.equal(result.catasto.mappale, null);
  assert.equal(result.catasto.subalterno, "733");
  assert.equal(result.catasto.categoria, "A/10");
});

test("proposal parser extracts price caution and offer deadline", () => {
  const text = [
    "Il Proponente offre il prezzo di euro 210.000,00",
    "Deposito cauzionale pari al 10% del prezzo offerto",
    "La proposta dovrà pervenire entro il 27/07/2026 ore 12:00",
  ].join("\n");

  const result = scrapePropostaFromText(text, "Proposta scannerizzata.pdf");

  assert.equal(result.prezzo_offerto, 210000);
  assert.equal(result.deposito_cauzionale, null);
  assert.equal(result.deposito_cauzionale_percentuale, 10);
  assert.equal(result.data_termine_offerta, "2026-07-27");
  assert.equal(result.ora_termine_offerta, "12:00");
  assert.equal(result.data_termine_deposito, "2026-07-27");
  assert.equal(result.ora_termine_deposito, "12:00");
});
