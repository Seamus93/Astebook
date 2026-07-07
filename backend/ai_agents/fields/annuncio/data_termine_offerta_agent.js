import { createFieldAgent } from "../create_field_agent.js";

export const annuncioDataTermineOffertaAgent = createFieldAgent({
  id: "annuncio_data_termine_offerta_extractor",
  scope: "annuncio",
  field: "data_termine_offerta",
  description: "Data entro cui deve pervenire l'offerta/proposta.",
  output: '{ "data_termine_offerta": "YYYY-MM-DD" | null }',
  hints: ["Cerca formule come offerte dovranno pervenire entro il, deposito offerte fino al.", "Normalizza in ISO."],
});
