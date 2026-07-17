import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

import { createAiExtractionPipeline } from "./lib/extraction_pipeline.js";
import {
  appendExtractionFeedback,
  buildExtractionFeedbackContext,
  listExtractionFeedback,
  summarizeExtractionFeedback,
} from "./lib/extraction_feedback.js";
import { createAdminAuth } from "./routes/admin_auth.js";
import { registerAdminSettingsRoutes } from "./routes/admin_settings.js";
import { registerCallAiRoute } from "./routes/call_ai.js";
import { createEmailIntakeHandlers, registerEmailIntakeRoutes } from "./routes/email_intake.js";
import { registerProcessingEventRoutes } from "./routes/processing_events.js";
import { buildDocumentDocx, buildDocumentPdf } from "./lib/document_builder.js";
import { createDocumentEmailService } from "./lib/document_email.js";
import {
  createEmailWatcher,
  forgetEmailWatcherMessageState,
  resetEmailWatcherState,
  setEmailWatcherIgnoreBefore,
} from "./lib/email_watcher.js";
import { listMailboxMessages, processMailboxMessage, syncMailboxMessages } from "./lib/mailbox_browser.js";
import {
  createSmtpTransporter as createSmtpTransporterWithSettings,
  getSmtpSettings as getSmtpSettingsWithSettings,
  hasSmtpConfig as hasSmtpConfigWithSettings,
  sendRecoveryEmail as sendRecoveryEmailWithSettings,
} from "./lib/smtp.js";
import {
  collectDocumentEmailConfigurationIssues as collectDocumentEmailConfigurationIssuesWithDeps,
  collectPipelineConfigurationIssues as collectPipelineConfigurationIssuesWithDeps,
} from "./lib/settings_validation.js";
import {
  createProcessingEvent,
  deleteProcessingEvent,
  findProcessingEventByExternalEmailId,
  getProcessingEvent,
  listProcessingEvents,
  updateProcessingEvent,
} from "./lib/processing_log.js";
import {
  createRuntimeAdmin,
  getEffectiveSetting,
  getRuntimeAdminPlainPassword,
  getRuntimeAdminUsername,
  getRuntimeSettings,
  hasRuntimeAdmin,
  updateRuntimeSettings,
  verifyRuntimeAdmin,
} from "./lib/app_config.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: false }));

const mediaDir = join(process.cwd(), "frontend", "media");
const astebookLogoPath = join(mediaDir, "astebook-logo.png");
const iresalesLogoPath = join(mediaDir, "iresales-logo.png");

const documentEmailService = createDocumentEmailService({
  buildDocumentDocx,
  buildDocumentPdf,
  createSmtpTransporter,
  getEffectiveSetting,
  getProcessingEvent,
  getSmtpSettings,
  hasSmtpConfig,
  logoPaths: { astebookLogoPath, iresalesLogoPath },
  updateProcessingEvent,
});

async function getSmtpSettings() {
  return getSmtpSettingsWithSettings(getEffectiveSetting);
}

async function hasSmtpConfig() {
  return hasSmtpConfigWithSettings(getEffectiveSetting);
}

async function createSmtpTransporter() {
  return createSmtpTransporterWithSettings(getEffectiveSetting);
}

async function sendRecoveryEmail({ to, credentials }) {
  return sendRecoveryEmailWithSettings({ to, credentials, getEffectiveSetting });
}

const adminAuth = createAdminAuth({
  createRuntimeAdmin,
  getEffectiveSetting,
  getRuntimeAdminPlainPassword,
  getRuntimeAdminUsername,
  hasRuntimeAdmin,
  sendRecoveryEmail,
  verifyRuntimeAdmin,
});
const {
  createAdminSession,
  getAdminLoginUsername,
  requireAdminSession,
  setAdminSessionCookie,
  verifyAdminSession,
} = adminAuth;

adminAuth.registerAdminAuthRoutes(app);

const reactAdminDir = join(process.cwd(), "frontend", "dist");
if (!existsSync(join(reactAdminDir, "index.html"))) {
  console.warn("React admin build not found at frontend/dist; please run 'npm run build' in the frontend folder before deploying.");
}
app.use("/admin", requireAdminSession, express.static(reactAdminDir));
// SPA fallback: serve index.html for any admin route (lets React Router handle client-side routing)
app.get("/admin/*", requireAdminSession, (_req, res) => {
  res.sendFile(join(reactAdminDir, "index.html"));
});

async function collectPipelineConfigurationIssues() {
  return collectPipelineConfigurationIssuesWithDeps({
    getEffectiveSetting,
    getSmtpSettings,
  });
}

