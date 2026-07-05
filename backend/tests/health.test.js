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
const { app } = await import("../server.js");

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
    const intakeResponse = await fetch(`http://127.0.0.1:${port}/api/v1/zapier/email-activation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-astebook-webhook-token": "test-webhook-token",
      },
      body: JSON.stringify({
        subject: "Test activation",
        from: "cliente@example.com",
        email_body_text: "Corpo della mail",
        zap_run_id: "zap-test-1",
      }),
    });
    const intakePayload = await intakeResponse.json();

    assert.equal(intakeResponse.status, 202);
    assert.equal(intakePayload.ok, true);
    assert.ok(intakePayload.event_id);
    assert.equal(intakePayload.result.ready_for_zapier, false);
    assert.equal(intakePayload.result.email.has_body_text, true);

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

    assert.equal(detailPayload.event.result.mode, "zapier_scraper_preview");
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
    assert.equal(response.headers.get("location"), "/admin/login");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("Admin login can read and update runtime settings", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    const loginResponse = await fetch(`http://127.0.0.1:${port}/admin/login`, {
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
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
