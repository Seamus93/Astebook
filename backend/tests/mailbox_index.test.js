import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("mailbox index recovers from corrupt JSON with backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astebook-mailbox-index-"));
  const indexFile = join(dir, "mailbox-index.json");
  const previousRuntimeDir = process.env.RUNTIME_DIR;
  const previousIndexFile = process.env.MAILBOX_INDEX_FILE;
  process.env.RUNTIME_DIR = dir;
  process.env.MAILBOX_INDEX_FILE = indexFile;

  try {
    await writeFile(indexFile, '{\n  "messages": [\n    { "uid": 1, }\n  ]\n}\n', "utf8");
    const { readMailboxIndex } = await import(`../lib/mailbox_index.js?test=${Date.now()}`);
    const index = await readMailboxIndex();
    const files = await readdir(dir);
    const resetRaw = await readFile(indexFile, "utf8");

    assert.deepEqual(index.messages, []);
    assert.equal(JSON.parse(resetRaw).messages.length, 0);
    assert.equal(files.some((file) => file.includes(".corrupt-")), true);
  } finally {
    if (previousRuntimeDir === undefined) delete process.env.RUNTIME_DIR;
    else process.env.RUNTIME_DIR = previousRuntimeDir;
    if (previousIndexFile === undefined) delete process.env.MAILBOX_INDEX_FILE;
    else process.env.MAILBOX_INDEX_FILE = previousIndexFile;
    await rm(dir, { recursive: true, force: true });
  }
});

test("mailbox auto process candidates require mailbox_indexed status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astebook-mailbox-candidates-"));
  const indexFile = join(dir, "mailbox-index.json");
  const previousRuntimeDir = process.env.RUNTIME_DIR;
  const previousIndexFile = process.env.MAILBOX_INDEX_FILE;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.RUNTIME_DIR = dir;
  process.env.MAILBOX_INDEX_FILE = indexFile;
  delete process.env.DATABASE_URL;

  try {
    const ignored = Array.from({ length: 553 }, (_, index) => ({
      id: `ignored-${index}`,
      uid: index + 1,
      mailbox: "INBOX",
      status: "ignored",
      processing_status: "ignored",
      processed: false,
      sender_allowed: true,
      date: `2026-07-20T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }));
    await writeFile(indexFile, JSON.stringify({
      messages: [
        ...ignored,
        {
          id: "ready",
          uid: 900,
          mailbox: "INBOX",
          status: "mailbox_indexed",
          processing_status: "mailbox_indexed",
          processed: false,
          sender_allowed: true,
          date: "2026-07-21T08:24:00.000Z",
        },
        {
          id: "failed",
          uid: 901,
          mailbox: "INBOX",
          status: "process_failed",
          processing_status: "process_failed",
          processed: false,
          sender_allowed: true,
          date: "2026-07-21T08:25:00.000Z",
        },
      ],
    }), "utf8");

    const { listPendingMailboxMessagesForProcessing } = await import(`../lib/mailbox_index.js?test=${Date.now()}`);
    const candidates = await listPendingMailboxMessagesForProcessing({ limit: 25 });

    assert.deepEqual(candidates.map((message) => message.id), ["ready"]);
  } finally {
    if (previousRuntimeDir === undefined) delete process.env.RUNTIME_DIR;
    else process.env.RUNTIME_DIR = previousRuntimeDir;
    if (previousIndexFile === undefined) delete process.env.MAILBOX_INDEX_FILE;
    else process.env.MAILBOX_INDEX_FILE = previousIndexFile;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await rm(dir, { recursive: true, force: true });
  }
});

test("mailbox claim allows only one concurrent automatic processor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astebook-mailbox-claim-"));
  const indexFile = join(dir, "mailbox-index.json");
  const previousRuntimeDir = process.env.RUNTIME_DIR;
  const previousIndexFile = process.env.MAILBOX_INDEX_FILE;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.RUNTIME_DIR = dir;
  process.env.MAILBOX_INDEX_FILE = indexFile;
  delete process.env.DATABASE_URL;

  try {
    const message = {
      id: "claim-me",
      uid: 1000,
      mailbox: "INBOX",
      status: "mailbox_indexed",
      processing_status: "mailbox_indexed",
      processed: false,
      sender_allowed: true,
      date: "2026-07-21T08:24:00.000Z",
    };
    await writeFile(indexFile, JSON.stringify({ messages: [message] }), "utf8");

    const { claimMailboxMessageForProcessing, readMailboxIndex } =
      await import(`../lib/mailbox_index.js?test=${Date.now()}`);
    const claims = await Promise.all([
      claimMailboxMessageForProcessing(message),
      claimMailboxMessageForProcessing(message),
    ]);
    const successfulClaims = claims.filter(Boolean);
    const index = await readMailboxIndex();

    assert.equal(successfulClaims.length, 1);
    assert.equal(successfulClaims[0].status, "processing");
    assert.equal(index.messages[0].status, "processing");
    assert.equal(index.messages[0].processing_status, "processing");
  } finally {
    if (previousRuntimeDir === undefined) delete process.env.RUNTIME_DIR;
    else process.env.RUNTIME_DIR = previousRuntimeDir;
    if (previousIndexFile === undefined) delete process.env.MAILBOX_INDEX_FILE;
    else process.env.MAILBOX_INDEX_FILE = previousIndexFile;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await rm(dir, { recursive: true, force: true });
  }
});
