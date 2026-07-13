import test from "node:test";
import assert from "node:assert/strict";

import { buildDocumentFields } from "../lib/document_builder.js";
import { documentDisplayTitle, documentFileName } from "../lib/document_naming.js";

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
  assert.equal(fields.localizzazione, "Latiano (BR) in Via Cosimo Argentieri, 156-158-160");
  assert.equal(fields.luogo_redazione, "Milano");
});

test("document localizzazione omits empty province parentheses", () => {
  const fields = buildDocumentFields({
    result: {
      merged: {
        immobile: {
          indirizzo: "Via Aiaccia, 3",
          comune: "Collesalvetti",
          provincia: " ",
        },
      },
    },
  });

  assert.equal(fields.localizzazione, "Collesalvetti in Via Aiaccia, 3");
});

test("document fields do not use technical email message id as practice code", () => {
  const fields = buildDocumentFields({
    metadata: {
      email_id: "<VI2P193MB3030B5C22905C3707F2A0BF4FD2D2@VI2P193MB3030.EURP193.PROD.OUTLOOK.COM>",
    },
    result: {},
  });

  assert.equal(fields.codice_pratica, " ");
});

test("document naming uses AI Intrum disciplinary title and procedure code", () => {
  const event = {
    result: {
      codice_pratica: "TE_NOTA_10533833",
    },
  };

  assert.equal(documentDisplayTitle(event), "AI Intrum - DISCIPLINARE DI GARA TE_NOTA_10533833");
  assert.equal(documentFileName(event, "pdf"), "AI Intrum - DISCIPLINARE DI GARA TE_NOTA_10533833.pdf");
});
