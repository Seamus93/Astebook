import { createFieldAgent } from "../create_field_agent.js";

export const catastoCategoriaAgent = createFieldAgent({
  id: "proposta_catasto_categoria_extractor",
  scope: "proposta",
  field: "catasto.categoria",
  description: "Categoria catastale dell'immobile.",
  output: '{ "categoria": string | null }',
  hints: ["Cerca cat., categoria.", "Esempi: A/10, C/2, A/3."],
});
