import { createFieldAgent } from "../create_field_agent.js";

export const irrevocabileGiorniAgent = createFieldAgent({
  id: "proposta_irrevocabile_giorni_extractor",
  scope: "proposta",
  field: "irrevocabile_giorni",
  description: "Numero giorni di irrevocabilita dell'offerta.",
  output: '{ "irrevocabile_giorni": number | null }',
  hints: ["Cerca offerta rimarra irrevocabile, validita offerta.", "Restituisci solo giorni come numero."],
});
