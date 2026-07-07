import { createFieldAgent } from "../create_field_agent.js";

export const catastoParticellaAgent = createFieldAgent({
  id: "proposta_catasto_particella_extractor",
  scope: "proposta",
  field: "catasto.particella",
  description: "Particella catastale dell'immobile.",
  output: '{ "particella": string | null }',
  hints: ["Cerca particella, part., mappale o mapp. vicino a foglio."],
});
