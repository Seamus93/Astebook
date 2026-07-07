import { createFieldAgent } from "../create_field_agent.js";

export const catastoVociAgent = createFieldAgent({
  id: "proposta_catasto_voci_extractor",
  scope: "proposta",
  field: "catasto_voci",
  description: "Elenco completo delle unita catastali quando il documento contiene piu fogli/mappali/subalterni/categorie.",
  output: '{ "catasto_voci": [{ "foglio": string | null, "particella": string | null, "mappale": string | null, "subalterno": string | null, "sezione": string | null, "categoria": string | null }] | null }',
  hints: [
    "Mantieni tutte le righe catastali trovate.",
    "Non deduplicare unita diverse.",
    "Compila mappale con particella quando nel documento i termini sono usati come sinonimi.",
  ],
});
