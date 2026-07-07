import { createFieldAgent } from "../create_field_agent.js";

export const catastoSubalternoAgent = createFieldAgent({
  id: "proposta_catasto_subalterno_extractor",
  scope: "proposta",
  field: "catasto.subalterno",
  description: "Subalterno catastale dell'immobile.",
  output: '{ "subalterno": string | null }',
  hints: ["Cerca sub, sub., subalterno vicino a foglio/mappale."],
});
