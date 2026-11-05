# OCR and PDF-app Knowledge

Updated: 2026-09-22

Purpose: fast retrieval map for PDF text acquisition, temporary OCR input URLs, PDF-app integration, diagnostics and tests. Canonical behavior lives in `docs/OCR_PDF_APP.md`.

## Core Files

- `backend/lib/pdf_app.js`: PDF-app payloads, sync/async requests, polling, retry, text extraction and diagnostics.
- `backend/lib/ocr_input_store.js`: temporary OCR input URL generation and token masking.
- `backend/lib/ocr_input_self_test.js`: optional reachability/content self-test for OCR input URLs.
- `backend/lib/extraction_pipeline.js`: native PDF vs OCR decision, attachment cache and proposal source selection.
- `backend/lib/pdf.js`: native PDF text extraction.
- `backend/server.js`: serves temporary OCR input files through the endpoint cataloged in `docs/API.md`.
- `scripts/diagnose_pdf_app_async_ocr.mjs`: real async PDF-app start/poll diagnostic.
- `scripts/test_pdf_app_ocr.js`: simple public-PDF OCR diagnostic.

## Important Signals

- Canonical contract: `docs/OCR_PDF_APP.md`.
- Parser/cache version: `pdf_app_multi_page_v1`.
- Empty async success reason: `ocr_empty_result`.
- Provider diagnostics: `ocr_provider`, `ocr_mode`, `ocr_job_id`, `ocr_final_status`, `credits_consumed`.
- Never log `PDF_APP_API_KEY`, full temporary OCR input token or full `Authorization` header.

## Tests

- `backend/tests/pdf_app_diagnostics.test.js`
- `backend/tests/extraction_pipeline.test.js`
- `backend/tests/ocr_input_store.test.js`
- `backend/tests/ocr_input_self_test.test.js`

## Retrieval Queries

- PDF-app contract: `rg -n "async_jobid_check|buildPdfAppJobPollRequest|GET|job_id|CreditzConsumed" backend scripts docs`
- Multipage extraction: `rg -n "extractPdfAppText|orderedTextParts|page|region_index|pdf_app_multi_page_v1" backend tests docs`
- OCR input URL: `rg -n "createOcrInputFromBuffer|readOcrInput|ocr-inputs|OCR_PUBLIC_BASE_URL|maskOcrInput" backend tests docs`
- Proposal OCR path: `rg -n "pdf_app_ocr|attachment_text_cache|proposta_agent_runs|passed_to_ai|ocr_empty_result" backend/tests backend/lib`
- Diagnostics: `rg -n "ocr_provider|ocr_start_status|credits_consumed|pdf_app_diagnostics" backend scripts docs`

## Related Docs

- `docs/OCR_PDF_APP.md`
- `docs/API.md`
- `docs/ai-context/backend-api.md`
- `docs/ai-context/scripts-diagnostics.md`
