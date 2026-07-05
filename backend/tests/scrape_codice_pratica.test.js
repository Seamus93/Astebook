import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveCodicePraticaFromPayload,
  scrapeCodicePraticaFromText,
} from "../scrapers/scrape_codice_pratica.js";

test("codice pratica is extracted from subject first", () => {
  const code = resolveCodicePraticaFromPayload({
    subject: "Fwd: RM_Roma_TOL_202949480010 PROCEDURA COMPETITIVA",
  });

  assert.equal(code, "RM_ROMA_TOL_202949480010");
});

test("codice pratica can fall back to announcement text", () => {
  const fromSubject = resolveCodicePraticaFromPayload({
    subject: "Procedura competitiva senza codice in oggetto",
  });
  const fromAnnuncio = scrapeCodicePraticaFromText(
    "Disciplinare di gara relativo alla procedura RM Roma TOL 202949480010."
  );

  assert.equal(fromSubject, null);
  assert.equal(fromAnnuncio, "RM_ROMA_TOL_202949480010");
});
