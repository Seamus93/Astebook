import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { attachmentFilenameMatchesRequired } from "../lib/email_watcher.js";
import { syncMailboxMessages } from "../lib/mailbox_browser.js";
import {
  collectEmailAddressCandidates,
  evaluateEmailInterceptorDecision,
} from "../ai_agents/Interceptor.js";

test("email watcher required filename matching tolerates separators and case", () => {
  assert.equal(
    attachmentFilenameMatchesRequired(
      "__Allegato B_Format Proposta_def_outsourcing_std - Definitiva formale.pdf",
      "proposta def outsourcing std"
    ),
    true
  );
});

test("email watcher required filename matching still rejects unrelated attachments", () => {
  assert.equal(
    attachmentFilenameMatchesRequired("documento identita cliente.pdf", "proposta def outsourcing std"),
    false
  );
});

test("email watcher treats irrevocable purchase offer as proposal attachment", () => {
  assert.equal(
    attachmentFilenameMatchesRequired("PI-SAN-1121295_Offerta Irrevocabile d'Acquisto.pdf", "proposta"),
    true
  );
});

test("email interceptor accepts direct allowed sender with required attachment", () => {
  const decision = evaluateEmailInterceptorDecision({
    message: {
      from: { value: [{ address: "lc@astebook.com" }] },
      date: new Date("2026-07-14T09:45:00.000Z"),
      attachments: [{ filename: "Allegato_B_Format_Proposta.docx" }],
    },
    settings: {
      fromAllowlist: ["lc@astebook.com"],
      requiredFilename: "proposta",
    },
    state: { processed: [] },
    messageKey: "mail-1",
  });

  assert.equal(decision.processable, true);
  assert.equal(decision.sender_allowed, true);
  assert.equal(decision.required_filename_match, true);
});

test("email interceptor accepts irrevocable offer when proposal file is required", () => {
  const decision = evaluateEmailInterceptorDecision({
    message: {
      from: { value: [{ address: "lc@astebook.com" }] },
      date: new Date("2026-07-17T09:45:00.000Z"),
      attachments: [{ filename: "PI-SAN-1121295_Offerta Irrevocabile d'Acquisto.pdf" }],
    },
    settings: {
      fromAllowlist: ["lc@astebook.com"],
      requiredFilename: "proposta",
    },
    state: { processed: [] },
    messageKey: "mail-offerta-irrevocabile",
  });

  assert.equal(decision.processable, true);
  assert.equal(decision.required_filename_match, true);
});

test("email interceptor recognizes allowed sender inside forwarded body", () => {
  const decision = evaluateEmailInterceptorDecision({
    message: {
      from: { value: [{ address: "simonefioroni93@gmail.com" }] },
      text: "---------- Forwarded message ---------\nDa: Lorella Colzani - Astebook <lc@astebook.com>",
      date: new Date("2026-07-14T09:45:00.000Z"),
      attachments: [{ filename: "Allegato B Format Proposta.docx" }],
    },
    settings: {
      fromAllowlist: ["lc@astebook.com"],
      requiredFilename: "proposta",
    },
    state: { processed: [] },
    messageKey: "mail-2",
  });

  assert.equal(decision.processable, true);
  assert.deepEqual(decision.sender_candidates.forwarded_from, ["lc@astebook.com"]);
});

test("email interceptor explains why a mail is skipped", () => {
  const decision = evaluateEmailInterceptorDecision({
    message: {
      from: { value: [{ address: "not-authorized@example.com" }] },
      date: new Date("2026-07-13T09:45:00.000Z"),
      attachments: [{ filename: "documento identita.pdf" }],
    },
    settings: {
      fromAllowlist: ["lc@astebook.com"],
      requiredFilename: "proposta",
    },
    state: { processed: [] },
    messageKey: "mail-3",
  });

  assert.equal(decision.processable, false);
  assert.deepEqual(decision.reasons, [
    "sender_not_allowed",
    "required_attachment_missing",
  ]);
});

