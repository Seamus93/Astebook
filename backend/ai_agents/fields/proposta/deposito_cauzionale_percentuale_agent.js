import { createFieldAgent } from "../create_field_agent.js";

export const propostaDepositoCauzionalePercentualeAgent = createFieldAgent({
  id: "proposta_deposito_cauzionale_percentuale_extractor",
  scope: "proposta",
  field: "deposito_cauzionale_percentuale",
  description: "Percentuale cauzione/deposito indicata nella proposta.",
  output: '{ "deposito_cauzionale_percentuale": number | null }',
  hints: ["Cerca cauzione 10%, deposito cauzionale pari al 10%.", "Restituisci 10 per 10%."],
});
