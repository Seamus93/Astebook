import test from "node:test";
import assert from "node:assert/strict";
import { buildPdfAppErrorDiagnostics, buildPdfAppOcrPayload } from "../lib/pdf_app.js";

test("PDF-app error diagnostics mask OCR input tokens", () => {
  const token = "1234567890abcdef1234567890abcdef";
  const requestBody = buildPdfAppOcrPayload(
    `http://31.220.76.233:3000/api/v1/ocr-inputs/${token}/file.pdf`
  );

  const diagnostics = buildPdfAppErrorDiagnostics({
    endpoint: "https://api.pdf-app.net/ocr",
    requestBody,
    response: { status: 403 },
    responsePayload: { text: "Forbidden" },
  });

  assert.equal(diagnostics.status, 403);
  assert.equal(diagnostics.endpoint, "https://api.pdf-app.net/ocr");
  assert.deepEqual(diagnostics.file_url_origins, ["http://31.220.76.233:3000"]);
  assert.deepEqual(diagnostics.file_url_schemes, ["http"]);
  assert.deepEqual(diagnostics.file_url_ports, ["3000"]);
  assert.deepEqual(diagnostics.file_url_paths, ["/api/v1/ocr-inputs/1234***cdef/file.pdf"]);
  assert.equal(JSON.stringify(diagnostics).includes(token), false);
  assert.equal(JSON.stringify(diagnostics).includes("pdf-key"), false);
});
