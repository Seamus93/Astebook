import { createFieldAgent } from "../create_field_agent.js";

export const propostaIndirizzoImmobileAgent = createFieldAgent({
  id: "proposta_indirizzo_immobile_extractor",
  scope: "proposta",
  field: "indirizzo_immobile",
  description: "Indirizzo dell'immobile oggetto della proposta.",
  output: '{ "indirizzo_immobile": string | null }',
  hints: [
    "Preferisci l'indirizzo dopo Descrizione Immobile.",
    "Riconosci formule tipo: Immobile sito a Ancona in Via Lodovico Menicucci n. 1 -> Via Lodovico Menicucci n. 1, Ancona.",
    "Ignora placeholder tipo Comune null, null, immobile non indicato.",
    "Non confondere con sede societaria, indirizzo azienda, IBAN o beneficiario.",
    "Se ci sono piu indirizzi, scegli quello vicino a catasto/immobile/lotto.",
  ],
});
