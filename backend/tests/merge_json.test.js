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
