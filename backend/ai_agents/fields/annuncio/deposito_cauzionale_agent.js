import { createFieldAgent } from "../create_field_agent.js";

export const annuncioDepositoCauzionaleAgent = createFieldAgent({
  id: "annuncio_deposito_cauzionale_extractor",
  scope: "annuncio",
  field: "deposito_cauzionale",
  description: "Importo assoluto della cauzione/deposito cauzionale indicato nell'annuncio.",
  output: '{ "deposito_cauzionale": number | null }',
  hints: ["Cerca Cauzione, Deposito cauzionale.", "Se trovi solo percentuale, restituisci null."],
});
