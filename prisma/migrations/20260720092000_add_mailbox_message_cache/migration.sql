ALTER TABLE "mailbox_messages" ADD COLUMN IF NOT EXISTS "mail_cache" JSONB;
