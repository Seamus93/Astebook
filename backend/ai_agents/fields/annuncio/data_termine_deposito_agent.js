import { createFieldAgent } from "../create_field_agent.js";

export const annuncioDataTermineDepositoAgent = createFieldAgent({
  id: "annuncio_data_termine_deposito_extractor",
  scope: "annuncio",
  field: "data_termine_deposito",
  description: "Data limite per il deposito/presentazione delle offerte.",
  output: '{ "data_termine_deposito": "YYYY-MM-DD" | null }',
  hints: ["Cerca deposito offerte, presentazione offerte, pervenire entro.", "Normalizza in ISO."],
});
