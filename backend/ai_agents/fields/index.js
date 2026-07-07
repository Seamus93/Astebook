import { annuncioFieldAgents } from "./annuncio/index.js";
import { propostaFieldAgents } from "./proposta/index.js";
import { provvigioneFieldAgents } from "./provvigione/index.js";

export const AI_FIELD_AGENTS = {
  annuncio: annuncioFieldAgents,
  proposta: propostaFieldAgents,
  provvigione: provvigioneFieldAgents,
};

export function listAiFieldAgents() {
  return Object.entries(AI_FIELD_AGENTS).flatMap(([scope, agents]) =>
    Object.entries(agents).map(([field, agent]) => ({
      scope,
      field,
      ...agent,
    }))
  );
}
