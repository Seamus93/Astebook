# OCR and PDF-app Knowledge

Updated: 2026-09-22

Purpose: map PDF text acquisition, temporary OCR input URLs, PDF-app sync/async behavior, diagnostics and tests.

## Core Files

- `backend/lib/pdf_app.js`: PDF-app OCR payloads, sync/async request handling, polling, retry, text extraction and diagnostics.
- `backend/lib/ocr_input_store.js`: creates temporary public OCR input URLs from attachment buffers and masks tokens for diagnostics.
- `backend/lib/ocr_input_self_test.js`: optional self-test of generated OCR input URLs.
- `backend/lib/extraction_pipeline.js`: decides native PDF text vs PDF-app OCR, records attachment cache and proposal source selection.
- `backend/lib/pdf.js`: native PDF text extraction.
- `backend/server.js`: serves `GET /api/v1/ocr-inputs/:token/:fileName`.
- `scripts/diagnose_pdf_app_async_ocr.mjs`: real PDF-app async start/poll diagnostic script.
- `scripts/test_pdf_app_ocr.js`: simple PDF-app sync/public PDF diagnostic.

## PDF-app Async Contract

Start:

- `POST https://api.pdf-app.net/ocr`
- Raw `Authorization: <PDF_APP_API_KEY>`, no `Bearer`.
- JSON payload from `buildPdfAppOcrPayload(fileUrl, { async: true })`.
- Expected accepted response: `HTTP 202` with `job_id`.

Poll:

- `GET https://api.pdf-app.net/async_jobid_check`
- JSON body required even on `GET`: `{"job_id":"..."}`
- Raw `Authorization` header, `Content-Type: application/json`, `Accept: application/json`.
- Do not use `/async_jobid_check/<jobId>` or `?job_id=...`.

Completed:

- Verified terminal success status is `status: "success"` with `extraction_results[]`.
- `CreditzConsumed` is preserved in diagnostics as `credits_consumed`.

## Text Extraction

`extractPdfAppText()` reads:

- `extraction_results[].result[]`
- orders by `page`, then `region_index` when present
- concatenates all page/region text with blank lines
- does not fall back to metadata text when `extraction_results` exists but pages are empty

This preserves multipage proposal OCR for the Proposal Agent.

## Async Retry Semantics

- Start request retries only until a `job_id` is obtained.
- Once `job_id` exists, Astebook does not create another OCR job for polling pending/transient errors.
- Polling retries transient HTTP/network errors within existing retry/backoff settings.
- Terminal failures: `failed`, `error`, `cancelled`, `canceled`.
- If `status: "success"` has empty/whitespace extracted text, diagnostics use `reason: "ocr_empty_result"` and the attachment is not considered valid OCR.

## Runtime Settings

- `PDF_APP_API_KEY` / `pdf_app_api_key`
- `PDF_APP_OCR_ENDPOINT` / `pdf_app_ocr_endpoint`
- `PDF_APP_JOB_ENDPOINT` / `pdf_app_job_endpoint`
- `PDF_APP_ASYNC_MODE` / `pdf_app_async_mode`: `false`, `true`, `auto`
- `PDF_APP_POLL_TIMEOUT_MS`
- `PDF_APP_POLL_INTERVAL_BASE_MS`
- `PDF_APP_RETRY_COUNT`
- `PDF_APP_RETRY_BASE_DELAY_MS`
- `PDF_APP_OCR_TIMEOUT_MS`
- `PDF_APP_OCR_MAX_ATTEMPTS`
- `PDF_APP_OCR_RETRY_BASE_MS`
- `PDF_APP_OCR_RETRY_MAX_MS`
- `OCR_PUBLIC_BASE_URL`, `ASTEBOOK_PUBLIC_URL`, `PROJECT_URL`, `PUBLIC_BASE_URL`, `PUBLIC_URL`, `HEALTH_URL`
- `OCR_INPUT_TTL_SECONDS`
- `OCR_INPUT_SELF_TEST`

## Cache and Proposal Flow

1. `createOcrInputFromBuffer()` writes the PDF buffer under `runtime/ocr-inputs/<token>`.
2. The public URL is passed to PDF-app as `fileUrls[0]`.
3. Successful OCR text is saved to `attachment_text_cache` with source `pdf_app` and parser version `pdf_app_multi_page_v1`.
4. The proposal selector scores usable text and passes selected proposal text to `aiExtractProposta()`.
5. Empty OCR is not cached and does not call the Proposal Agent.

## Diagnostics

PDF-app diagnostics can include:

- `ocr_provider: "pdf-app"`
- `ocr_mode`
- `ocr_start_status`
- `ocr_job_id`
- `ocr_poll_attempts`
- `ocr_final_status`
- `ocr_text_length`
- `ocr_pages`
- `credits_consumed`
- `ocr_duration_ms`
- `ocr_status`

Do not log:

- `PDF_APP_API_KEY`
- full temporary OCR input token
- full `Authorization` header

## Tests

- `backend/tests/pdf_app_diagnostics.test.js`
- `backend/tests/extraction_pipeline.test.js`
- `backend/tests/ocr_input_store.test.js`
- `backend/tests/ocr_input_self_test.test.js`

## Retrieval Queries

- PDF-app contract: `rg -n "async_jobid_check|buildPdfAppJobPollRequest|GET|job_id|CreditzConsumed" backend scripts docs .rag`
- Multipage extraction: `rg -n "extractPdfAppText|orderedTextParts|page|region_index|pdf_app_multi_page_v1" backend tests docs .rag`
- OCR input URL: `rg -n "createOcrInputFromBuffer|readOcrInput|ocr-inputs|OCR_PUBLIC_BASE_URL|maskOcrInput" backend tests docs .rag`
- Proposal OCR path: `rg -n "pdf_app_ocr|attachment_text_cache|proposta_agent_runs|passed_to_ai|ocr_empty_result" backend/tests backend/lib`
- Diagnostics: `rg -n "ocr_provider|ocr_start_status|credits_consumed|pdf_app_diagnostics" backend scripts docs .rag`

## Related Docs

- `docs/pdf-app-ocr-diagnostics.md`
- `docs/proposta-extraction-diagnostics.md`
- `docs/ai-context/backend-api.md`
- `docs/ai-context/scripts-diagnostics.md`
