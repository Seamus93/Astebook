import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeAnnuncioGaraTimesFromText } from "../lib/ai.js";

test("annuncio gara times are cleared when only auction date is present", () => {
  const annuncio = {
    data_vendita: "2026-09-24",
    ora_gara_inizio: "12:00",
    ora_gara_fine: null,
    ora_termine_deposito: "12:00",
  };

  const text = [
    "Eventuali richieste per sopralluogo entro il 14/09/2026 ore 12:00",
    "L'offerta scritta dovra pervenire inderogabilmente entro il 21/09/2026 ore 12:00",
    "Asta 24/09/2026",
  ].join("\n");

  const result = sanitizeAnnuncioGaraTimesFromText(annuncio, text);

  assert.equal(result.ora_gara_inizio, null);
  assert.equal(result.ora_gara_fine, null);
});

test("annuncio gara times are kept when an explicit auction range is present", () => {
  const annuncio = {
    data_vendita: "2026-09-24",
    ora_gara_inizio: "09:30",
    ora_gara_fine: "12:30",
  };

  const text = "Gara telematica dalle ore 09:30 alle ore 12:30 del 24/09/2026";

  const result = sanitizeAnnuncioGaraTimesFromText(annuncio, text);

  assert.equal(result.ora_gara_inizio, "09:30");
  assert.equal(result.ora_gara_fine, "12:30");
});
