import { createFieldAgent } from "../create_field_agent.js";

export const statoAgent = createFieldAgent({
  id: "annuncio_stato_extractor",
  scope: "annuncio",
  field: "stato",
  description: "Stato occupazionale o conservativo sintetico dell'immobile.",
  output: '{ "stato": string | null }',
  hints: ["Cerca Stato, Libero, Occupato, In corso di liberazione.", "Non usare frasi lunghe se basta il valore sintetico."],
});
