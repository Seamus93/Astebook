import assert from "node:assert/strict";
import { test } from "node:test";

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
    state: { processed: [], ignore_before: "2026-07-14T00:00:00.000Z" },
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
    state: { processed: [], ignore_before: "2026-07-14T00:00:00.000Z" },
    messageKey: "mail-3",
  });

  assert.equal(decision.processable, false);
  assert.deepEqual(decision.reasons, [
    "before_baseline",
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
