import { createFieldAgent } from "../create_field_agent.js";

export const propostaDataTermineDepositoAgent = createFieldAgent({
  id: "proposta_data_termine_deposito_extractor",
  scope: "proposta",
  field: "data_termine_deposito",
  description: "Data limite per deposito/presentazione della proposta.",
  output: '{ "data_termine_deposito": "YYYY-MM-DD" | null }',
  hints: ["Cerca deposito, presentazione, pervenire entro.", "Normalizza in ISO."],
});
