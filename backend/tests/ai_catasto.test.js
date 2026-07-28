import assert from "node:assert/strict";
import { test } from "node:test";

test("proposal extraction recovers cadastral values without subalterno", async () => {
  const previousMock = process.env.ASTEBOOK_AI_MOCK;
  process.env.ASTEBOOK_AI_MOCK = "1";
  try {
    const { aiExtractProposta } = await import("../lib/ai.js");
    const extracted = await aiExtractProposta({
      fileName: "Proposta offerente.PDF",
      text: `
        1. Descrizione Immobile
        Immobile sito in Ferrara - Via Francesco Luigi Ferrari, 31 interno C - Piani T-1-2
        codice Comune D458 - Foglio 98 . Particella 959 - Zona Cens.2 - Categoria D/1
        - rendita EUR 8.624,00 - di seguito L'immobile
      `,
    });

    assert.equal(extracted.catasto.foglio, "98");
    assert.equal(extracted.catasto.particella, "959");
    assert.equal(extracted.catasto.mappale, "959");
    assert.equal(extracted.catasto.subalterno, null);
    assert.equal(extracted.catasto.categoria, "D/1");
  } finally {
    if (previousMock === undefined) {
      delete process.env.ASTEBOOK_AI_MOCK;
    } else {
      process.env.ASTEBOOK_AI_MOCK = previousMock;
    }
  }
});

test("proposal catasto normalization replaces OCR label tokens with fallback values", async () => {
  const { normalizePropostaCatasto } = await import("../lib/ai.js");

  const normalized = normalizePropostaCatasto(
    {
      foglio: "part",
      particella: "-",
      mappale: "-",
      subalterno: "cat",
      categoria: "-",
    },
    {
      foglio: "98",
      particella: "959",
      mappale: "959",
      subalterno: null,
      categoria: "D/1",
    }
  );

  assert.deepEqual(normalized, {
    foglio: "98",
    particella: "959",
    mappale: "959",
    subalterno: null,
    categoria: "D/1",
  });
});
