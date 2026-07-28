import assert from "node:assert/strict";
import { test } from "node:test";

test("proposal extraction recovers full italian iban with irregular spaces", async () => {
  const previousMock = process.env.ASTEBOOK_AI_MOCK;
  process.env.ASTEBOOK_AI_MOCK = "1";
  try {
    const { aiExtractProposta } = await import("../lib/ai.js");
    const extracted = await aiExtractProposta({
      fileName: "Proposta test.pdf",
      text: `
        Deposito cauzionale da versare sul conto dedicato.
        IBAN: IT60 X054 2811 1010 0000 0123 456
        Beneficiario: Astebook Test S.r.l.
      `,
    });

    assert.equal(extracted.iban_beneficiario, "IT60X0542811101000000123456");
  } finally {
    if (previousMock === undefined) {
      delete process.env.ASTEBOOK_AI_MOCK;
    } else {
      process.env.ASTEBOOK_AI_MOCK = previousMock;
    }
  }
});
