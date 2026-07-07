import { createFieldAgent } from "../create_field_agent.js";

export const proponenteCodiceFiscaleAgent = createFieldAgent({
  id: "proposta_proponente_codice_fiscale_extractor",
  scope: "proposta",
  field: "proponente.codice_fiscale",
  description: "Codice fiscale del proponente o del soggetto rappresentante.",
  output: '{ "codice_fiscale": string | null }',
  hints: ["Cerca cod. fiscale, c.f.", "Non confondere con partita IVA se sono distinti."],
});
