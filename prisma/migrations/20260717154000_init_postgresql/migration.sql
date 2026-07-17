CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE "processing_events" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "metadata" JSONB,
  "request" JSONB,
  "result" JSONB,
  "error" JSONB,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "processing_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "processing_steps" (
  "id" SERIAL NOT NULL,
  "event_id" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "level" TEXT NOT NULL DEFAULT 'info',
  "message" TEXT NOT NULL,
  "data" JSONB,

  CONSTRAINT "processing_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mailbox_messages" (
  "id" TEXT NOT NULL,
  "message_id" TEXT,
  "uid" INTEGER,
  "mailbox" TEXT NOT NULL DEFAULT 'INBOX',
  "subject" TEXT,
  "from" JSONB,
  "sender_candidates" JSONB,
  "to" JSONB,
  "date" TIMESTAMP(3),
  "seen" BOOLEAN NOT NULL DEFAULT false,
  "sender_allowed" BOOLEAN,
  "allowed_from" JSONB,
  "processed" BOOLEAN NOT NULL DEFAULT false,
  "before_baseline" BOOLEAN NOT NULL DEFAULT false,
  "ignore_before" TIMESTAMP(3),
  "required_filename_match" BOOLEAN,
  "required_filename" TEXT,
  "filenames" JSONB,
  "interceptor" JSONB,
  "event_id" TEXT,
  "status" TEXT,
  "processing_status" TEXT,
  "last_synced_at" TIMESTAMP(3),

  CONSTRAINT "mailbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_watcher_state" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "processed_ids" JSONB NOT NULL DEFAULT '[]',
  "ignore_before" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "email_watcher_state_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "runtime_settings" (
  "key" TEXT NOT NULL,
  "value" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "runtime_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "extraction_feedback" (
  "id" TEXT NOT NULL,
  "event_id" TEXT,
  "field_path" TEXT NOT NULL,
  "ai_value" JSONB,
  "corrected_value" JSONB,
  "rating" TEXT,
  "reason" TEXT,
  "model" TEXT,
  "prompt_version" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "extraction_feedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "geocode_cache" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "processing_events_source_idx" ON "processing_events"("source");
CREATE INDEX "processing_events_status_idx" ON "processing_events"("status");
CREATE INDEX "processing_events_received_at_idx" ON "processing_events"("received_at");

CREATE INDEX "processing_steps_event_id_idx" ON "processing_steps"("event_id");
CREATE INDEX "processing_steps_at_idx" ON "processing_steps"("at");

CREATE UNIQUE INDEX "mailbox_messages_mailbox_uid_key" ON "mailbox_messages"("mailbox", "uid");
CREATE INDEX "mailbox_messages_date_idx" ON "mailbox_messages"("date");
CREATE INDEX "mailbox_messages_event_id_idx" ON "mailbox_messages"("event_id");
CREATE INDEX "mailbox_messages_processed_idx" ON "mailbox_messages"("processed");

CREATE INDEX "extraction_feedback_field_path_idx" ON "extraction_feedback"("field_path");
CREATE INDEX "extraction_feedback_created_at_idx" ON "extraction_feedback"("created_at");

ALTER TABLE "processing_steps"
  ADD CONSTRAINT "processing_steps_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "processing_events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
