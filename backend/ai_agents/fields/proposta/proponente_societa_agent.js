import { createFieldAgent } from "../create_field_agent.js";

export const proponenteSocietaAgent = createFieldAgent({
  id: "proposta_proponente_societa_extractor",
  scope: "proposta",
  field: "proponente.societa",
  description: "Denominazione della societa proponente, se presente.",
  output: '{ "societa": string | null }',
  hints: ["Cerca formule La societa ..., con sede.", "Non usare proprieta/venditore se non e il proponente."],
});
