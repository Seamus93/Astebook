import { createFieldAgent } from "../create_field_agent.js";

export const annuncioDepositoCauzionalePercentualeAgent = createFieldAgent({
  id: "annuncio_deposito_cauzionale_percentuale_extractor",
  scope: "annuncio",
  field: "deposito_cauzionale_percentuale",
  description: "Percentuale della cauzione/deposito cauzionale.",
  output: '{ "deposito_cauzionale_percentuale": number | null }',
  hints: ["Cerca Cauzione pari al 10%, Deposito cauzionale 10%.", "Restituisci 10 per 10%."],
});
