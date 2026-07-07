import { createFieldAgent } from "../create_field_agent.js";

export const annuncioIndirizzoAgent = createFieldAgent({
  id: "annuncio_indirizzo_extractor",
  scope: "annuncio",
  field: "indirizzo",
  description: "Indirizzo dell'immobile indicato nell'annuncio.",
  output: '{ "indirizzo_raw": string | null, "indirizzo": string | null }',
  hints: [
    "Rimuovi frasi come Appartamento all'asta.",
    "Formato preferito: Via/Piazza/Corso ..., civico, Comune.",
    "Non confondere indirizzo immobile con contatti, sedi societarie o testi promozionali.",
  ],
});
