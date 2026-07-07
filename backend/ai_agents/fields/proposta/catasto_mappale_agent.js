import { createFieldAgent } from "../create_field_agent.js";

export const catastoMappaleAgent = createFieldAgent({
  id: "proposta_catasto_mappale_extractor",
  scope: "proposta",
  field: "catasto.mappale",
  description: "Mappale catastale dell'immobile.",
  output: '{ "mappale": string | null }',
  hints: ["Cerca mappale, mapp., particella, part.", "Se il documento usa particella come sinonimo, restituiscila come mappale."],
});
