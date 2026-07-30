import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("OCR input store exposes buffered attachments through an unguessable public URL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astebook-ocr-input-"));
  const previousRuntimeDir = process.env.RUNTIME_DIR;
  const previousOcrInputDir = process.env.OCR_INPUT_DIR;
  const previousProjectUrl = process.env.PROJECT_URL;
  process.env.RUNTIME_DIR = dir;
  process.env.OCR_INPUT_DIR = join(dir, "ocr-inputs");
  process.env.PROJECT_URL = "https://astebook.example";

  try {
    const { createOcrInputFromBuffer, getOcrPublicBaseUrl, readOcrInput } =
      await import(`../lib/ocr_input_store.js?test=${Date.now()}`);
    assert.equal(await getOcrPublicBaseUrl(), "https://astebook.example");
    const input = await createOcrInputFromBuffer({
      buffer: Buffer.from("%PDF cached"),
      fileName: "Polis Proposta test.pdf",
      mimeType: "application/pdf",
    });

    assert.match(input.url, /^https:\/\/astebook\.example\/api\/v1\/ocr-inputs\/[a-f0-9]{32}\/Polis_Proposta_test\.pdf$/);
    assert.equal(input.diagnostics.ocr_url_origin, "https://astebook.example");
    assert.equal(input.diagnostics.ocr_url_path.includes(input.token), false);
    assert.match(input.diagnostics.ocr_url_path, /^\/api\/v1\/ocr-inputs\/[a-f0-9]{4}\*\*\*[a-f0-9]{4}\/Polis_Proposta_test\.pdf$/);
    assert.equal(input.diagnostics.ocr_content_type, "application/pdf");
    assert.equal(input.diagnostics.ocr_file_size, Buffer.from("%PDF cached").length);
    assert.ok(input.diagnostics.ocr_url_expires_at);

    const read = await readOcrInput({
      token: input.token,
      fileName: input.file_name,
    });
    assert.equal(read.buffer.toString("utf8"), "%PDF cached");
    assert.equal(read.mime_type, "application/pdf");
  } finally {
    if (previousRuntimeDir === undefined) delete process.env.RUNTIME_DIR;
    else process.env.RUNTIME_DIR = previousRuntimeDir;
    if (previousOcrInputDir === undefined) delete process.env.OCR_INPUT_DIR;
    else process.env.OCR_INPUT_DIR = previousOcrInputDir;
    if (previousProjectUrl === undefined) delete process.env.PROJECT_URL;
    else process.env.PROJECT_URL = previousProjectUrl;
    await rm(dir, { recursive: true, force: true });
  }
});
