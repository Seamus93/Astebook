# AI Agents Knowledge

Updated: 2026-09-22

Purpose: fast retrieval map for AI extraction prompts, field agents and deterministic helpers. Canonical extraction behavior lives in `docs/AI_EXTRACTION.md`.

## Entry Points

- `backend/lib/extraction_pipeline.js`: text acquisition and extraction orchestration.
- `backend/lib/ai.js`: provider integration, prompt execution and deterministic fallbacks.
- `backend/ai_agents/extraction_agents.js`: document-level and field-agent registry.
- `backend/ai_agents/annuncio_extractor.js`: announcement prompt.
- `backend/ai_agents/proposta_extractor.js`: proposal prompt.
- `backend/ai_agents/provvigione_extractor.js`: commission/provvigione prompt.
- `backend/ai_agents/indirizzo_extractor.js`: address prompt.
- `backend/ai_agents/Interceptor.js`: sender/attachment allowlist and duplicate decision logic.
- `backend/ai_agents/fields/**`: field-agent factory and scoped registries.

## Important Signals

- Main scopes: `annuncio`, `proposta`, `provvigione`.
- AI memory source: `backend/lib/extraction_feedback.js`.
- Proposal OCR source selection is in `backend/lib/extraction_pipeline.js`.
- Merge/final output rules are in `backend/lib/merge_json.js` and `backend/lib/extraction_result.js`.

## Tests

- `backend/tests/ai_catasto.test.js`
- `backend/tests/ai_iban.test.js`
- `backend/tests/ai_annuncio_gara_times.test.js`
- `backend/tests/email_watcher.test.js`
- `backend/tests/extraction_pipeline.test.js`

## Retrieval Queries

- Agent registry: `rg -n "AI_EXTRACTION_AGENTS|AI_FIELD_AGENTS|listAiFieldAgents" backend/ai_agents backend/lib/ai.js`
- Proposta fields: `rg -n "propostaFieldAgents|catasto|iban|proponente|prezzo_offerto" backend/ai_agents backend/lib/ai.js backend/tests`
- Annuncio fields: `rg -n "annuncioFieldAgents|data_vendita|offerta_minima|codice_pratica" backend/ai_agents backend/lib/ai.js backend/tests`
- Interceptor: `rg -n "evaluateEmailInterceptorDecision|attachmentFilenameMatchesRequired|sender_allowed|required_filename" backend/ai_agents backend/lib backend/tests`
- Feedback memory: `rg -n "extraction_feedback|buildAiMemoryContext|AI_MEMORY|feedback" backend docs`

## Related Docs

- `docs/AI_EXTRACTION.md`
- `docs/API.md`
- `docs/OCR_PDF_APP.md`
- `docs/ai-context/backend-api.md`
- `docs/ai-context/ocr-pdf-app.md`
