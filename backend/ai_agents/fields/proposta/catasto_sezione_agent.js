import { createFieldAgent } from "../create_field_agent.js";

export const catastoSezioneAgent = createFieldAgent({
  id: "proposta_catasto_sezione_extractor",
  scope: "proposta",
  field: "catasto.sezione",
  description: "Sezione catastale, se presente.",
  output: '{ "sezione": string | null }',
  hints: ["Cerca sezione o sez.", "Non usare numeri di foglio/subalterno come sezione."],
});
