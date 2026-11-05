# Backend/API Knowledge

Updated: 2026-09-22

Purpose: fast retrieval map for the Express backend, extraction pipeline, runtime settings, processing events and API route ownership. Canonical endpoint details live in `docs/API.md`.

## Core Files

- `backend/server.js`: Express app composition, route registration, Zapier/IMAP intake wiring and legacy `/callAI`.
- `backend/routes/admin_auth.js`: admin setup/login/recovery/logout and session middleware.
- `backend/routes/admin_settings.js`: runtime settings read/update API.
- `backend/routes/call_ai.js`: legacy direct extraction route.
- `backend/routes/email_intake.js`: Zapier activation intake and IMAP activation handler.
- `backend/routes/processing_events.js`: processing event, feedback, debug, document, send and reprocess routes.
- `backend/lib/app_config.js`: effective setting lookup, PostgreSQL runtime settings and JSON fallback.
- `backend/lib/processing_log.js`: processing event and step persistence.
- `backend/lib/extraction_pipeline.js`: orchestration over email body, attachments, OCR, merge, logs and auto-send.
- `backend/lib/extraction_result.js`: merge helpers, missing fields, notes and final result shaping.
- `backend/lib/attachments.js`: attachment normalization, URL extraction, download and format inference.
- `backend/lib/document_builder.js`: DOCX/PDF generation.
- `backend/lib/document_email.js`: generated document email and report composition.
- `backend/lib/settings_validation.js`: redaction, recipient parsing and configuration issue collection.
- `backend/lib/smtp.js`: SMTP transport and recovery email sending.

## Related Domain Maps

- API catalog: `docs/API.md`.
- DB/storage: `docs/DB_SCHEMA.md`, `docs/ai-context/database-prisma.md`.
- AI prompts and field agents: `docs/ai-context/ai-agents.md`.
- OCR/PDF-app: `docs/OCR_PDF_APP.md`, `docs/ai-context/ocr-pdf-app.md`.
- Mailbox ingestion: `docs/MAILBOX.md`, `docs/ai-context/mailbox-ingestion.md`.
- Frontend admin: `docs/ai-context/frontend-admin.md`.

## Pipeline Landmarks

1. Create or update a processing event.
2. Normalize email body and attachments.
3. Acquire text from native parsers and OCR.
4. Run AI extraction and deterministic fallbacks.
5. Merge announcement/proposal data.
6. Update result, missing fields, notes and status.
7. Generate/send document email when configuration is complete.

## Important Signals

- Zapier source: `zapier.email_activation`.
- IMAP source: `imap.email_activation`.
- Processing tokens: `x-astebook-token`, `x-astebook-webhook-token`.
- Runtime settings: env values override persisted admin settings.
- Local fallback storage is under `runtime/` when `DATABASE_URL` is absent.
- Extraction feedback powers AI memory through `backend/lib/extraction_feedback.js`.

## Verification

- Lint: `npm run lint`
- Tests: `npm test`
- Build: `npm run build`

## Retrieval Queries

- Route inventory: `rg -n "app\\.(get|post|delete)|register.*Routes|requireProcessingUiToken|requireZapierWebhookToken" backend`
- Processing events: `rg -n "ProcessingEvent|processing_events|publicEvent|extraction-debug|reprocess|send-document" backend docs`
- Runtime settings: `rg -n "getEffectiveSetting|runtime_settings|app-config|redact" backend docs`
- Pipeline flow: `rg -n "createAiExtractionPipeline|runAiExtractionPipeline|finalizeZapierResult|collectMissingFields" backend`
- Document output: `rg -n "buildDocument|sendDocumentEmail|DOCUMENT_TEMPLATE_URL|document_send_to" backend docs`
