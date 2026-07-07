import { createFieldAgent } from "../create_field_agent.js";

export const offertaMinimaAgent = createFieldAgent({
  id: "annuncio_offerta_minima_extractor",
  scope: "annuncio",
  field: "offerta_minima",
  description: "Offerta minima ammissibile o offerta minima indicata nell'annuncio.",
  output: '{ "offerta_minima": number | null }',
  hints: ["Cerca Offerta minima.", "Non usare prezzo base se l'etichetta offerta minima non e presente."],
});
