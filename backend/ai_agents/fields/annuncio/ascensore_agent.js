import { createFieldAgent } from "../create_field_agent.js";

export const ascensoreAgent = createFieldAgent({
  id: "annuncio_ascensore_extractor",
  scope: "annuncio",
  field: "ascensore",
  description: "Presenza ascensore nell'immobile/condominio.",
  output: '{ "ascensore": "SI" | "NO" | null }',
  hints: ["Normalizza Si, Sì, Yes in SI; No in NO."],
});
