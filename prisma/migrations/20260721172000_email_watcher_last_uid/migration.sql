ALTER TABLE "email_watcher_state"
  ADD COLUMN "last_uid" INTEGER,
  ADD COLUMN "mailbox" TEXT NOT NULL DEFAULT 'INBOX',
  ADD COLUMN "baseline_at" TIMESTAMP(3);

