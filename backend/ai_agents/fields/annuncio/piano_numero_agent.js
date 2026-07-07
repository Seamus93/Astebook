import { createFieldAgent } from "../create_field_agent.js";

export const pianoNumeroAgent = createFieldAgent({
  id: "annuncio_piano_numero_extractor",
  scope: "annuncio",
  field: "piano_numero",
  description: "Numero del piano dell'immobile.",
  output: '{ "piano_numero": number | null }',
  hints: ["Cerca etichetta Piano.", "Restituisci solo numero; se piano terra e non codificabile, restituisci null."],
});
