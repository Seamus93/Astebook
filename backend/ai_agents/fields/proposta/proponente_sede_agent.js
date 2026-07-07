import { createFieldAgent } from "../create_field_agent.js";

export const proponenteSedeAgent = createFieldAgent({
  id: "proposta_proponente_sede_extractor",
  scope: "proposta",
  field: "proponente.sede",
  description: "Sede legale o sede della societa proponente.",
  output: '{ "sede": string | null }',
  hints: ["Cerca con sede in.", "Non confondere sede aziendale con indirizzo immobile."],
});
