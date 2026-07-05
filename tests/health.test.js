import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runtimeDir = await mkdtemp(join(tmpdir(), "astebook-test-"));
process.env.RUNTIME_DIR = runtimeDir;
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
      headers: { "content-type": "application/json" },
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

    const listResponse = await fetch(`http://127.0.0.1:${port}/api/v1/processing-events`);
    const listPayload = await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(listPayload.events.length, 1);
    assert.equal(listPayload.events[0].status, "received");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
