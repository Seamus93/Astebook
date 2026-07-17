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
