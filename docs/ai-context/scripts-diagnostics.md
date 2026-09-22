# Scripts and Diagnostics Knowledge

Updated: 2026-09-22

Purpose: map repository scripts and operational diagnostics so future agents know which commands are safe and what they touch.

## NPM Scripts

Defined in `package.json`:

- `npm start`: runs `backend/server.js`.
- `npm run start:prod`: runs Prisma migrations then starts server.
- `npm run start:4000`: starts backend on port 4000.
- `npm run db:generate`: Prisma client generation.
- `npm run db:migrate`: `prisma migrate deploy`.
- `npm run db:import-processing-events`: imports legacy JSONL processing events.
- `npm run lint`: syntax-checks JS files through `scripts/check-js.js`.
- `npm test`: runs `node --test backend/tests/*.test.js`.
- `npm run build`: lint plus Vite build.
- `npm run frontend:dev`: Vite dev server.
- `npm run ci`: lint, tests and high-severity npm audit.

## Repository Scripts

- `scripts/check-js.js`: recursively runs `node --check` over `backend`, `frontend` and `scripts`, ignoring `.git` and `node_modules`.
- `scripts/import-processing-events-jsonl.mjs`: imports legacy `runtime/processing-events.jsonl` into Prisma `processing_events` and `processing_steps`.
- `scripts/test_pdf_app_ocr.js`: manual PDF-app OCR request against a public HTTPS PDF URL.
- `scripts/diagnose_pdf_app_async_ocr.mjs`: real async PDF-app diagnostic using local PDF buffer -> OCR input URL -> `POST /ocr` -> `GET /async_jobid_check` with JSON body.

## Diagnostic Script Behavior

`diagnose_pdf_app_async_ocr.mjs`:

- Reads `PDF_APP_API_KEY` and OCR/job endpoints from env or runtime settings.
- Creates an Astebook temporary OCR input URL from a local PDF.
- Starts PDF-app async OCR with `async: true`.
- Polls `https://api.pdf-app.net/async_jobid_check` using Node `http/https` so `GET` with JSON body is preserved.
- Sanitizes output: no API key and no full OCR input token.
- Prints status, duration, `job_id`, likely status, text length, page count and `credits_consumed` when available.

## Import Script Behavior

`import-processing-events-jsonl.mjs`:

- Uses Prisma, so it requires `DATABASE_URL`.
- Reads `PROCESSING_LOG_FILE` or `runtime/processing-events.jsonl`.
- Upserts legacy processing events and recreates processing steps.
- Intended for migration/backfill, not normal runtime ingestion.

## Verification Commands

- Syntax/lint: `npm run lint`
- Full tests: `npm test`
- Focused PDF-app tests: `node --test backend/tests/pdf_app_diagnostics.test.js`
- Focused extraction pipeline tests: `node --test backend/tests/extraction_pipeline.test.js`
- Full build: `npm run build`

## Retrieval Queries

- Script entry points: `rg -n "async function main|#!/usr/bin/env node|PrismaClient|PDF_APP|PROCESSING_LOG_FILE" scripts package.json`
- PDF-app diagnostics: `rg -n "diagnose_pdf_app_async_ocr|test_pdf_app_ocr|async_jobid_check|sanitizeValue" scripts docs .rag`
- Import tooling: `rg -n "import-processing-events|processing-events.jsonl|ProcessingStep|ProcessingEvent" scripts backend docs .rag`
- Lint/test config: `rg -n "\"lint\"|\"test\"|check-js|node --test|vite build" package.json scripts .github docs .rag`

## Notes

- Do not run deploy or push commands from scripts unless the user explicitly requests it.
- Do not place secrets in diagnostic output.
- For scripts that hit real external services, prefer sanitized summaries over full payload dumps.
