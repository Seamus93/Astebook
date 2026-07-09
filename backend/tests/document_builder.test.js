import test from "node:test";
import assert from "node:assert/strict";

import { buildDocumentFields } from "../lib/document_builder.js";

test("document fields prefer normalized merged address and redazione", () => {
  const fields = buildDocumentFields({
    result: {
      merged: {
        immobile: {
          indirizzo: "Via Cosimo Argentieri, 156-158-160",
          comune: "Latiano",
          provincia: "BR",
        },
        redazione: {
          luogo: "Milano",
        },
      },
      extracted: {
        proposta: {
          indirizzo_immobile: "Via Cosimo Argentieri, 156-158-160, Latiano (Br)",
          luogo_redazione: "_______________________________________________________________________________",
        },
      },
    },
  });

  assert.equal(fields.comune, "Latiano");
  assert.equal(fields.provincia, "BR");
  assert.equal(fields.indirizzo, "Via Cosimo Argentieri, 156-158-160");
  assert.equal(fields.luogo_redazione, "Milano");
});
