import { annuncioExtractorAgent, PROMPT_ANNUNCIO } from "./annuncio_extractor.js";
import { indirizzoExtractorAgent, PROMPT_INDIRIZZO } from "./indirizzo_extractor.js";
import { propostaExtractorAgent, PROMPT_PROPOSTA } from "./proposta_extractor.js";
import { provvigioneExtractorAgent, PROMPT_PROVVIGIONE } from "./provvigione_extractor.js";

export const AI_EXTRACTION_AGENTS = {
  annuncio: annuncioExtractorAgent,
  proposta: propostaExtractorAgent,
  provvigione: provvigioneExtractorAgent,
  indirizzo: indirizzoExtractorAgent,
};

export {
  PROMPT_ANNUNCIO,
  PROMPT_INDIRIZZO,
  PROMPT_PROPOSTA,
  PROMPT_PROVVIGIONE,
};
