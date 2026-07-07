import { createFieldAgent } from "../create_field_agent.js";

export const aggiornatoIlAgent = createFieldAgent({
  id: "annuncio_aggiornato_il_extractor",
  scope: "annuncio",
  field: "aggiornato_il",
  description: "Data aggiornamento scheda annuncio.",
  output: '{ "aggiornato_il": "YYYY-MM-DD" | null }',
  hints: ["Cerca Aggiornato il.", "Normalizza in ISO YYYY-MM-DD."],
});
