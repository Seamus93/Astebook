import { createFieldAgent } from "../create_field_agent.js";

export const annuncioOraTermineDepositoAgent = createFieldAgent({
  id: "annuncio_ora_termine_deposito_extractor",
  scope: "annuncio",
  field: "ora_termine_deposito",
  description: "Ora limite per il deposito/presentazione delle offerte.",
  output: '{ "ora_termine_deposito": "HH:MM" | null }',
  hints: ["Cerca ore HH:MM vicino a deposito/presentazione/pervenire.", "Normalizza in HH:MM."],
});
