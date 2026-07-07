import { createFieldAgent } from "../create_field_agent.js";

export const provvigionePercentualeFieldAgent = createFieldAgent({
  id: "provvigione_percentuale_field_extractor",
  scope: "provvigione",
  field: "provvigione_percentuale",
  description: "Percentuale di provvigione/mediazione applicata alla procedura.",
  output: '{ "provvigione_percentuale": number | null }',
  hints: [
    "Cerca provvigione, proviggione, mediazione, compenso.",
    "Restituisci 3 per 3%.",
    "Ignora importi, date e numeri catastali.",
  ],
});
