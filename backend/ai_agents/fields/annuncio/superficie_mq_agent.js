import { createFieldAgent } from "../create_field_agent.js";

export const superficieMqAgent = createFieldAgent({
  id: "annuncio_superficie_mq_extractor",
  scope: "annuncio",
  field: "superficie_mq",
  description: "Superficie commerciale/catastale in metri quadri.",
  output: '{ "superficie_mq": number | null }',
  hints: ["Cerca Superficie, mq, m2, m².", "Restituisci solo numero."],
});
