import test from "node:test";
import assert from "node:assert/strict";

import { mergeAnnuncioProposta } from "../lib/merge_json.js";

test("merge keeps street-only proposal address as address and uses prezzo_base fallback", () => {
  const merged = mergeAnnuncioProposta(
    {
      file_pdf: "Corpo email",
      prezzo_base: 210000,
      offerta_minima: null,
      rilancio_minimo: 1000,
    },
    {
      file_pdf: "Proposta corretta data.pdf",
      indirizzo_immobile: "Via Quirino Majorana 171",
    }
  );

  assert.equal(merged.immobile.indirizzo, "Via Quirino Majorana 171");
  assert.equal(merged.immobile.comune, " ");
  assert.equal(merged.gara.offerta_minima, 210000);
  assert.equal(merged.gara.offerta_minima_ammissibile, 210000);
});

test("merge splits proposal address with trailing comune and defaults placeholder redazione to Milano", () => {
  const merged = mergeAnnuncioProposta(
    {
      file_pdf: "Corpo email",
      offerta_minima: 130000,
    },
    {
      file_pdf: "proposta d'acquisto.pdf",
      indirizzo_immobile: "Via Cosimo Argentieri, 156-158-160, Latiano (Br)",
      luogo_redazione: "_______________________________________________________________________________",
    }
  );

  assert.equal(merged.immobile.indirizzo, "Via Cosimo Argentieri, 156-158-160");
  assert.equal(merged.immobile.comune, "Latiano");
  assert.equal(merged.immobile.provincia, "BR");
  assert.equal(merged.redazione.luogo, "Milano");
});
