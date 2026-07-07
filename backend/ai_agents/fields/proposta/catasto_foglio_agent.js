import { createFieldAgent } from "../create_field_agent.js";

export const catastoFoglioAgent = createFieldAgent({
  id: "proposta_catasto_foglio_extractor",
  scope: "proposta",
  field: "catasto.foglio",
  description: "Foglio catastale dell'immobile.",
  output: '{ "foglio": string | null }',
  hints: ["Cerca foglio vicino a catasto/censito/descrizione immobile."],
});
