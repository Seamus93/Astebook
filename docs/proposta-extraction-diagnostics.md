# Proposta Extraction Diagnostics

Diagnostica temporanea per capire dove si perdono i dati della Proposta dopo che PDF-app OCR ha letto correttamente il file.

Caso di riferimento:

- file: `Format Proposta DE.CHI_.pdf`
- OCR status: `pdf_app_completed`
- OCR text length: `3416`
- self-test URL: `200`
- content-type: `application/pdf`
- PDF header: valido
- pipeline finale: `AI extraction completed with missing data`

## Flusso Reale

1. OCR PDF-app
   - Codice: `backend/lib/extraction_pipeline.js`, `extractAttachmentText`.
   - Testo salvato in `result.attachment_text_cache`.
   - Fonte attesa: `pdf_app`.

2. Testo OCR
   - Il testo viene passato senza riscritture semantiche a `extractPropostaAiFirst`.
   - Normalizzazione applicata prima dell'AI: `clampText` in `backend/lib/ai.js`, massimo `120000` caratteri.

3. Proposta Agent
   - Codice: `backend/lib/ai.js`, `aiExtractProposta`.
   - Prompt: `PROMPT_PROPOSTA`.
   - Schema: `schemaProposta`.
   - Memoria: `buildAiMemoryContext("proposta")`, se `AI_MEMORY_ENABLED` e attivo.

4. Output agente
   - Il JSON viene parsato da `callJsonSchema`.
   - Poi `aiExtractProposta` applica fallback deterministici per redazione, IBAN, catasto, catasto_voci e indirizzo.

5. Merge
   - Codice: `backend/lib/extraction_result.js`, `mergeExtractedProposta`.
   - La proposta PDF ha priorita maggiore del DOCX.

6. Validazione finale
   - Codice: `backend/lib/extraction_result.js`, `finalizeZapierResult` e `collectMissingFields`.
   - `ready_for_zapier = false` quando almeno un campo richiesto e mancante.

## Endpoint Debug Admin

Endpoint protetto dal token UI:

```bash
curl -H "x-astebook-token: <TOKEN_UI>" \
  "https://astebook.duckdns.org/api/v1/processing-events/<EVENT_ID>/extraction-debug"
```

La risposta contiene:

- `attachment_text_cache`: testo OCR cachato, con `file_name`, `kind`, `source`, `text_length`, testo completo o chunk testa/coda.
- `extraction_diagnostics.ocr_texts`: snapshot OCR della Proposta.
- `extraction_diagnostics.proposta_agent_runs`: input reale inviato al Proposta Agent, modello, prompt, schema, memoria, raw response, output JSON.
- `extraction_diagnostics.proposta_field_matrix`: confronto campo per campo.
- `missing_fields`: campi che mantengono `ready_for_zapier=false`.

Il normale endpoint evento continua a nascondere `attachment_text_cache` ed `extraction_diagnostics`.

## Campi Da Controllare

La matrice diagnostica confronta:

| campo | OCR presente | PropostaAgent | merged | finale | motivo perdita |
| --- | --- | --- | --- | --- | --- |
| Proponente - Nominativo | dalla diagnostica | dalla diagnostica | dalla diagnostica | dalla diagnostica | A-F |
| Indirizzo Immobile | dalla diagnostica | dalla diagnostica | dalla diagnostica | dalla diagnostica | A-F |
| Prezzo Offerto | dalla diagnostica | dalla diagnostica | dalla diagnostica | dalla diagnostica | A-F |
| IBAN Beneficiario | dalla diagnostica | dalla diagnostica | dalla diagnostica | dalla diagnostica | A-F |
| Catasto - Foglio | dalla diagnostica | dalla diagnostica | dalla diagnostica | dalla diagnostica | A-F |
| Catasto - Particella | dalla diagnostica | dalla diagnostica | dalla diagnostica | dalla diagnostica | A-F |
| Catasto - Subalterno | dalla diagnostica | dalla diagnostica | dalla diagnostica | dalla diagnostica | A-F |

## Categorie Root Cause

- A. Dato assente nel PDF oppure non riconoscibile nel testo OCR.
- B. Dato presente nel PDF ma OCR errato.
- C. Dato presente e OCR corretto ma Proposta Agent non lo estrae.
- D. Proposta Agent lo estrae ma il merge lo perde.
- E. Merge corretto ma validazione/finale lo annulla.
- F. Campo richiesto per `ready_for_zapier` ma non realmente disponibile nel documento.

## Fix Minimo Atteso Dopo Diagnosi

Non modificare prompt, schema o validator finche non c'e un nuovo reprocess con questa diagnostica.

Dopo il reprocess:

1. Se `ocr_texts` non contiene il dato, verificare PDF/PDF-app OCR.
2. Se `ocr_texts` contiene il dato ma `raw_output_json` no, correggere prompt o aggiungere pre-estrattore deterministico.
3. Se `raw_output_json` contiene il dato ma `proposta_agent_for_merge` no, verificare fallback/normalizzazione in `aiExtractProposta`.
4. Se `proposta_agent_for_merge` contiene il dato ma `after_merge_result_proposta` no, correggere `mergeExtractedProposta`.
5. Se `after_merge_result_proposta` contiene il dato ma `missing_fields` lo segnala, correggere mapping path/validator.
