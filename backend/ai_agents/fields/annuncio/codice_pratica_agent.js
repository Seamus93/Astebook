import { createFieldAgent } from "../create_field_agent.js";

export const codicePraticaAgent = createFieldAgent({
  id: "annuncio_codice_pratica_extractor",
  scope: "annuncio",
  field: "codice_pratica",
  description: "Codice procedura/pratica, spesso presente nell'oggetto email o nell'annuncio.",
  output: '{ "codice_pratica": string | null }',
  hints: [
    "Normalizza separatori con underscore e usa maiuscolo.",
    "Pattern frequente: RM_Roma_TOL_202949480010.",
  ],
});
