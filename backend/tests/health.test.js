import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runtimeDir = await mkdtemp(join(tmpdir(), "astebook-test-"));
process.env.RUNTIME_DIR = runtimeDir;
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-password";
process.env.ADMIN_SESSION_SECRET = "test-session-secret";
process.env.PROCESSING_UI_TOKEN = "test-ui-token";
process.env.ZAPIER_WEBHOOK_TOKEN = "test-webhook-token";
const { app, mergeExtractedProposta } = await import("../server.js");
const { scrapeProvvigionePercentuale } = await import("../scrapers/scrape_provvigione.js");

test.after(async () => {
  await rm(runtimeDir, { recursive: true, force: true });
});

test("GET /health returns the standard health payload", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.status, "ok");
    assert.equal(payload.service, "astebook-api");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("Zapier intake creates a processing event visible from the UI API", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    const localFileUrl = `http://127.0.0.1:${port}/health`;
    const intakeResponse = await fetch(`http://127.0.0.1:${port}/api/v1/zapier/email-activation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-astebook-webhook-token": "test-webhook-token",
      },
      body: JSON.stringify({
        subject: "Fwd: RM_Roma_TOL_202949480010 PROCEDURA COMPETITIVA",
        from: "cliente@example.com",
        email_body_text:
          "<div>Appartamento all'asta Via Roma 1, Roma</div><div>Offerta minima: € 210.000,00</div>",
        zap_run_id: "zap-test-1",
        all_attachments: localFileUrl,
        attachment_1_attachment: `${localFileUrl}?attachment=1`,
        attachment_1_truncateFilename: "Proposta.docx",
        attachment_1_mime_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    });
    const intakePayload = await intakeResponse.json();

    assert.equal(intakeResponse.status, 202);
    assert.equal(intakePayload.ok, true);
    assert.ok(intakePayload.event_id);
    assert.equal(intakePayload.result.ready_for_zapier, false);
    assert.equal(intakePayload.result.email.has_body_text, true);
    assert.equal(intakePayload.result.extracted.annuncio.indirizzo, "Via Roma, 1, Roma");
    assert.equal(intakePayload.result.extracted.annuncio.offerta_minima, 210000);
    assert.equal(intakePayload.result.attachments.length, 2);
    assert.equal(intakePayload.result.codice_pratica, "RM_ROMA_TOL_202949480010");

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/v1/processing-events`, {
      headers: { "x-astebook-token": "test-ui-token" },
    });
    const listPayload = await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(listPayload.events.length, 1);
    assert.equal(listPayload.events[0].status, "received");
    assert.equal(listPayload.events[0].has_result, true);

    const detailResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/processing-events/${intakePayload.event_id}`,
      {
        headers: { "x-astebook-token": "test-ui-token" },
      }
    );
    const detailPayload = await detailResponse.json();

    assert.equal(detailPayload.event.result.mode, "ai_extraction_pipeline");
    assert.ok(
      detailPayload.event.result.attachments.some(
        (attachment) => attachment.file_name === "Proposta.docx"
      )
    );

    const documentResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/processing-events/${intakePayload.event_id}/document?format=pdf`,
      {
        headers: { "x-astebook-token": "test-ui-token" },
      }
    );
    const documentBytes = Buffer.from(await documentResponse.arrayBuffer());

    assert.equal(documentResponse.status, 200);
    assert.equal(documentResponse.headers.get("content-type"), "application/pdf");
    assert.equal(documentBytes.subarray(0, 4).toString("utf8"), "%PDF");

    const docxResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/processing-events/${intakePayload.event_id}/document?format=docx`,
      {
        headers: { "x-astebook-token": "test-ui-token" },
      }
    );
    const docxPayload = await docxResponse.json();

    assert.equal(docxResponse.status, 400);
    assert.equal(docxPayload.error, "DOCUMENT_TEMPLATE_URL non configurato.");

    const reprocessResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/processing-events/${intakePayload.event_id}/reprocess`,
      {
        method: "POST",
        headers: { "x-astebook-token": "test-ui-token" },
      }
    );
    const reprocessPayload = await reprocessResponse.json();

    assert.equal(reprocessResponse.status, 200);
    assert.equal(reprocessPayload.result.codice_pratica, "RM_ROMA_TOL_202949480010");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("Admin UI requires login before serving the processing interface", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/admin/`, {
      redirect: "manual",
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/login");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("proposal merge prefers OCR PDF values over DOCX values", () => {
  const merged = mergeExtractedProposta(
    {
      file_pdf: "Modello proposta.docx",
      source_format: "docx",
      proponente: { nominativo: "Mario Rossi", cellulare: "-" },
      indirizzo_immobile: "Via V. Alfieri 1",
      iban_beneficiario: "IT00DOCX",
      catasto: { foglio: "-", particella: "-", subalterno: "-" },
      raw_length: 100,
    },
    {
      file_pdf: "Proposta firmata.pdf",
      source_format: "pdf",
      proponente: { nominativo: "-", cellulare: "3208183295" },
      indirizzo_immobile: "Via Leonardo Da Vinci 48",
      iban_beneficiario: "-",
      catasto: { foglio: "463", particella: "174", subalterno: "733" },
      raw_length: 80,
    }
  );

  assert.equal(merged.file_pdf, "Proposta firmata.pdf");
  assert.equal(merged.indirizzo_immobile, "Via Leonardo Da Vinci 48");
  assert.equal(merged.iban_beneficiario, "IT00DOCX");
  assert.equal(merged.proponente.nominativo, "Mario Rossi");
  assert.equal(merged.proponente.cellulare, "3208183295");
  assert.equal(merged.catasto.foglio, "463");
  assert.deepEqual(merged.source_files, ["Modello proposta.docx", "Proposta firmata.pdf"]);
});

test("Admin login can read and update runtime settings", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    const loginResponse = await fetch(`http://127.0.0.1:${port}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: "admin",
        password: "test-password",
      }),
      redirect: "manual",
    });

    assert.equal(loginResponse.status, 302);
    const cookie = loginResponse.headers.get("set-cookie");
    assert.match(cookie, /astebook_admin=/);

    const settingsResponse = await fetch(`http://127.0.0.1:${port}/api/v1/admin/settings`, {
      headers: { cookie },
    });
    const settingsPayload = await settingsResponse.json();

    assert.equal(settingsResponse.status, 200);
    assert.equal(settingsPayload.ok, true);
    assert.equal(settingsPayload.admin.username, "admin");
    assert.equal(settingsPayload.settings.processing_ui_token, "test...oken");

    const adminUiResponse = await fetch(`http://127.0.0.1:${port}/admin/`, {
      headers: { cookie },
    });
    const adminUiHtml = await adminUiResponse.text();

    assert.equal(adminUiResponse.status, 200);
    assert.match(adminUiHtml, /Astebook Processing/);

    const oldLoginResponse = await fetch(`http://127.0.0.1:${port}/admin/login`, {
      redirect: "manual",
    });
    assert.equal(oldLoginResponse.status, 302);
    assert.equal(oldLoginResponse.headers.get("location"), "/login");

    const recoveryResponse = await fetch(`http://127.0.0.1:${port}/recover-login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        email: "admin@example.com",
      }),
    });
    const recoveryHtml = await recoveryResponse.text();
    assert.equal(recoveryResponse.status, 200);
    assert.match(recoveryHtml, /SMTP non configurato/);
    assert.match(recoveryHtml, /test-password/);

    const revealResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/admin/settings?reveal=1`,
      {
        headers: { cookie },
      }
    );
    const revealPayload = await revealResponse.json();

    assert.equal(revealResponse.status, 200);
    assert.equal(revealPayload.settings.processing_ui_token, "test-ui-token");

    const updateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/admin/settings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        processing_ui_token: "runtime-ui-token",
        zapier_webhook_token: "runtime-webhook-token",
      }),
    });
    const updatePayload = await updateResponse.json();

    assert.equal(updateResponse.status, 200);
    assert.equal(updatePayload.ok, true);

    const templateUrl = "https://docs.google.com/document/d/template-id/edit";
    const templateUpdateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/admin/settings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        document_template_url: templateUrl,
      }),
    });
    assert.equal(templateUpdateResponse.status, 200);

    const ocrUpdateResponse = await fetch(`http://127.0.0.1:${port}/api/v1/admin/settings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        pdf_app_ocr_endpoint: "https://api.pdf-app.net/ocr",
        document_template_url: "",
      }),
    });
    assert.equal(ocrUpdateResponse.status, 200);

    const updatedSettingsResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/admin/settings?reveal=1`,
      {
        headers: { cookie },
      }
    );
    const updatedSettingsPayload = await updatedSettingsResponse.json();

    assert.equal(updatedSettingsPayload.settings.document_template_url, templateUrl);
    assert.equal(updatedSettingsPayload.settings.pdf_app_ocr_endpoint, "https://api.pdf-app.net/ocr");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("DOCX generation returns a clear error when template download is not a DOCX", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    process.env.DOCUMENT_TEMPLATE_URL = `http://127.0.0.1:${port}/health`;

    const intakeResponse = await fetch(`http://127.0.0.1:${port}/api/v1/zapier/email-activation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-astebook-webhook-token": "test-webhook-token",
      },
      body: JSON.stringify({
        subject: "Fwd: RM_Roma_TOL_202949480010 PROCEDURA COMPETITIVA",
        email_body_text: "Corpo della mail",
      }),
    });
    const intakePayload = await intakeResponse.json();
    assert.equal(intakeResponse.status, 202);

    const docxResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/processing-events/${intakePayload.event_id}/document?format=docx`,
      {
        headers: { "x-astebook-token": "test-ui-token" },
      }
    );
    const docxPayload = await docxResponse.json();

    assert.equal(docxResponse.status, 500);
    assert.equal(docxPayload.error, "Generazione DOCX fallita.");
    assert.match(docxPayload.detail, /non e un DOCX valido/);
  } finally {
    delete process.env.DOCUMENT_TEMPLATE_URL;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("provvigione percentage is extracted near commission labels", () => {
  assert.equal(
    scrapeProvvigionePercentuale("Costo di mediazione dovuto a I-RESALES nella misura pari al 4%"),
    4
  );
  assert.equal(scrapeProvvigionePercentuale("Riferimento catastale foglio 463 sub 733"), null);
});
