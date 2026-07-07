import { createFieldAgent } from "../create_field_agent.js";

export const proponenteNominativoAgent = createFieldAgent({
  id: "proposta_proponente_nominativo_extractor",
  scope: "proposta",
  field: "proponente.nominativo",
  description: "Nome del proponente persona fisica o denominazione societaria principale.",
  output: '{ "nominativo": string | null }',
  hints: ["Preferisci il soggetto dichiarato come Proponente.", "Ignora placeholder e campi template non compilati."],
});
