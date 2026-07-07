import { createFieldAgent } from "../create_field_agent.js";

export const tipoVenditaAgent = createFieldAgent({
  id: "annuncio_tipo_vendita_extractor",
  scope: "annuncio",
  field: "tipo_vendita",
  description: "Tipo o modalita di vendita dell'asta.",
  output: '{ "tipo_vendita": string | null }',
  hints: ["Valori frequenti: Competitiva, Senza incanto, Sincrona mista, Telematica asincrona."],
});
