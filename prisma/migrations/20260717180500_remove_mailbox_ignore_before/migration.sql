-- Archive the pre-watcher mailbox history before removing timestamp-based ignore logic.
-- Cutoff requested by operations: 2026-07-17 00:01 Europe/Rome = 2026-07-16 22:01 UTC.
UPDATE "mailbox_messages"
SET
  "processed" = true,
  "before_baseline" = false,
  "ignore_before" = null,
  "status" = COALESCE("status", 'archived_before_watcher_cutoff'),
  "processing_status" = COALESCE("processing_status", 'archived_before_watcher_cutoff'),
  "last_synced_at" = CURRENT_TIMESTAMP
WHERE "date" IS NOT NULL
  AND "date" < TIMESTAMP '2026-07-16 22:01:00';

UPDATE "email_watcher_state"
SET "ignore_before" = null;

ALTER TABLE "mailbox_messages" DROP COLUMN IF EXISTS "before_baseline";
ALTER TABLE "mailbox_messages" DROP COLUMN IF EXISTS "ignore_before";
ALTER TABLE "email_watcher_state" DROP COLUMN IF EXISTS "ignore_before";
