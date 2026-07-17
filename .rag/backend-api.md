# Backend/API Knowledge

Updated: 2026-07-10

## Core Files

- `backend/server.js`: Express app composition, Zapier/IMAP intake, extraction orchestration and legacy `/callAI`.
- `backend/lib/db.js`: Prisma client singleton for PostgreSQL-backed persistence.
- `backend/lib/app_config.js`: runtime settings via PostgreSQL `runtime_settings` in production, JSON fallback/admin bootstrap in `runtime/app-config.json`, effective setting lookup.
- `backend/routes/admin_auth.js`: admin setup/login/recovery/logout routes plus session cookie verification middleware.
- `backend/routes/admin_settings.js`: admin settings read/update API, runtime config persistence and session refresh after admin secret changes.
- `backend/routes/call_ai.js`: legacy `/callAI` route wired to the current extraction pipeline.
- `backend/routes/email_intake.js`: Zapier email activation route and IMAP watcher activation handler.
- `backend/routes/processing_events.js`: processing event list/detail/document/send/reprocess API routes.
- `backend/lib/attachments.js`: Zapier/IMAP attachment descriptor normalization, URL extraction, download and format inference.
- `backend/lib/extraction_enrichment.js`: output formatting, OpenIBAN lookup and optional geocoding helpers. Nominatim is the default geocoder, Google remains available when selected and configured.
- `backend/lib/extraction_feedback.js`: JSONL storage for human corrections used as extraction feedback/training examples.
- `backend/lib/extraction_pipeline.js`: AI extraction orchestration over email body, attachments, OCR, merge, processing log updates and auto-send handoff.
- `backend/lib/extraction_result.js`: extraction result helpers, proposal merge, missing-field checks, note handling and email/body normalization.
- `backend/lib/document_email.js`: generated document email composition, quality report, inline logos and automatic send result logging.
- `backend/lib/format_utils.js`: date and money formatting helpers used by merge/output shaping.
- `backend/lib/html.js`: HTML escaping helper.
- `backend/lib/processing_log.js`: JSONL processing event store in `runtime/processing-events.jsonl`.
- `backend/lib/settings_validation.js`: settings redaction, email recipient parsing/validation and configuration issue collection.
- `backend/lib/smtp.js`: SMTP settings, transport creation and recovery email sending.
- `backend/lib/ai.js`: OpenAI/OpenRouter integration plus deterministic extraction fallbacks such as annuncio `Localizzazione` address/comune.
- `backend/lib/pdf.js`: PDF parsing.
- `backend/lib/docx.js`: DOCX parsing.
- `backend/lib/pdf_app.js`: PDF-app OCR integration.
- `backend/lib/document_builder.js`: DOCX/PDF output generation.
- `backend/lib/merge_json.js`: announcement/proposal merge and normalization.
- `backend/lib/email_cleaner.js`: email body cleaning before AI.

## Database

- PostgreSQL is provisioned by `docker-compose.yml` as service `db`.
- Data persists in `./runtime/postgres`.
- Prisma schema lives in `prisma/schema.prisma`; migrations live in `prisma/migrations`.
- The Docker app command runs `prisma migrate deploy` before `backend/server.js`.
- CI starts a PostgreSQL service and runs `npm run db:migrate` before lint/build/tests.
- In production, mailbox listing is read from `mailbox_messages`; the IMAP watcher writes new/updated messages there. The `/api/v1/admin/mailbox/sync` endpoint is now an import/backfill path, used mainly when the mailbox table is empty.

## Important Endpoints

- `GET /health`: returns `{ status: "ok", service: "astebook-api", version }`.
- `GET /setup`, `POST /setup`: first runtime admin creation when env admin is absent.
- `GET /login`, `POST /login`, `/logout`: server-side admin session.
- `GET /admin/*`: protected React admin UI.
- `GET /api/v1/admin/settings`: admin settings; `?reveal=1` returns stored values.
- `POST /api/v1/admin/settings`: persists runtime settings; env vars override runtime settings.
- `POST /api/v1/zapier/email-activation`: raw activation email intake.
- `GET /api/v1/processing-events`: processing event list for UI.
- `GET /api/v1/processing-events/:id`: full event detail.
- `POST /api/v1/processing-events/:id/feedback`: saves human correction feedback and optionally applies it to the event result.
- `GET /api/v1/extraction-feedback`: lists saved feedback examples, optionally filtered by `event_id`.
- `POST /api/v1/admin/email-watcher/scan`: runs one immediate IMAP watcher scan from the admin settings page and returns counters plus skipped-mail diagnostics.
- `POST /api/v1/processing-events/:id/reprocess` accepts `skip_auto_send: true` to run OCR/AI/merge without document email delivery.
- `POST /api/v1/processing-events/:id/reprocess`: reruns pipeline after configuration checks.
- `GET /api/v1/processing-events/:id/document`: generates document.
- `POST /api/v1/processing-events/:id/send-document`: manual document email delivery.
- `POST /callAI`: legacy/direct AI extraction path.

## Zapier Intake Notes

