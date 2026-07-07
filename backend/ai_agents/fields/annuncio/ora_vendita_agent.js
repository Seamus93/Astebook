import { createFieldAgent } from "../create_field_agent.js";

export const oraVenditaAgent = createFieldAgent({
  id: "annuncio_ora_vendita_extractor",
  scope: "annuncio",
  field: "ora_vendita",
  description: "Ora della gara/vendita indicata nell'annuncio.",
  output: '{ "ora_vendita": "HH:MM" | null }',
  hints: ["Cerca vicino alla data vendita/gara.", "Normalizza in formato 24h HH:MM."],
});
