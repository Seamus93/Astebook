# AI Agents Knowledge

Updated: 2026-09-22

Purpose: map the AI extraction prompt files, field agents and deterministic helpers so future agents can quickly find extraction behavior.

## Entry Points

- `backend/lib/ai.js`: runtime AI/OpenRouter/OpenAI integration, deterministic fallbacks, prompt execution and normalization helpers.
- `backend/ai_agents/extraction_agents.js`: central registry exporting document-level agents and field-agent registries.
- `backend/ai_agents/Interceptor.js`: email intake interceptor agent plus deterministic sender/attachment allowlist logic.
- `backend/ai_agents/annuncio_extractor.js`: announcement document-level prompt.
- `backend/ai_agents/proposta_extractor.js`: proposal document-level prompt.
- `backend/ai_agents/provvigione_extractor.js`: commission/provvigione prompt.
- `backend/ai_agents/indirizzo_extractor.js`: address extraction prompt.

## Field Agents

- `backend/ai_agents/fields/create_field_agent.js`: shared factory for single-field prompt specs.
- `backend/ai_agents/fields/index.js`: `AI_FIELD_AGENTS` grouped by scope and `listAiFieldAgents()`.
- `backend/ai_agents/fields/annuncio/index.js`: annuncio field registry.
- `backend/ai_agents/fields/proposta/index.js`: proposta field registry.
- `backend/ai_agents/fields/provvigione/index.js`: provvigione field registry.

Annuncio field agents include:

- `codice_pratica`, `indirizzo`, `tipo_vendita`, `data_vendita`, `ora_vendita`, `prezzo_base`, `offerta_minima`, deposit deadlines/times, `superficie_mq`, `piano_numero`, `ascensore`, `stato`, `categoria_macro`, `aggiornato_il`.

Proposta field agents include:

- proponente fields: nominativo, societa, sede, rappresentante, ruolo, codice fiscale, partita IVA, telefono, cellulare, documento.
- proposal fields: `indirizzo_immobile`, `prezzo_offerto`, `deposito_cauzionale`, `iban_beneficiario`, irrevocability/rogito days and offer/deposit deadlines.
- cadastral fields: `catasto.foglio`, `catasto.particella`, `catasto.mappale`, `catasto.subalterno`, `catasto.sezione`, `catasto.categoria`, `catasto_voci`.

## Runtime Flow

1. `backend/lib/extraction_pipeline.js` acquires text from body/attachments/OCR.
2. It calls `aiExtractAnnuncio`, `aiExtractProposta`, `aiExtractProvvigionePercentuale` and `aiExtractCodicePratica` from `backend/lib/ai.js`.
3. `backend/lib/ai.js` uses agent prompts and deterministic fallback extraction.
4. `backend/lib/merge_json.js` merges announcement and proposal outputs.
5. Human corrections are loaded through `backend/lib/extraction_feedback.js` when AI memory is enabled.

## Interceptor Logic

- `evaluateEmailInterceptorDecision()` in `backend/ai_agents/Interceptor.js` checks sender allowlist, required filename match and processed state.
- `attachmentFilenameMatchesRequired()` accepts proposal-equivalent filenames such as `offerta irrevocabile` and `offerta d'acquisto`.
- `collectEmailAddressCandidates()` and `collectEmailSenderAddresses()` normalize direct, header and forwarded sender addresses.

## Tests

- `backend/tests/ai_catasto.test.js`
- `backend/tests/ai_iban.test.js`
- `backend/tests/ai_annuncio_gara_times.test.js`
- `backend/tests/email_watcher.test.js`
- `backend/tests/extraction_pipeline.test.js`
- `backend/tests/health.test.js`

## Retrieval Queries

- Agent registry: `rg -n "AI_EXTRACTION_AGENTS|AI_FIELD_AGENTS|listAiFieldAgents" backend/ai_agents backend/lib/ai.js`
- Proposta fields: `rg -n "propostaFieldAgents|catasto|iban|proponente|prezzo_offerto" backend/ai_agents backend/lib/ai.js backend/tests`
- Annuncio fields: `rg -n "annuncioFieldAgents|data_vendita|offerta_minima|codice_pratica" backend/ai_agents backend/lib/ai.js backend/tests`
- Interceptor: `rg -n "evaluateEmailInterceptorDecision|attachmentFilenameMatchesRequired|sender_allowed|required_filename" backend/ai_agents backend/lib backend/tests`
- Feedback memory: `rg -n "extraction_feedback|buildAiMemoryContext|AI_MEMORY|feedback" backend docs .rag`

## Maintenance Notes

- When adding an extracted field, update the appropriate field registry, prompt/fallback logic in `backend/lib/ai.js`, merge/output handling if needed, and tests.
- When changing proposal or announcement semantics, update `docs/ai-context/backend-api.md` and this file.
- Keep field-agent files small and searchable; avoid hiding business rules only in large prompts.
