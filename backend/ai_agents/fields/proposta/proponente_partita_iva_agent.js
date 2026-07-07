import { createFieldAgent } from "../create_field_agent.js";

export const proponentePartitaIvaAgent = createFieldAgent({
  id: "proposta_proponente_partita_iva_extractor",
  scope: "proposta",
  field: "proponente.partita_iva",
  description: "Partita IVA del proponente societario.",
  output: '{ "partita_iva": string | null }',
  hints: ["Cerca P.IVA, p. Iva, partita iva.", "Restituisci solo cifre se possibile."],
});