- Current source: `zapier.email_activation`.
- Security header: `x-astebook-webhook-token`, value from `ZAPIER_WEBHOOK_TOKEN` or runtime `zapier_webhook_token`.
- Metadata currently tracks subject, sender, `zap_run_id`, `email_id`.
- Dedupe should use stable external email IDs such as `email_id`, `message_id`, `gmail_id`; Zapier naming may vary.
- Existing Zapier payloads may use camelCase or compact names (`zapRunId`, `emailid`, `zaprunid`, `emailbodytext`), so alias handling should be explicit if needed.
- Attachments may arrive as multipart files, URLs, nested JSON, JSON strings or flattened fields such as `attachment_1_attachment`.

## Processing Flow

1. Create processing event in JSONL log.
2. Resolve email text and clean it.
3. Extract practice code and announcement data from email body.
4. Collect attachment descriptors and supported file content.
5. Parse/OCR/extract announcement, proposal and commission documents.
6. Merge announcement/proposal fields.
7. Update event result, missing fields, notes and status.
8. Auto-send generated document email when merged data and SMTP/document settings are complete.

## Extraction Feedback Loop

- Human corrections are saved in `runtime/extraction-feedback.jsonl`.
- Each feedback entry records event id, field path, AI value, corrected value, source file, source excerpt, model and prompt version.
- The admin event detail UI includes a correction form that can apply the corrected value to the current event immediately.
- Extraction agents load recent scoped feedback as human-correction context for `annuncio`, `proposta` and `provvigione` prompts.
- `GET /api/v1/extraction-feedback/summary` exposes dataset metrics for the admin console.
- `GET /api/v1/extraction-feedback/context?scope=...` exposes the generated prompt-memory context.
- Offline benchmark evaluation against a frozen gold dataset is not implemented yet.

## Runtime Settings

Key settings include:

- In production with `DATABASE_URL`, admin UI settings persist in PostgreSQL table `runtime_settings`.
- Env vars override DB values.
- Local/dev runs without `DATABASE_URL` keep using `runtime/app-config.json`.

- `processing_ui_token`
- `zapier_webhook_token`
- `admin_session_secret`
- `ai_api_key`
- `ai_base_url`
- `ai_model`
- `ai_memory_enabled`
- `ai_memory_examples_limit`
- `geocoder_provider`
- `nominatim_base_url`
- `nominatim_user_agent`
- `pdf_app_api_key`
- `pdf_app_ocr_endpoint`
- `pdf_app_job_endpoint`
- `document_template_url`
- `document_send_to`
- `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_user`, `smtp_password`, `smtp_from`

## Geocoding

- Default provider: `nominatim`.
- Disable with `geocoder_provider=none`.
- Google geocoding is still supported with `geocoder_provider=google` and `GOOGLE_MAPS_API_KEY`.
- Nominatim calls use `nominatim_base_url`, `nominatim_user_agent`, `countrycodes=it`, `addressdetails=1` and Italian language hints.
- Geocode responses are cached in `runtime/geocode-cache.json`.
- The Nominatim public-service path is throttled to one request per second.

## VPS-Only Email Intake

Astebook can run email intake directly on the VPS with `backend/lib/email_watcher.js`.

Current behavior:

- IMAP watcher starts with the server and stays idle unless `email_watcher_enabled=true`.
- First automatic scan is delayed by `EMAIL_WATCHER_START_DELAY_SECONDS`, default `30`. Mailbox listing reads from the database; the IMAP sync endpoint is kept as a bounded historical import/backfill and pauses the watcher before resuming it after the same delay.
- Historical mailbox import searches IMAP by date window first, then fetches UID batches. Tune with `MAILBOX_INITIAL_BACKFILL_DAYS`, `MAILBOX_BACKFILL_SCAN_LIMIT` and `MAILBOX_SYNC_TIMEOUT_SECONDS`.
- IMAP operations are serialized with a timeout; mailbox sync defaults to `MAILBOX_SYNC_TIMEOUT_SECONDS=180` and email processing runs OCR/AI after releasing the IMAP lock.
- IMAP credentials reuse SMTP user/password unless `EMAIL_WATCHER_IMAP_USER` and `EMAIL_WATCHER_IMAP_PASSWORD` are set.
- IMAP host can be configured or derived from SMTP host, for example `smtp.gmail.com` -> `imap.gmail.com`.
- Filters: sender allowlist plus required attachment filename substring, default `proposta`; proposal-equivalent names such as `offerta irrevocabile` and `offerta d'acquisto` are accepted.
- Accepted emails become `imap.email_activation` processing events and use the same AI/OCR/document pipeline as Zapier.
- Immobiliare.it/Apify data, when available, replaces overlapping `extracted.annuncio` fields and keeps the AI/email/PDF result in `fallback_annuncio`.
- Deduplication state is persisted in `runtime/email-watcher-state.json`.
- Accepted emails are marked `Seen`; skipped emails are remembered locally but not marked read.

## Verification

- Lint: `npm run lint`.
- Tests: `npm test`.
- Full frontend build: `npm run build`.
