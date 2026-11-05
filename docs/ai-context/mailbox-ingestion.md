# Mailbox Ingestion Knowledge

Updated: 2026-09-22

Purpose: fast retrieval map for IMAP watcher, DB-backed mailbox listing, sync/backfill and auto-processing. Canonical behavior lives in `docs/MAILBOX.md`.

## Core Files

- `backend/lib/email_watcher.js`: automatic IMAP watcher, sender/filename filtering and mailbox indexing.
- `backend/lib/mailbox_browser.js`: admin mailbox listing, sync/backfill and manual processing.
- `backend/lib/mailbox_index.js`: DB/file mailbox index, pending query and processing claim logic.
- `backend/lib/mailbox_auto_processor.js`: scheduled auto-processing for indexed rows.
- `backend/lib/mail_cache.js`: raw `.eml` cache under `runtime/mailbox-cache`.
- `backend/lib/imap_operation_lock.js`: serialized IMAP operations, retry and timeout handling.
- `backend/ai_agents/Interceptor.js`: sender allowlist, required filename and duplicate decision logic.
- `backend/server.js`: wires watcher, sync, manual process and auto-process routes.
- `frontend/src/admin/eventList.js`: loads indexed mailbox messages in the admin sidebar.
- `frontend/src/admin/settingsController.js`: watcher and mailbox admin actions.

## Important Signals

- Endpoint catalog: `docs/API.md`.
- Canonical behavior: `docs/MAILBOX.md`.
- DB mode: active when `DATABASE_URL` is set and `MAILBOX_INDEX_FILE` is not forced.
- File fallbacks: `runtime/mailbox-index.json`, `runtime/mailbox-cache`, `runtime/email-watcher-state.json`.
- Processing gate: `status="mailbox_indexed"`, `eventId=null`, `processed=false`, UID present, sender not disallowed.
- Claim transition: `claimMailboxMessageForProcessing()` moves a row to `processing`.

## Tests

- `backend/tests/email_watcher.test.js`
- `backend/tests/mailbox_index.test.js`
- `backend/tests/health.test.js`
- `backend/tests/extraction_pipeline.test.js`

## Retrieval Queries

- Watcher: `rg -n "createEmailWatcher|pollMailbox|scanNow|EMAIL_WATCHER|email_watcher" backend docs`
- Sidebar listing: `rg -n "mailbox/messages|listMailboxMessages|listMailboxIndexMessages|fetchMailboxMessages" backend frontend/src/admin docs`
- Auto process: `rg -n "createMailboxAutoProcessor|listPendingMailboxMessagesForProcessing|claimMailboxMessageForProcessing|MAILBOX_AUTO" backend docs`
- IMAP timeout/lock: `rg -n "runExclusiveImapOperation|withImapRetries|MAILBOX_SYNC_TIMEOUT|MAILBOX_PROCESS_TIMEOUT|IMAP timeout" backend docs`
- Mail cache: `rg -n "cacheMailboxSource|readCachedMailboxSource|mail_cache|MAILBOX_CACHE_DIR" backend docs`

## Related Docs

- `docs/MAILBOX.md`
- `docs/API.md`
- `docs/ai-context/database-prisma.md`
- `docs/ai-context/backend-api.md`
