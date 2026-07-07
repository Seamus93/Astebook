import { createFieldAgent } from "../create_field_agent.js";

export const proponenteCellulareAgent = createFieldAgent({
  id: "proposta_proponente_cellulare_extractor",
  scope: "proposta",
  field: "proponente.cellulare",
  description: "Numero cellulare del proponente o rappresentante.",
  output: '{ "cellulare": string | null }',
  hints: ["Cerca cell., cellulare, mobile.", "Restituisci solo numero normalizzato quando possibile."],
});
