import { createFieldAgent } from "../create_field_agent.js";

export const categoriaMacroAgent = createFieldAgent({
  id: "annuncio_categoria_macro_extractor",
  scope: "annuncio",
  field: "categoria_macro",
  description: "Categoria generale del bene in annuncio.",
  output: '{ "categoria_macro": string | null }',
  hints: ["Cerca Categoria.", "Normalizza in maiuscolo se e una categoria testuale breve."],
});
