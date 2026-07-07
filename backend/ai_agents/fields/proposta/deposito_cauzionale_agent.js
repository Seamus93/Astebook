import { createFieldAgent } from "../create_field_agent.js";

export const propostaDepositoCauzionaleAgent = createFieldAgent({
  id: "proposta_deposito_cauzionale_extractor",
  scope: "proposta",
  field: "deposito_cauzionale",
  description: "Importo cauzione/deposito indicato nella proposta.",
  output: '{ "deposito_cauzionale": number | null }',
  hints: ["Cerca deposito cauzionale, cauzione, caparra, assegno circolare.", "Se trovi solo percentuale, restituisci null."],
});
