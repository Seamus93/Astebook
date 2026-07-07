import { createFieldAgent } from "../create_field_agent.js";

export const prezzoOffertoAgent = createFieldAgent({
  id: "proposta_prezzo_offerto_extractor",
  scope: "proposta",
  field: "prezzo_offerto",
  description: "Prezzo offerto dal proponente per l'acquisto.",
  output: '{ "prezzo_offerto": number | null }',
  hints: ["Cerca prezzo offerto, offre il prezzo di, offerta di.", "Restituisci numero puro."],
});
