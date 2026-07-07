import { createFieldAgent } from "../create_field_agent.js";

export const proponenteRuoloAgent = createFieldAgent({
  id: "proposta_proponente_ruolo_extractor",
  scope: "proposta",
  field: "proponente.ruolo",
  description: "Ruolo del rappresentante della societa proponente.",
  output: '{ "ruolo": string | null }',
  hints: ["Esempi: rappresentante legale, amministratore unico, procuratore."],
});