test("email interceptor does not call skipped mail processed", () => {
  const decision = evaluateEmailInterceptorDecision({
    message: {
      from: { value: [{ address: "lc@astebook.com" }] },
      date: new Date("2026-07-14T09:45:00.000Z"),
      attachments: [{ filename: "documento identita.pdf" }],
    },
    settings: {
      fromAllowlist: ["lc@astebook.com"],
      requiredFilename: "proposta",
    },
    state: { processed: [] },
    messageKey: "mail-without-proposal",
  });

  assert.equal(decision.processable, false);
  assert.equal(decision.processed, false);
  assert.deepEqual(decision.reasons, ["required_attachment_missing"]);
});

test("email interceptor marks only state matches as already processed", () => {
  const decision = evaluateEmailInterceptorDecision({
    message: {
      from: { value: [{ address: "lc@astebook.com" }] },
      attachments: [{ filename: "Proposta.pdf" }],
    },
    settings: {
      fromAllowlist: ["lc@astebook.com"],
      requiredFilename: "proposta",
    },
    state: { processed: ["mail-processed"] },
    messageKey: "mail-processed",
  });

  assert.equal(decision.processable, false);
  assert.equal(decision.processed, true);
  assert.deepEqual(decision.reasons, ["already_processed"]);
});

test("email interceptor exposes sender candidates from structured fields", () => {
  const candidates = collectEmailAddressCandidates({
    from: { value: [{ address: "from@example.com" }] },
    sender: { value: [{ address: "sender@example.com" }] },
    replyTo: { value: [{ address: "reply@example.com" }] },
  });

  assert.deepEqual(candidates.all, ["from@example.com", "sender@example.com", "reply@example.com"]);
});

test("mailbox sync reports missing IMAP configuration without polling watcher", async () => {
  const envKeys = [
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "EMAIL_WATCHER_IMAP_HOST",
    "EMAIL_WATCHER_IMAP_USER",
    "EMAIL_WATCHER_IMAP_PASSWORD",
  ];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  envKeys.forEach((key) => delete process.env[key]);
  try {
    const result = await syncMailboxMessages({
      getSettings: async () => ({}),
      findProcessingEventByExternalEmailId: async () => null,
    });

    assert.equal(result.ok, false);
    assert.equal(result.disabled_reason, "IMAP host/user/password missing");
    assert.deepEqual(result.messages, []);
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

function createMockImapClient({ uids = [], messages = [] } = {}) {
  const searchCalls = [];
  const fetchCalls = [];
  return {
    searchCalls,
    fetchCalls,
    client: {
      on() {},
      async connect() {},
      async logout() {},
      async getMailboxLock() {
        return { release() {} };
      },
      async search(query) {
        searchCalls.push(query);
        return uids;
      },
      async *fetch(uidBatch, query) {
        fetchCalls.push({ uidBatch, query });
        const selected = Array.isArray(uidBatch) ? uidBatch : [uidBatch];
        if (query?.source) {
          for (const uid of selected) {
            yield { uid, source: Buffer.from(`Subject: cached ${uid}\r\n\r\nBody`) };
          }
          return;
        }
        for (const uid of selected) {
          const message = messages.find((item) => item.uid === uid);
          if (message) yield message;
        }
      },
    },
  };
}

function imapMessage({ uid, from, subject = "Test", filename = "Proposta.pdf" }) {
  return {
    uid,
    flags: [],
    internalDate: new Date(`2026-07-21T08:${String(uid % 60).padStart(2, "0")}:00.000Z`),
    envelope: {
      subject,
      messageId: `message-${uid}`,
      from: [{ address: from }],
      to: [{ address: "ops@example.com" }],
      date: new Date(`2026-07-21T08:${String(uid % 60).padStart(2, "0")}:00.000Z`),
    },
    bodyStructure: {
      disposition: "attachment",
      dispositionParameters: { filename },
    },
  };
}

function watcherSettings() {
  return {
    enabled: true,
    host: "imap.example.com",
    port: 993,
    secure: true,
    user: "user@example.com",
    password: "secret",
    mailbox: "INBOX",
    fromAllowlist: ["allowed@example.com"],
    requiredFilename: "proposta",
    pollSeconds: 120,
    scanLimit: 500,
  };
}

test("email watcher initializes last_uid baseline without processing history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astebook-watcher-baseline-"));
  const previousRuntimeDir = process.env.RUNTIME_DIR;
  const previousStateFile = process.env.EMAIL_WATCHER_STATE_FILE;
  const previousIndexFile = process.env.MAILBOX_INDEX_FILE;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.RUNTIME_DIR = dir;
  process.env.EMAIL_WATCHER_STATE_FILE = join(dir, "email-watcher-state.json");
  process.env.MAILBOX_INDEX_FILE = join(dir, "mailbox-index.json");
  delete process.env.DATABASE_URL;

  try {
    const mock = createMockImapClient({ uids: [10, 11, 12] });
    const { pollMailbox } = await import(`../lib/email_watcher.js?test=${Date.now()}`);
    const result = await pollMailbox(watcherSettings(), { imapClientFactory: () => mock.client });
    const state = JSON.parse(await readFile(process.env.EMAIL_WATCHER_STATE_FILE, "utf8"));

    assert.equal(result.baselined, true);
    assert.equal(result.scanned, 0);
    assert.equal(state.last_uid, 12);
    assert.equal(typeof state.baseline_at, "string");
    assert.deepEqual(mock.fetchCalls, []);
  } finally {
    if (previousRuntimeDir === undefined) delete process.env.RUNTIME_DIR;
    else process.env.RUNTIME_DIR = previousRuntimeDir;
    if (previousStateFile === undefined) delete process.env.EMAIL_WATCHER_STATE_FILE;
    else process.env.EMAIL_WATCHER_STATE_FILE = previousStateFile;
    if (previousIndexFile === undefined) delete process.env.MAILBOX_INDEX_FILE;
    else process.env.MAILBOX_INDEX_FILE = previousIndexFile;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await rm(dir, { recursive: true, force: true });
  }
});

