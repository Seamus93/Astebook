import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { selfTestOcrInputUrl } from "../lib/ocr_input_self_test.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("OCR input self-test reports PDF response diagnostics", async () => {
  const body = Buffer.from("%PDF-1.7 test");
  const server = createServer((req, res) => {
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-length": String(body.length),
    });
    res.end(body);
  });

  const address = await listen(server);
  try {
    const result = await selfTestOcrInputUrl({
      url: `http://127.0.0.1:${address.port}/api/v1/ocr-inputs/1234567890abcdef1234567890abcdef/file.pdf`,
      expectedContentType: "application/pdf",
    });

    assert.equal(result.status, 200);
    assert.equal(result.content_type, "application/pdf");
    assert.equal(result.content_length, String(body.length));
    assert.equal(result.redirected, false);
    assert.equal(result.pdf_header_valid, true);
    assert.equal(result.error, null);
    assert.equal(typeof result.duration_ms, "number");
  } finally {
    await close(server);
  }
});
