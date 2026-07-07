import { createFieldAgent } from "../create_field_agent.js";

export const proponenteTelefonoAgent = createFieldAgent({
  id: "proposta_proponente_telefono_extractor",
  scope: "proposta",
  field: "proponente.telefono",
  description: "Numero telefonico fisso del proponente.",
  output: '{ "telefono": string | null }',
  hints: ["Cerca tel., telefono.", "Normalizza rimuovendo spazi superflui ma mantieni eventuale prefisso +."],
});
