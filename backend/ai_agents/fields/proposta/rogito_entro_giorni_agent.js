import { createFieldAgent } from "../create_field_agent.js";

export const rogitoEntroGiorniAgent = createFieldAgent({
  id: "proposta_rogito_entro_giorni_extractor",
  scope: "proposta",
  field: "rogito_entro_giorni",
  description: "Numero giorni entro cui stipulare il rogito.",
  output: '{ "rogito_entro_giorni": number | null }',
  hints: ["Cerca rogito entro, stipula entro.", "Restituisci solo giorni come numero."],
});
