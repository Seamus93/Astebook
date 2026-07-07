import { createFieldAgent } from "../create_field_agent.js";

export const propostaOraTermineOffertaAgent = createFieldAgent({
  id: "proposta_ora_termine_offerta_extractor",
  scope: "proposta",
  field: "ora_termine_offerta",
  description: "Ora limite per presentazione/offerta nella proposta.",
  output: '{ "ora_termine_offerta": "HH:MM" | null }',
  hints: ["Cerca ore HH:MM vicino alla data limite offerta.", "Normalizza in HH:MM."],
});
