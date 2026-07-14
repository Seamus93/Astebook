import assert from "node:assert/strict";
import { test } from "node:test";

import { attachmentFilenameMatchesRequired } from "../lib/email_watcher.js";

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
