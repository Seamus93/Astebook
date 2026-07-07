import { createFieldAgent } from "../create_field_agent.js";

export const proponenteRappresentanteAgent = createFieldAgent({
  id: "proposta_proponente_rappresentante_extractor",
  scope: "proposta",
  field: "proponente.rappresentante",
  description: "Persona fisica che rappresenta la societa proponente.",
  output: '{ "rappresentante": string | null }',
  hints: ["Cerca in persona del Sig./Dott. ... nella sua qualita.", "Restituisci solo nome e cognome."],
});