test("email watcher polls only UID greater than last_uid and advances past skipped mail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astebook-watcher-incremental-"));
  const stateFile = join(dir, "email-watcher-state.json");
  const indexFile = join(dir, "mailbox-index.json");
  const previousRuntimeDir = process.env.RUNTIME_DIR;
  const previousStateFile = process.env.EMAIL_WATCHER_STATE_FILE;
  const previousIndexFile = process.env.MAILBOX_INDEX_FILE;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.RUNTIME_DIR = dir;
  process.env.EMAIL_WATCHER_STATE_FILE = stateFile;
  process.env.MAILBOX_INDEX_FILE = indexFile;
  delete process.env.DATABASE_URL;

  try {
    await writeFile(stateFile, JSON.stringify({ processed: [], last_uid: 12, mailbox: "INBOX" }), "utf8");
    const mock = createMockImapClient({
      uids: [13, 14],
      messages: [
        imapMessage({ uid: 13, from: "allowed@example.com", subject: "Processabile" }),
        imapMessage({ uid: 14, from: "blocked@example.com", subject: "Scartata" }),
      ],
    });
    const { pollMailbox } = await import(`../lib/email_watcher.js?test=${Date.now()}`);
    const result = await pollMailbox(watcherSettings(), { imapClientFactory: () => mock.client });
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    const index = JSON.parse(await readFile(indexFile, "utf8"));
    const byUid = new Map(index.messages.map((message) => [message.uid, message]));

    assert.deepEqual(mock.searchCalls, [{ uid: "13:*" }]);
    assert.equal(result.scanned, 2);
    assert.equal(result.accepted, 1);
    assert.equal(result.skipped_sender, 1);
    assert.equal(state.last_uid, 14);
    assert.equal(byUid.get(13).status, "mailbox_indexed");
    assert.equal(byUid.get(13).processing_status, "mailbox_indexed");
    assert.equal(byUid.get(13).processed, false);
    assert.equal(byUid.get(14).status, "ignored");
    assert.equal(byUid.get(14).processing_status, "ignored");
    assert.equal(byUid.get(14).processed, true);
  } finally {
    if (previousRuntimeDir === undefined) delete process.env.RUNTIME_DIR;
    else process.env.RUNTIME_DIR = previousRuntimeDir;
    if (previousStateFile === undefined) delete process.env.EMAIL_WATCHER_STATE_FILE;
    else process.env.EMAIL_WATCHER_STATE_FILE = previousStateFile;
    if (previousIndexFile === undefined) delete process.env.MAILBOX_INDEX_FILE;
    else process.env.MAILBOX_INDEX_FILE = previousIndexFile;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await rm(dir, { recursive: true, force: true });
  }
});