async function collectDocumentEmailConfigurationIssues(recipients) {
  return collectDocumentEmailConfigurationIssuesWithDeps({
    recipients,
    getEffectiveSetting,
    getSmtpSettings,
  });
}

async function sendDocumentEmailForEvent(event, recipients) {
  return documentEmailService.sendDocumentEmailForEvent(event, recipients);
}

async function autoSendMergedDocumentEmail(eventId) {
  return documentEmailService.autoSendMergedDocumentEmail(eventId);
}

registerAdminSettingsRoutes(app, {
  createAdminSession,
  getAdminLoginUsername,
  getRuntimeSettings,
  requireAdminSession,
  setAdminSessionCookie,
  updateRuntimeSettings,
});

function requireToken(expectedToken, headerName) {
  return async (req, res, next) => {
    if (await verifyAdminSession(req)) {
      next();
      return;
    }

    const token = typeof expectedToken === "function" ? await expectedToken() : expectedToken;
    if (!token) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const providedToken = req.get(headerName) || req.query.token;
    if (providedToken === token) {
      next();
      return;
    }

    res.status(401).json({ ok: false, error: "Unauthorized" });
  };
}

const requireProcessingUiToken = requireToken(
  () => getEffectiveSetting("PROCESSING_UI_TOKEN", "processing_ui_token"),
  "x-astebook-token"
);
const requireZapierWebhookToken = requireToken(
  () => getEffectiveSetting("ZAPIER_WEBHOOK_TOKEN", "zapier_webhook_token"),
  "x-astebook-webhook-token"
);

// Upload in memoria; accetta qualsiasi field (Zapier può chiamarlo diversamente)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
}).any();

app.get("/health", (_req, res) =>
  res.json({
    status: "ok",
    service: "astebook-api",
    version: process.env.npm_package_version || "0.0.0",
  })
);

const runAiExtractionPipeline = createAiExtractionPipeline({
  autoSendMergedDocumentEmail,
  getProcessingEvent,
  updateProcessingEvent,
});

const emailIntakeHandlers = createEmailIntakeHandlers({
  createProcessingEvent,
  findProcessingEventByExternalEmailId,
  getProcessingEvent,
  runAiExtractionPipeline,
  updateProcessingEvent,
});
const { processEmailWatcherActivation } = emailIntakeHandlers;
let emailWatcher = null;
let mailboxSyncRunning = false;
let mailboxSyncStatus = {
  running: false,
  last_started_at: null,
  last_finished_at: null,
  last_error: null,
  last_result: null,
};

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function emailWatcherStartDelaySeconds() {
  return positiveInt(process.env.EMAIL_WATCHER_START_DELAY_SECONDS, 30);
}

function startEmailWatcherAfterDelay(reason = "scheduled") {
  if (!emailWatcher) return;
  const delaySeconds = emailWatcherStartDelaySeconds();
  console.log(`[email_watcher] ${reason}; starting in ${delaySeconds}s`);
  emailWatcher.start({ delaySeconds });
}

registerEmailIntakeRoutes(app, {
  handleZapierEmailActivation: emailIntakeHandlers.handleZapierEmailActivation,
  requireZapierWebhookToken,
  upload,
});

registerProcessingEventRoutes(app, {
  appendExtractionFeedback,
  buildExtractionFeedbackContext,
  collectDocumentEmailConfigurationIssues,
  collectPipelineConfigurationIssues,
  deleteProcessingEvent,
  getEffectiveSetting,
  getProcessingEvent,
  listExtractionFeedback,
  listProcessingEvents,
  requireProcessingUiToken,
  runAiExtractionPipeline,
  sendDocumentEmailForEvent,
  summarizeExtractionFeedback,
  updateProcessingEvent,
});

registerCallAiRoute(app, {
  createProcessingEvent,
  runAiExtractionPipeline,
  updateProcessingEvent,
  upload,
});

app.post("/api/v1/admin/email-watcher/scan", requireAdminSession, async (_req, res) => {
  if (!emailWatcher) {
    res.status(503).json({ ok: false, error: "Email watcher non avviato." });
    return;
  }
  const result = await emailWatcher.scanNow();
  const status = result.ok === false && result.busy ? 409 : result.ok === false ? 500 : 200;
  res.status(status).json(result);
});

app.post("/api/v1/admin/email-watcher/state/reset", requireAdminSession, async (_req, res) => {
  const result = await resetEmailWatcherState();
  res.json({ ok: true, ...result });
});

app.post("/api/v1/admin/email-watcher/state/ignore-before", requireAdminSession, async (req, res) => {
  try {
    const result = await setEmailWatcherIgnoreBefore(req.body?.ignore_before);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || String(error) });
  }
});

