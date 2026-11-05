# Scripts and Diagnostics Knowledge

Updated: 2026-09-22

Purpose: fast retrieval map for repository scripts, diagnostics and verification commands. Canonical script behavior lives in `docs/SCRIPTS.md`.

## Script Entry Points

- `package.json`: npm scripts.
- `scripts/check-js.js`: JavaScript syntax checker used by `npm run lint`.
- `scripts/import-processing-events-jsonl.mjs`: legacy processing event import/backfill.
- `scripts/test_pdf_app_ocr.js`: simple PDF-app OCR diagnostic.
- `scripts/diagnose_pdf_app_async_ocr.mjs`: async PDF-app OCR diagnostic with temporary OCR input URL.

## Important Signals

- Do not print secrets or full temporary OCR input tokens.
- Import/backfill scripts that use Prisma require `DATABASE_URL`.
- External-service diagnostics should report sanitized summaries.
- Deploy/push commands should run only when explicitly requested.

## Verification Commands

- Syntax/lint: `npm run lint`
- Full tests: `npm test`
- Focused PDF-app tests: `node --test backend/tests/pdf_app_diagnostics.test.js`
- Focused extraction pipeline tests: `node --test backend/tests/extraction_pipeline.test.js`
- Full build: `npm run build`

## Retrieval Queries

- Script entry points: `rg -n "async function main|#!/usr/bin/env node|PrismaClient|PDF_APP|PROCESSING_LOG_FILE" scripts package.json`
- PDF-app diagnostics: `rg -n "diagnose_pdf_app_async_ocr|test_pdf_app_ocr|async_jobid_check|sanitizeValue" scripts docs`
- Import tooling: `rg -n "import-processing-events|processing-events.jsonl|ProcessingStep|ProcessingEvent" scripts backend docs`
- Lint/test config: `rg -n "\"lint\"|\"test\"|check-js|node --test|vite build" package.json scripts .github docs`

## Related Docs

- `docs/SCRIPTS.md`
- `docs/OCR_PDF_APP.md`
- `docs/DB_SCHEMA.md`
- `docs/ai-context/ocr-pdf-app.md`
- `docs/ai-context/database-prisma.md`
