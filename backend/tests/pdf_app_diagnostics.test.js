import test from "node:test";
import assert from "node:assert/strict";
import { buildPdfAppErrorDiagnostics, buildPdfAppOcrPayload, extractPdfAppText } from "../lib/pdf_app.js";

test("PDF-app error diagnostics mask OCR input tokens", () => {
  const token = "aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb";
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
  assert.deepEqual(diagnostics.file_url_paths, ["/api/v1/ocr-inputs/aaaa***bbbb/file.pdf"]);
  assert.equal(JSON.stringify(diagnostics).includes(token), false);
  assert.equal(JSON.stringify(diagnostics).includes("pdf-key"), false);
});

test("PDF-app text extraction concatenates all OCR page results", () => {
  const payload = {
    message: "OCR completed successfully.",
    extraction_results: [
      {
        file: "https://example.test/proposta.pdf",
        result: [
          { page: 2, region_index: null, result: "Pagina due con prezzo Euro 60.000." },
          { page: 1, region_index: null, result: "Pagina uno con proponente DE CHI." },
          { page: 3, region_index: null, result: "Pagina tre con IBAN IT60X0542811101000000123456." },
        ],
      },
    ],
  };

  const text = extractPdfAppText(payload);

  assert.equal(
    text,
    [
      "Pagina uno con proponente DE CHI.",
      "Pagina due con prezzo Euro 60.000.",
      "Pagina tre con IBAN IT60X0542811101000000123456.",
    ].join("\n\n")
  );
});
