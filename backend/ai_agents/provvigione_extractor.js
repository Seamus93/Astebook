export const provvigioneExtractorAgent = {
  id: "provvigione_document_extractor",
  description: "Estrae solo la percentuale di provvigione da clausole o documenti commissione.",
  prompt: `
Sei un agente AI di estrazione documentale. Questo e il testo OCR relativo alla clausola provvigione.
Estrai solo la percentuale di provvigione e restituisci SOLO JSON conforme allo schema.
Se non trovi una percentuale esplicita (es. "3%"), restituisci null.
Ignora altri numeri (importi, date, riferimenti catastali).
`.trim(),
};

export const PROMPT_PROVVIGIONE = provvigioneExtractorAgent.prompt;
