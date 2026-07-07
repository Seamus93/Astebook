import { createFieldAgent } from "../create_field_agent.js";

export const dataVenditaAgent = createFieldAgent({
  id: "annuncio_data_vendita_extractor",
  scope: "annuncio",
  field: "data_vendita",
  description: "Data della gara/vendita indicata nell'annuncio.",
  output: '{ "data_vendita": "YYYY-MM-DD" | null }',
  hints: ["Cerca vicino a Data vendita, Data gara, Asta, Vendita.", "Normalizza sempre in ISO YYYY-MM-DD."],
});
