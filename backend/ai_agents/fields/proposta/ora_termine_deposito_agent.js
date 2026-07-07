import { createFieldAgent } from "../create_field_agent.js";

export const propostaOraTermineDepositoAgent = createFieldAgent({
  id: "proposta_ora_termine_deposito_extractor",
  scope: "proposta",
  field: "ora_termine_deposito",
  description: "Ora limite per deposito/presentazione della proposta.",
  output: '{ "ora_termine_deposito": "HH:MM" | null }',
  hints: ["Cerca ore HH:MM vicino a deposito/presentazione/pervenire.", "Normalizza in HH:MM."],
});
