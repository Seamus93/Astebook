import { createFieldAgent } from "../create_field_agent.js";

export const annuncioOraTermineOffertaAgent = createFieldAgent({
  id: "annuncio_ora_termine_offerta_extractor",
  scope: "annuncio",
  field: "ora_termine_offerta",
  description: "Ora entro cui deve pervenire l'offerta/proposta.",
  output: '{ "ora_termine_offerta": "HH:MM" | null }',
  hints: ["Cerca ore HH:MM vicino alla data termine offerta.", "Normalizza in HH:MM."],
});
