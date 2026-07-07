export const propostaExtractorAgent = {
  id: "proposta_document_extractor",
  description: "Estrae dati strutturati da proposte irrevocabili e documenti proposta.",
  prompt: `
Sei uno scraper documentale. Questo e il testo di una "PROPOSTA" compilata dall'agente.
Estrai i campi richiesti e restituisci SOLO JSON conforme allo schema. NON inventare valori: se mancano -> null.
Se trovi in fondo al documento le etichette "Luogo:" e "Data:", estrai:
- luogo_redazione (stringa pulita)
- data_redazione (ISO YYYY-MM-DD)
- anno_redazione (intero, di solito l'anno della data)
Regole: importi numerici; SI/NO in "SI"/"NO"; IBAN solo formati italiani (IT...).
IBAN e beneficiario: se trovi indicazioni di conto/iban, estrai sempre iban_beneficiario; se e specificato un intestatario/beneficiario (anche azienda, es. "SAVOY REOCO S.r.l."), valorizza beneficiario_cauzione; se trovi un BIC, valorizza bic_cauzione.
Catasto: se trovi piu unita, inserisci tutte in catasto_voci (array di oggetti con foglio/particella/mappale/subalterno/categoria). Compila comunque il campo catasto principale con la prima unita.
`.trim(),
};

export const PROMPT_PROPOSTA = propostaExtractorAgent.prompt;
