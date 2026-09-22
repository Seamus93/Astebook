# Database and Prisma Knowledge

Updated: 2026-09-22

Purpose: map persistent storage, Prisma models, migrations and runtime fallback behavior.

## Entry Points

- `prisma/schema.prisma`: Prisma schema for PostgreSQL.
- `prisma/migrations/`: SQL migrations applied by `prisma migrate deploy`.
- `backend/lib/db.js`: Prisma client singleton.
- `backend/lib/processing_log.js`: processing events and steps persistence.
- `backend/lib/app_config.js`: runtime settings via DB table or JSON fallback.
- `backend/lib/mailbox_index.js`: DB-backed mailbox index with JSON-file fallback.
- `backend/lib/extraction_feedback.js`: feedback records via JSONL/runtime path, with API exposure.
- `docs/DB_SCHEMA.md`: human-facing DB schema and migration policy.

## Models

- `ProcessingEvent`: source, status, request, result, metadata, error and processing steps.
- `ProcessingStep`: timestamped event step with level, message and JSON data.
- `MailboxMessage`: DB-backed mailbox listing, sender/filename decision, cache pointer, event link and processing status.
- `EmailWatcherState`: DB model for watcher state, including `processed_ids` and `last_uid`; note that some watcher paths may still use runtime file state.
- `RuntimeSetting`: key/value runtime admin settings.
- `ExtractionFeedback`: human correction dataset for AI memory.
- `GeocodeCache`: cached geocoding responses.

## Runtime Storage Rules

- Production with `DATABASE_URL` uses PostgreSQL for Prisma-backed features.
- Local/dev without `DATABASE_URL` uses JSON fallbacks in `runtime/` for app config, processing logs and mailbox index.
- Docker Compose provisions PostgreSQL 17 with named volume `postgres_data_v17`.
- The app startup command runs `prisma migrate deploy` before `backend/server.js`.
- GitHub Actions starts PostgreSQL and runs `npm run db:migrate` before lint/build/tests.

## Migrations

Current migration folders:

- `20260717154000_init_postgresql`
- `20260717180500_remove_mailbox_ignore_before`
- `20260720092000_add_mailbox_message_cache`
- `20260721172000_email_watcher_last_uid`

Schema changes require:

- Prisma migration under `prisma/migrations`.
- Update to `docs/DB_SCHEMA.md`.
- Update to this RAG file when models or operational behavior change.
- CI run with migrations.

## Important Operational Detail

Tests that import `backend/server.js` and hit processing-event routes require a usable `DATABASE_URL` if the code path reaches Prisma. Without it, Prisma raises `Environment variable not found: DATABASE_URL`.

## Retrieval Queries

- Prisma models: `rg -n "model |@@map|@@index|datasource|generator" prisma/schema.prisma`
- Processing event persistence: `rg -n "ProcessingEvent|processingEvent|ProcessingStep|processingStep" backend/lib backend/routes backend/tests`
- Runtime settings: `rg -n "RuntimeSetting|getEffectiveSetting|runtime_settings|app-config" backend docs .rag`
- Mailbox DB: `rg -n "MailboxMessage|mailboxMessage|mailbox_messages|listPendingMailboxMessagesForProcessing" backend prisma docs .rag`
- Migrations: `rg -n "mailbox|runtime_settings|processing_events|last_uid|mail_cache" prisma/migrations docs`

## Related Docs

- `docs/DB_SCHEMA.md`
- `docs/API.md`
- `docs/ai-context/backend-api.md`
- `docs/ai-context/mailbox-ingestion.md`
- `docs/ai-context/ops-deploy.md`
