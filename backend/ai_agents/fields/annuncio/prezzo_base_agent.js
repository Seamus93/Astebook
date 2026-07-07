import { createFieldAgent } from "../create_field_agent.js";

export const prezzoBaseAgent = createFieldAgent({
  id: "annuncio_prezzo_base_extractor",
  scope: "annuncio",
  field: "prezzo_base",
  description: "Prezzo base o base d'asta dell'immobile.",
  output: '{ "prezzo_base": number | null }',
  hints: ["Cerca Prezzo base, Base d'asta, prezzo di partenza.", "Restituisci numero puro, non stringa formattata."],
});