app.post("/api/v1/admin/email-watcher/state/ignore-before-now", requireAdminSession, async (_req, res) => {
  try {
    const result = await setEmailWatcherIgnoreBefore();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || String(error) });
  }
});

async function handleMailboxMessages(req, res) {
  try {
    const result = await listMailboxMessages({
      getSettings: getRuntimeSettings,
      findProcessingEventByExternalEmailId,
      from: req.query.from,
      includeAllSenders: req.query.include_all_senders === "1" || req.query.include_all_senders === "true",
      limit: Number.parseInt(String(req.query.limit || "50"), 10) || 50,
      query: req.query.q || "",
    });
    res.status(result.ok === false ? 503 : 200).json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error), messages: [] });
  }
}

app.get("/api/v1/admin/mailbox/messages", requireAdminSession, handleMailboxMessages);
app.get("/api/v1/admin/email-watcher/messages", requireAdminSession, handleMailboxMessages);

function startMailboxSync({ from, includeAllSenders = true, limit = 30, query = "" } = {}) {
  if (mailboxSyncRunning) {
    return { ok: true, started: false, busy: true, sync: mailboxSyncStatus };
  }

  emailWatcher?.stop();

  mailboxSyncRunning = true;
  mailboxSyncStatus = {
    ...mailboxSyncStatus,
    running: true,
    last_started_at: new Date().toISOString(),
    last_finished_at: null,
    last_error: null,
  };

  syncMailboxMessages({
    getSettings: getRuntimeSettings,
    findProcessingEventByExternalEmailId,
    from,
    includeAllSenders,
    limit,
    query,
  })
    .then((result) => {
      mailboxSyncStatus = {
        ...mailboxSyncStatus,
        running: false,
        last_finished_at: new Date().toISOString(),
        last_error: result.ok === false ? result.error || result.disabled_reason || "Sync non completata" : null,
        last_result: {
          ok: result.ok !== false,
          scanned: result.scanned || 0,
          count: Array.isArray(result.messages) ? result.messages.length : 0,
          mailbox: result.mailbox || null,
        },
      };
    })
    .catch((error) => {
      mailboxSyncStatus = {
        ...mailboxSyncStatus,
        running: false,
        last_finished_at: new Date().toISOString(),
        last_error: error.message || String(error),
      };
      console.warn("[mailbox_sync] background sync failed", error);
    })
    .finally(() => {
      mailboxSyncRunning = false;
      mailboxSyncStatus = { ...mailboxSyncStatus, running: false };
      startEmailWatcherAfterDelay("mailbox sync finished");
    });

  return { ok: true, started: true, busy: false, sync: mailboxSyncStatus };
}

app.post("/api/v1/admin/mailbox/sync", requireAdminSession, (req, res) => {
  const result = startMailboxSync({
    from: req.body?.from,
    includeAllSenders: req.body?.include_all_senders !== false,
    limit: Number.parseInt(String(req.body?.limit || "30"), 10) || 30,
    query: req.body?.q || "",
  });
  res.status(202).json(result);
});

app.get("/api/v1/admin/mailbox/sync/status", requireAdminSession, (_req, res) => {
  res.json({ ok: true, sync: mailboxSyncStatus });
});

app.post("/api/v1/admin/mailbox/messages/process", requireAdminSession, async (req, res) => {
  try {
    const result = await processMailboxMessage({
      getSettings: getRuntimeSettings,
      findProcessingEventByExternalEmailId,
      onAcceptedMail: processEmailWatcherActivation,
      uid: req.body?.uid,
      messageId: req.body?.message_id,
      force: true,
    });
    res.status(result.ok === false ? 400 : 202).json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.post("/api/v1/admin/email-watcher/state/forget", requireAdminSession, async (req, res) => {
  try {
    const result = await forgetEmailWatcherMessageState(req.body?.message_id);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || String(error) });
  }
});

export function startServer(port = process.env.PORT || 3000) {
  const server = app.listen(port, () => console.log(`Server up on http://localhost:${port}`));
  emailWatcher = createEmailWatcher({
    getSettings: getRuntimeSettings,
    onAcceptedMail: processEmailWatcherActivation,
  });
  startEmailWatcherAfterDelay("server started");
  server.on("close", () => {
    emailWatcher?.stop();
    emailWatcher = null;
  });
  return server;
}

export { app };
export { mergeExtractedProposta, normalizeEmailTextForExtraction } from "./lib/extraction_result.js";

const executedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (executedUrl === import.meta.url) {
  startServer();
}
