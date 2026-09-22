# Mailbox Ingestion Knowledge

Updated: 2026-09-22

Purpose: map IMAP watcher, mailbox DB listing, mailbox sync/backfill and auto-processing behavior.

## Core Files

- `backend/lib/email_watcher.js`: automatic IMAP watcher. Creates polling loop, evaluates sender/filename filters, caches accepted raw emails and indexes them into `mailbox_messages`.
- `backend/lib/mailbox_browser.js`: admin mailbox listing, historical sync/backfill and manual processing of a mailbox row.
- `backend/lib/mailbox_index.js`: DB/file abstraction for indexed mailbox messages, pending processing query and processing claims.
- `backend/lib/mailbox_auto_processor.js`: cron-like auto processor for indexed mailbox rows.
- `backend/lib/mail_cache.js`: raw `.eml` cache under `runtime/mailbox-cache`.
- `backend/lib/imap_operation_lock.js`: serializes IMAP operations and wraps timeout/retry behavior.
- `backend/ai_agents/Interceptor.js`: sender allowlist, required filename and duplicate decision logic.
- `backend/server.js`: wires watcher, mailbox sync endpoints and auto processor.
- `frontend/src/admin/eventList.js`: loads mailbox messages in the admin sidebar.
- `frontend/src/admin/settingsController.js`: watcher/admin actions from settings.

## Main Endpoints

- `GET /api/v1/admin/mailbox/messages`: reads indexed mailbox rows; normal sidebar load should not open IMAP.
- `GET /api/v1/admin/email-watcher/messages`: alias for mailbox messages.
- `POST /api/v1/admin/mailbox/sync`: runs IMAP sync/backfill in background.
- `POST /api/v1/admin/email-watcher/scan`: runs one watcher scan.
- `POST /api/v1/admin/mailbox/messages/:uid/process`: processes one indexed mailbox message.
- `POST /api/v1/admin/mailbox/auto-process/run`: forces one auto-process batch.
- `GET /api/v1/admin/mailbox/auto-process/status`: returns auto processor status.

## Data Flow

1. Watcher or manual sync connects to IMAP with `ImapFlow`.
2. Message summaries are evaluated by `evaluateEmailInterceptorDecision()`.
3. Matching messages are saved in `mailbox_messages` through `upsertMailboxMessages()`.
4. Raw source can be cached via `cacheMailboxSource()` for later processing without re-fetching IMAP.
5. Manual processing or auto process claims a row with `claimMailboxMessageForProcessing()`.
6. `processMailboxMessage()` parses cached or fetched mail, builds the same body/files shape used by Zapier, and calls the extraction pipeline.
7. The mailbox row is updated with `event_id`, status and processing status.

## State and Fallbacks

- DB mode is active when `DATABASE_URL` is set and `MAILBOX_INDEX_FILE` is not forced.
- File fallback uses `runtime/mailbox-index.json`.
- Raw mail cache uses `runtime/mailbox-cache`.
- Watcher file state defaults to `runtime/email-watcher-state.json`; docs note that some watcher behavior does not rely on the Prisma `email_watcher_state` row.

## Candidate Selection

`listPendingMailboxMessagesForProcessing()` selects DB rows with:

- `status: "mailbox_indexed"`
- `eventId: null`
- `processed: false`
- `uid` present
- `senderAllowed` not false

Then `claimMailboxMessageForProcessing()` atomically moves status to `processing` for DB mode.

## Settings

Common runtime/env settings:

- `email_watcher_enabled`
- `email_watcher_imap_host`, `email_watcher_imap_port`, `email_watcher_imap_secure`
- `email_watcher_from_allowlist`
- `email_watcher_required_filename`
- `email_watcher_poll_seconds`
- `EMAIL_WATCHER_START_DELAY_SECONDS`
- `EMAIL_WATCHER_SCAN_LIMIT`
- `MAILBOX_SYNC_TIMEOUT_SECONDS`
- `MAILBOX_PROCESS_TIMEOUT_SECONDS`
- `mailbox_auto_process_enabled`
- `mailbox_auto_process_interval_seconds`
- `mailbox_auto_process_limit`

## Tests

- `backend/tests/email_watcher.test.js`
- `backend/tests/mailbox_index.test.js`
- `backend/tests/health.test.js`
- `backend/tests/extraction_pipeline.test.js`

## Retrieval Queries

- Watcher: `rg -n "createEmailWatcher|pollMailbox|scanNow|EMAIL_WATCHER|email_watcher" backend docs .rag`
- Sidebar listing: `rg -n "mailbox/messages|listMailboxMessages|listMailboxIndexMessages|fetchMailboxMessages" backend frontend/src/admin docs .rag`
- Auto process: `rg -n "createMailboxAutoProcessor|listPendingMailboxMessagesForProcessing|claimMailboxMessageForProcessing|MAILBOX_AUTO" backend docs .rag`
- IMAP timeout/lock: `rg -n "runExclusiveImapOperation|withImapRetries|MAILBOX_SYNC_TIMEOUT|MAILBOX_PROCESS_TIMEOUT|IMAP timeout" backend docs .rag`
- Mail cache: `rg -n "cacheMailboxSource|readCachedMailboxSource|mail_cache|MAILBOX_CACHE_DIR" backend docs .rag`

## Related Docs

- `docs/watcher-current-behavior.md`
- `docs/sidebar-current-behavior.md`
- `docs/cron-current-behavior.md`
- `docs/mailbox-hardening-plan.md`
- `docs/ai-context/database-prisma.md`
- `docs/ai-context/backend-api.md`
