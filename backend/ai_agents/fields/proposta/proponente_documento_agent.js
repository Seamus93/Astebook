import { createFieldAgent } from "../create_field_agent.js";

export const proponenteDocumentoAgent = createFieldAgent({
  id: "proposta_proponente_documento_extractor",
  scope: "proposta",
  field: "proponente.documento",
  description: "Numero documento identita del proponente o rappresentante.",
  output: '{ "documento": string | null }',
  hints: ["Cerca carta d'identita, C.I., passaporto.", "Restituisci solo codice documento."],
});
