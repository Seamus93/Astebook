# Database and Prisma Knowledge

Updated: 2026-09-22

Purpose: fast retrieval map for persistent storage, Prisma models, migrations and runtime fallback behavior. Canonical database behavior lives in `docs/DB_SCHEMA.md`.

## Entry Points

- `prisma/schema.prisma`: Prisma schema for PostgreSQL.
- `prisma/migrations/`: SQL migrations applied by `prisma migrate deploy`.
- `backend/lib/db.js`: Prisma client singleton.
- `backend/lib/processing_log.js`: processing events and steps persistence.
- `backend/lib/app_config.js`: runtime settings via DB table or JSON fallback.
- `backend/lib/mailbox_index.js`: DB-backed mailbox index with JSON-file fallback.
- `backend/lib/extraction_feedback.js`: feedback records via JSONL/runtime path.

## Important Signals

- Production storage requires `DATABASE_URL`.
- Local/dev fallback files live under `runtime/`.
- Docker Compose uses PostgreSQL 17 with named volume `postgres_data_v17`.
- Startup runs `prisma migrate deploy` before `backend/server.js`.
- CI runs migrations before lint/build/tests.

## Models

- `ProcessingEvent`, `ProcessingStep`
- `MailboxMessage`, `EmailWatcherState`
- `RuntimeSetting`
- `ExtractionFeedback`
- `GeocodeCache`

## Retrieval Queries

- Prisma models: `rg -n "model |@@map|@@index|datasource|generator" prisma/schema.prisma`
- Processing event persistence: `rg -n "ProcessingEvent|processingEvent|ProcessingStep|processingStep" backend/lib backend/routes backend/tests`
- Runtime settings: `rg -n "RuntimeSetting|getEffectiveSetting|runtime_settings|app-config" backend docs`
- Mailbox DB: `rg -n "MailboxMessage|mailboxMessage|mailbox_messages|listPendingMailboxMessagesForProcessing" backend prisma docs`
- Migrations: `rg -n "mailbox|runtime_settings|processing_events|last_uid|mail_cache" prisma/migrations docs`

## Related Docs

- `docs/DB_SCHEMA.md`
- `docs/API.md`
- `docs/MAILBOX.md`
- `docs/ai-context/backend-api.md`
- `docs/ai-context/mailbox-ingestion.md`
- `docs/ai-context/ops-deploy.md`
