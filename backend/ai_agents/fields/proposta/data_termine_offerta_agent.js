import { createFieldAgent } from "../create_field_agent.js";

export const propostaDataTermineOffertaAgent = createFieldAgent({
  id: "proposta_data_termine_offerta_extractor",
  scope: "proposta",
  field: "data_termine_offerta",
  description: "Data limite per presentazione/offerta nella proposta.",
  output: '{ "data_termine_offerta": "YYYY-MM-DD" | null }',
  hints: ["Cerca offerta/proposta deve pervenire entro.", "Normalizza in ISO."],
});
