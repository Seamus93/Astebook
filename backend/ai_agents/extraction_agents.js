import { annuncioExtractorAgent, PROMPT_ANNUNCIO } from "./annuncio_extractor.js";
import { AI_FIELD_AGENTS, listAiFieldAgents } from "./fields/index.js";
import { emailInterceptorAgent, PROMPT_INTERCEPTOR } from "./Interceptor.js";
import { indirizzoExtractorAgent, PROMPT_INDIRIZZO } from "./indirizzo_extractor.js";
import { propostaExtractorAgent, PROMPT_PROPOSTA } from "./proposta_extractor.js";
import { provvigioneExtractorAgent, PROMPT_PROVVIGIONE } from "./provvigione_extractor.js";

export const AI_EXTRACTION_AGENTS = {
  interceptor: emailInterceptorAgent,
  annuncio: annuncioExtractorAgent,
  proposta: propostaExtractorAgent,
  provvigione: provvigioneExtractorAgent,
  indirizzo: indirizzoExtractorAgent,
};

export { AI_FIELD_AGENTS, listAiFieldAgents };

export {
  PROMPT_ANNUNCIO,
  PROMPT_INTERCEPTOR,
  PROMPT_INDIRIZZO,
  PROMPT_PROPOSTA,
  PROMPT_PROVVIGIONE,
};
