import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";

import { mergeAnnuncioProposta } from "./lib/merge_json.js";
import { aiExtractAnnuncio, aiExtractProposta, aiExtractProvvigionePercentuale } from "./lib/ai.js";
import { parseDocxBuffer } from "./lib/docx.js";
import { buildDocumentDocx, buildDocumentHtml, buildDocumentPdf, buildDocumentText } from "./lib/document_builder.js";
import { parsePdfBuffer } from "./lib/pdf.js";
import { ocrFileUrlWithPdfApp } from "./lib/pdf_app.js";
import { scrapeAnnuncioFromText } from "./scrapers/scrape_annuncio.js";
import { scrapeProvvigionePercentuale } from "./scrapers/scrape_provvigione.js";
import {
  resolveCodicePraticaFromPayload,
  scrapeCodicePraticaFromText,
} from "./scrapers/scrape_annuncio/scrape_codice_pratica.js";
import { scrapePropostaFromText } from "./scrapers/scrape_proposta.js";
import {
  createProcessingEvent,
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

const adminCookieName = "astebook_admin";

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, item) => {
      const separatorIndex = item.indexOf("=");
      if (separatorIndex === -1) return cookies;
      const key = decodeURIComponent(item.slice(0, separatorIndex));
      const value = decodeURIComponent(item.slice(separatorIndex + 1));
      cookies[key] = value;
      return cookies;
    }, {});
}

async function getAdminSessionSecret() {
  return (
    process.env.ADMIN_SESSION_SECRET ||
    process.env.PROCESSING_UI_TOKEN ||
    process.env.ADMIN_PASSWORD ||
    (await getEffectiveSetting("ADMIN_SESSION_SECRET", "admin_session_secret"))
  );
}

async function hasConfiguredAdmin() {
  return Boolean(process.env.ADMIN_PASSWORD) || (await hasRuntimeAdmin());
}

async function getAdminLoginUsername() {
  return process.env.ADMIN_USERNAME || (await getRuntimeAdminUsername()) || "admin";
}

async function getAdminRecoveryCredentials() {
  return {
    username: await getAdminLoginUsername(),
    password: process.env.ADMIN_PASSWORD || (await getRuntimeAdminPlainPassword()) || null,
  };
}

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

async function sendRecoveryEmail({ to, credentials }) {
  if (!hasSmtpConfig()) return false;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD || "",
        }
      : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Credenziali Astebook",
    text: [
      "Credenziali di accesso Astebook:",
      "",
      `URL: ${process.env.PUBLIC_BASE_URL || "/login"}`,
      `Utente: ${credentials.username}`,
      `Password: ${credentials.password || "Non recuperabile: reimpostala dalla console admin."}`,
    ].join("\n"),
  });
  return true;
}

async function signAdminSession(username, expiresAt) {
  const secret = await getAdminSessionSecret();
  if (!secret) return "";
  return createHmac("sha256", secret)
    .update(`${username}.${expiresAt}`)
    .digest("hex");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function createAdminSession(username) {
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const signature = await signAdminSession(username, expiresAt);
  return Buffer.from(`${username}.${expiresAt}.${signature}`).toString("base64url");
}

function setAdminSessionCookie(res, session) {
  const secureFlag = process.env.ADMIN_COOKIE_SECURE === "true" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${adminCookieName}=${encodeURIComponent(session)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secureFlag}`
  );
}

async function verifyAdminSession(req) {
  if (!(await hasConfiguredAdmin()) || !(await getAdminSessionSecret())) return false;

  const cookies = parseCookies(req.get("cookie"));
  const rawSession = cookies[adminCookieName];
  if (!rawSession) return false;

  try {
    const decoded = Buffer.from(rawSession, "base64url").toString("utf8");
    const [username, expiresAt, signature] = decoded.split(".");
    if (!username || !expiresAt || !signature) return false;
    if (username !== (await getAdminLoginUsername())) return false;
    if (Number(expiresAt) < Date.now()) return false;
    return safeEqual(signature, await signAdminSession(username, expiresAt));
  } catch {
    return false;
  }
}

async function verifyAdminCredentials(username, password) {
  if (process.env.ADMIN_PASSWORD) {
    return username === (process.env.ADMIN_USERNAME || "admin") && safeEqual(password, process.env.ADMIN_PASSWORD);
  }
  return verifyRuntimeAdmin({ username, password });
}

function adminLoginPage({ errorMessage = "", infoMessage = "", mode = "login", username = "", recovery = null } = {}) {
  const errorHtml = errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : "";
  const infoHtml = infoMessage ? `<p class="info">${escapeHtml(infoMessage)}</p>` : "";
  const isSetup = mode === "setup";
  const recoveryHtml = recovery
    ? `<div class="recovery-result">
        <strong>Credenziali</strong>
        <span>Utente: ${escapeHtml(recovery.username)}</span>
        <span>Password: ${escapeHtml(recovery.password || "Non recuperabile: reimpostala dalla console admin.")}</span>
      </div>`
    : "";
  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Astebook Login</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7f9; color: #17202a; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      form { width: min(420px, calc(100vw - 32px)); background: white; border: 1px solid #d9dee7; border-radius: 8px; padding: 24px; box-shadow: 0 12px 30px rgba(23,32,42,.08); }
      h1 { margin: 0 0 18px; font-size: 24px; }
      label { display: block; margin: 14px 0 6px; font-weight: 700; }
      input { width: 100%; box-sizing: border-box; border: 1px solid #c9d1dd; border-radius: 6px; padding: 11px 12px; font: inherit; }
      button { width: 100%; border: 0; border-radius: 6px; padding: 12px; margin-top: 18px; background: #17202a; color: white; font-weight: 800; cursor: pointer; }
      button.secondary { background: white; color: #17202a; border: 1px solid #c9d1dd; }
      .error { color: #b42318; margin: 0 0 12px; }
      .info { color: #146c94; margin: 0 0 12px; }
      .hint { color: #647084; font-size: 13px; margin: 14px 0 0; }
      details { margin-top: 18px; border-top: 1px solid #e4e8ef; padding-top: 14px; }
      summary { cursor: pointer; font-weight: 700; }
      .recovery-result { display: grid; gap: 6px; margin-top: 14px; padding: 12px; border: 1px solid #c9d1dd; border-radius: 6px; background: #f9fafc; }
    </style>
  </head>
  <body>
    <form method="post" action="${isSetup ? "/setup" : "/login"}">
      <h1>${isSetup ? "Crea admin Astebook" : "Astebook"}</h1>
      ${errorHtml}
      ${infoHtml}
      <label for="username">Utente</label>
      <input id="username" name="username" autocomplete="username" value="${escapeHtml(username)}" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus />
      <button type="submit">${isSetup ? "Crea admin" : "Entra"}</button>
      <p class="hint">${isSetup ? "Il primo utente diventa admin e viene autenticato automaticamente." : "Accesso alla UI processing e ai log operativi."}</p>
      ${
        isSetup
          ? ""
          : `<details>
              <summary>Utente o Password dimenticata?</summary>
              <label for="recoveryEmail">Email</label>
              <input id="recoveryEmail" name="email" type="email" form="recoveryForm" placeholder="nome@example.com" />
              <button class="secondary" type="submit" form="recoveryForm">Invia credenziali</button>
              ${recoveryHtml}
            </details>`
      }
    </form>
    <form id="recoveryForm" method="post" action="/recover-login"></form>
  </body>
</html>`;
}

async function requireAdminSession(req, res, next) {
  if (await verifyAdminSession(req)) {
    next();
    return;
  }

  if (!(await hasConfiguredAdmin())) {
    res.redirect("/setup");
    return;
  }

  res.redirect("/login");
}

app.get("/admin/setup", (_req, res) => res.redirect("/setup"));
app.post("/admin/setup", (_req, res) => res.redirect(307, "/setup"));
app.get("/setup", async (_req, res) => {
  if (await hasConfiguredAdmin()) {
    res.redirect("/login");
    return;
  }
  res.type("html").send(adminLoginPage({ mode: "setup", username: "admin" }));
});

app.post("/setup", async (req, res) => {
  if (await hasConfiguredAdmin()) {
    res.redirect("/login");
    return;
  }

  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  try {
    await createRuntimeAdmin({ username, password });
    const session = await createAdminSession(username);
    setAdminSessionCookie(res, session);
    res.redirect("/admin/");
  } catch (error) {
    res.status(400).type("html").send(
      adminLoginPage({
        mode: "setup",
        username: username || "admin",
        errorMessage: error.message || String(error),
      })
    );
  }
});

app.get("/admin/login", (_req, res) => res.redirect("/login"));
app.post("/admin/login", (_req, res) => res.redirect(307, "/login"));
app.get("/login", async (_req, res) => {
  if (!(await hasConfiguredAdmin())) {
    res.redirect("/setup");
    return;
  }
  res.type("html").send(adminLoginPage({ username: await getAdminLoginUsername() }));
});

app.post("/login", async (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");

  if (await verifyAdminCredentials(username, password)) {
    const session = await createAdminSession(username);
    setAdminSessionCookie(res, session);
    res.redirect("/admin/");
    return;
  }

  res.status(401).type("html").send(
    adminLoginPage({
      username: username || (await getAdminLoginUsername()),
      errorMessage: "Credenziali non valide.",
    })
  );
});

app.post("/recover-login", async (req, res) => {
  if (!(await hasConfiguredAdmin())) {
    res.redirect("/setup");
    return;
  }

  const email = String(req.body.email || "").trim();
  const credentials = await getAdminRecoveryCredentials();
  if (!email) {
    res.status(400).type("html").send(
      adminLoginPage({
        username: credentials.username,
        errorMessage: "Inserisci una email per il recupero.",
      })
    );
    return;
  }

  try {
    const sent = await sendRecoveryEmail({ to: email, credentials });
    res.type("html").send(
      adminLoginPage({
        username: credentials.username,
        infoMessage: sent
          ? `Credenziali inviate a ${email}.`
          : "SMTP non configurato: credenziali mostrate qui sotto.",
        recovery: sent ? null : credentials,
      })
    );
  } catch (error) {
    res.status(500).type("html").send(
      adminLoginPage({
        username: credentials.username,
        errorMessage: `Invio email non riuscito: ${error.message || String(error)}`,
        recovery: credentials,
      })
    );
  }
});

function clearAdminSession(res) {
  res.setHeader(
    "Set-Cookie",
    `${adminCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
  res.redirect("/login");
}

app.get("/logout", (_req, res) => clearAdminSession(res));
app.post("/logout", (_req, res) => clearAdminSession(res));
app.post("/admin/logout", (_req, res) => clearAdminSession(res));

const reactAdminDir = join(process.cwd(), "frontend", "dist");
const legacyAdminDir = join(process.cwd(), "frontend", "admin");
const adminStaticDir = existsSync(join(reactAdminDir, "index.html")) ? reactAdminDir : legacyAdminDir;
app.use("/admin", requireAdminSession, express.static(adminStaticDir));

function redactSecret(value) {
  if (!value) return "";
  const str = String(value);
  if (str.length <= 8) return "********";
  return `${str.slice(0, 4)}...${str.slice(-4)}`;
}

app.get("/api/v1/admin/settings", requireAdminSession, async (req, res) => {
  const settings = await getRuntimeSettings();
  const reveal = req.query.reveal === "1" || req.query.reveal === "true";
  const secretValue = (envName, runtimeName) => {
    const value = process.env[envName] || settings[runtimeName];
    return reveal ? value || "" : redactSecret(value);
  };

  res.json({
    ok: true,
    admin: {
      username: await getAdminLoginUsername(),
      env_managed: Boolean(process.env.ADMIN_PASSWORD),
    },
    settings: {
      processing_ui_token: secretValue("PROCESSING_UI_TOKEN", "processing_ui_token"),
      zapier_webhook_token: secretValue("ZAPIER_WEBHOOK_TOKEN", "zapier_webhook_token"),
      admin_session_secret: secretValue("ADMIN_SESSION_SECRET", "admin_session_secret"),
      pdf_app_api_key: secretValue("PDF_APP_API_KEY", "pdf_app_api_key"),
      pdf_app_ocr_endpoint:
        process.env.PDF_APP_OCR_ENDPOINT || settings.pdf_app_ocr_endpoint || "",
      pdf_app_job_endpoint:
        process.env.PDF_APP_JOB_ENDPOINT || settings.pdf_app_job_endpoint || "",
      document_template_url:
        process.env.DOCUMENT_TEMPLATE_URL || settings.document_template_url || "",
    },
  });
});

app.post("/api/v1/admin/settings", requireAdminSession, async (req, res) => {
  const body = req.body || {};
  const settings = {};
  const assignIfFilled = (bodyKey, settingsKey = bodyKey) => {
    const value = body[bodyKey];
    if (typeof value === "string" && value.trim()) settings[settingsKey] = value.trim();
  };

  assignIfFilled("processing_ui_token");
  assignIfFilled("zapier_webhook_token");
  assignIfFilled("admin_session_secret");
  assignIfFilled("pdf_app_api_key");
  assignIfFilled("pdf_app_ocr_endpoint");
  assignIfFilled("pdf_app_job_endpoint");
  assignIfFilled("document_template_url");

  await updateRuntimeSettings({
    settings,
    admin_password: body.admin_password ? String(body.admin_password) : undefined,
  });

  if (body.admin_session_secret || body.admin_password) {
    const session = await createAdminSession(await getAdminLoginUsername());
    setAdminSessionCookie(res, session);
  }

  res.json({ ok: true });
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

app.post("/api/v1/zapier/email-activation", requireZapierWebhookToken, upload, async (req, res) => {
  let event = null;
  try {
    const body = Array.isArray(req.body) ? req.body[0] || {} : req.body || {};
    event = await createProcessingEvent({
      source: "zapier.email_activation",
      status: "received",
      body,
      files: req.files,
      metadata: {
        subject: body.subject || body.email_subject || body.oggetto || null,
        from: body.from || body.email_from || body.mittente || null,
        zap_run_id: body.zap_run_id || body.zapRunId || null,
        email_id: body.email_id || body.message_id || body.gmail_id || null,
      },
    });
    const result = await prepareZapierScraperResult(event, body, req.files);
    const updatedEvent = await getProcessingEvent(event.id);

    res.status(202).json({
      ok: true,
      event_id: event.id,
      status: updatedEvent?.status || event.status,
      admin_url: `/admin/#/events/${event.id}`,
      result,
    });
  } catch (error) {
    if (event?.id) {
      await updateProcessingEvent(
        event.id,
        {
          status: "failed",
          error: {
            message: error.message || String(error),
            stack: error.stack || null,
          },
        },
        {
          level: "error",
          message: "Zapier intake processing failed",
        }
      );
    }
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.get("/api/v1/processing-events", requireProcessingUiToken, async (req, res) => {
  const limit = Number(req.query.limit || 100);
  const events = await listProcessingEvents({ limit });
  res.json({ ok: true, events });
});

app.get("/api/v1/processing-events/:id", requireProcessingUiToken, async (req, res) => {
  const event = await getProcessingEvent(req.params.id);
  if (!event) {
    res.status(404).json({ ok: false, error: "Processing event not found" });
    return;
  }
  res.json({ ok: true, event });
});

app.get("/api/v1/processing-events/:id/document", requireProcessingUiToken, async (req, res) => {
  const event = await getProcessingEvent(req.params.id);
  if (!event) {
    res.status(404).json({ ok: false, error: "Processing event not found" });
    return;
  }

  const format = String(req.query.format || "pdf").toLowerCase();
  const fileName = `astebook-${event.id}.${format === "doc" ? "doc" : format}`;

  if (format === "html") {
    res.type("html").send(buildDocumentHtml(event));
    return;
  }

  if (format === "doc") {
    res.setHeader("content-type", "application/msword; charset=utf-8");
    res.setHeader("content-disposition", `inline; filename="${fileName}"`);
    res.send(buildDocumentHtml(event));
    return;
  }

  if (format === "docx") {
    try {
      const docx = await buildDocumentDocx(event);
      if (!docx) {
        res.status(400).json({ ok: false, error: "DOCUMENT_TEMPLATE_URL non configurato." });
        return;
      }
      res.setHeader("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("content-disposition", `attachment; filename="astebook-${event.id}.docx"`);
      res.send(docx);
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: "Generazione DOCX fallita.",
        detail: error.message || String(error),
      });
    }
    return;
  }

  if (format === "txt") {
    res.type("text/plain").send(buildDocumentText(event));
    return;
  }

  try {
    const pdf = await buildDocumentPdf(event);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `inline; filename="${fileName}"`);
    res.send(pdf);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "Generazione PDF fallita.",
      detail: error.message || String(error),
    });
  }
});

app.post("/api/v1/processing-events/:id/reprocess", requireProcessingUiToken, async (req, res) => {
  const event = await getProcessingEvent(req.params.id);
  if (!event) {
    res.status(404).json({ ok: false, error: "Processing event not found" });
    return;
  }

  if (event.source !== "zapier.email_activation") {
    res.status(400).json({ ok: false, error: "Reprocess disponibile solo per eventi Zapier." });
    return;
  }

  const body = event.request?.body || {};
  await updateProcessingEvent(
    event.id,
    {
      status: "received",
      result: null,
      error: null,
    },
    { message: "Manual reprocess requested" }
  );
  const result = await prepareZapierScraperResult(event, body, []);
  const updatedEvent = await getProcessingEvent(event.id);

  res.json({
    ok: true,
    event: updatedEvent,
    result,
  });
});

function formatLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysToISODate(isoDate, days) {
  const m = typeof isoDate === "string" && isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function shiftISOToNextBusinessDay(isoDate) {
  const m = typeof isoDate === "string" && isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dow = d.getUTCDay();
  if (dow === 6) return addDaysToISODate(isoDate, 2); // sabato -> lunedi
  if (dow === 0) return addDaysToISODate(isoDate, 1); // domenica -> lunedi
  return isoDate;
}

function toISOFromITDate(val) {
  // accetta gg/mm/aa, gg/mm/aaaa, o "1 marzo 2026" -> ISO YYYY-MM-DD
  if (!val) return null;
  const str = String(val).trim();
  let m = str.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})\b/);
  if (m) {
    const day = String(m[1]).padStart(2, "0");
    const month = String(m[2]).padStart(2, "0");
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${month}-${day}`;
  }

  const months = {
    gennaio: "01",
    febbraio: "02",
    marzo: "03",
    aprile: "04",
    maggio: "05",
    giugno: "06",
    luglio: "07",
    agosto: "08",
    settembre: "09",
    ottobre: "10",
    novembre: "11",
    dicembre: "12",
  };
  m = str.match(
    /\b(\d{1,2})\D+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\D+(\d{2}|\d{4})\b/i
  );
  if (m) {
    const day = String(m[1]).padStart(2, "0");
    const month = months[m[2].toLowerCase()];
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return month ? `${year}-${month}-${day}` : null;
  }

  return null;
}

function toItalianTextDate(val) {
  const months = [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre",
  ];
  if (!val) return val ?? null;
  const str = String(val).trim();

  // ISO YYYY-MM-DD
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${day} ${months[month - 1]} ${year}`;
    }
  }

  // Italiano gg/mm/aa(aa)
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${day} ${months[month - 1]} ${year}`;
    }
  }

  return str;
}

function formatMoneyIT(val) {
  const normalized = () => {
    if (typeof val === "number") return val;
    if (val === null || val === undefined) return NaN;
    const s = String(val).trim();
    const withDot = s.replace(/\./g, "").replace(/,/g, ".");
    const digitsOnly = withDot.replace(/[^\d.-]/g, "");
    return Number(digitsOnly);
  };
  const num = normalized();
  if (!Number.isFinite(num)) return val ?? null;
  const fixed = num.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${withThousands},${decPart}`;
}

function ensureNumberDefaults(obj, keys) {
  keys.forEach((k) => {
    if (obj && (obj[k] === null || obj[k] === undefined)) obj[k] = 0;
  });
}

function replaceNullishWithEmptyString(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(replaceNullishWithEmptyString);
  if (value && typeof value === "object") {
    Object.keys(value).forEach((k) => {
      value[k] = replaceNullishWithEmptyString(value[k]);
    });
    return value;
  }
  return value;
}

function computeDataAperturaPubblicazione() {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(15, 30, 0, 0); // 15:30 locale
  const base = now >= cutoff ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : now;
  return formatLocalISODate(base);
}

function fileByField(files, name) {
  return Array.isArray(files) ? files.find((f) => f.fieldname === name) || null : null;
}

function firstFile(files) {
  return Array.isArray(files) && files.length > 0 ? files[0] : null;
}

function firstBodyValue(body, keys) {
  return keys.map((key) => body?.[key]).find((value) => value !== undefined && value !== null) || "";
}

function resolveEmailText(body) {
  return String(
    firstBodyValue(body, [
      "email_body_text",
      "body_plain",
      "body_text",
      "body",
      "text",
      "message",
      "email_body",
      "plain_body",
    ]) || ""
  );
}

function normalizeEmailTextForScraper(text) {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function attachmentKind(fileName) {
  const name = String(fileName || "").toLowerCase();
  if (/privacy|aml|antiriciclaggio|bonifico|distin[gt]a|istinta|codice\s*fiscale|\bcf\b|document[oi]\s+cliente/.test(name)) {
    return "ignored";
  }
  if (/provvigione|commission|raccolta\s+offerte/.test(name)) return "provvigione";
  if (/proposta|offerta|offer/.test(name)) return "proposta";
  if (/annuncio|disciplinare|gara|asta|lotto/.test(name)) return "annuncio";
  return "unknown";
}

function hasUsefulAnnuncioData(annuncio) {
  if (!annuncio) return false;
  return [
    annuncio.indirizzo,
    annuncio.indirizzo_raw,
    annuncio.tipo_vendita,
    annuncio.data_vendita,
    annuncio.ora_vendita,
    annuncio.offerta_minima,
    annuncio.provvigione_percentuale,
    annuncio.superficie_mq,
    annuncio.piano_numero,
    annuncio.ascensore,
    annuncio.stato,
    annuncio.categoria_macro,
    annuncio.aggiornato_il,
  ].some((value) => !isMissingValue(value));
}

function mergeExtractedProposta(current, next) {
  if (!current) return next;
  if (!next) return current;

  const merged = {
    ...current,
    proponente: {
      ...(current.proponente || {}),
    },
    catasto: {
      ...(current.catasto || {}),
    },
    source_files: Array.from(
      new Set([...(current.source_files || [current.file_pdf]).filter(Boolean), next.file_pdf].filter(Boolean))
    ),
    raw_length: Math.max(Number(current.raw_length || 0), Number(next.raw_length || 0)),
  };

  const mergeValue = (key) => {
    if (isMissingValue(merged[key]) && !isMissingValue(next[key])) merged[key] = next[key];
  };
  const mergeNestedValue = (parent, key) => {
    if (isMissingValue(merged[parent]?.[key]) && !isMissingValue(next[parent]?.[key])) {
      merged[parent] = { ...(merged[parent] || {}), [key]: next[parent][key] };
    }
  };

  [
    "indirizzo_immobile",
    "prezzo_offerto",
    "deposito_cauzionale",
    "deposito_cauzionale_percentuale",
    "iban_beneficiario",
    "irrevocabile_giorni",
    "rogito_entro_giorni",
  ].forEach(mergeValue);
  ["nominativo", "telefono", "cellulare", "documento"].forEach((key) => mergeNestedValue("proponente", key));
  ["foglio", "particella", "subalterno", "sezione", "categoria"].forEach((key) => mergeNestedValue("catasto", key));

  return merged;
}

function finalizeZapierResult(result) {
  result.missing_fields = collectMissingFields(result);
  result.ready_for_zapier =
    Boolean(result.extracted.annuncio || result.extracted.proposta) && result.missing_fields.length === 0;
  result.zapier_response = {
    ok: result.ready_for_zapier,
    codice_pratica: result.codice_pratica,
    annuncio: result.extracted.annuncio,
    proposta: result.extracted.proposta,
  };
  return result;
}

function isMissingValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const clean = value.trim();
    return !clean || clean === "-" || /^[….\s”")]+$/.test(clean);
  }
  return false;
}

function valueAtPath(obj, path) {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

const expectedZapierFields = [
  { path: "codice_pratica", label: "Codice Pratica", expected_file: "Oggetto mail o Annuncio" },
  { path: "extracted.proposta.proponente.nominativo", label: "Proponente - Nominativo", expected_file: "Proposta" },
  { path: "extracted.proposta.indirizzo_immobile", label: "Indirizzo Immobile", expected_file: "Proposta" },
  { path: "extracted.proposta.prezzo_offerto", label: "Prezzo Offerto", expected_file: "Proposta" },
  { path: "extracted.proposta.iban_beneficiario", label: "IBAN Beneficiario", expected_file: "Proposta" },
  { path: "extracted.proposta.catasto.foglio", label: "Catasto - Foglio", expected_file: "Proposta o Visura" },
  { path: "extracted.proposta.catasto.particella", label: "Catasto - Particella", expected_file: "Proposta o Visura" },
  { path: "extracted.proposta.catasto.subalterno", label: "Catasto - Subalterno", expected_file: "Proposta o Visura" },
  { path: "extracted.annuncio.indirizzo", label: "Annuncio - Indirizzo", expected_file: "Annuncio" },
  { path: "extracted.annuncio.offerta_minima", label: "Offerta Minima", expected_file: "Annuncio" },
  { path: "extracted.annuncio.data_vendita", label: "Data Vendita", expected_file: "Annuncio" },
  { path: "extracted.annuncio.ora_vendita", label: "Ora Vendita", expected_file: "Annuncio" },
];

function collectMissingFields(result) {
  return expectedZapierFields
    .filter((field) => isMissingValue(valueAtPath(result, field.path)))
    .map((field) => ({
      field: field.label,
      message: `${field.label}: Dato non trovato o mancante. (Expected File ${field.expected_file})`,
      expected_file: field.expected_file,
      path: field.path,
    }));
}

function buildMissingFieldsError(result) {
  const missingFields = collectMissingFields(result);
  if (missingFields.length === 0) return null;
  return {
    message: "Dati mancanti rilevati durante l'estrazione.",
    missing_fields: missingFields,
  };
}

function isPdfAttachment(attachment) {
  return (
    String(attachment.mime_type || "").toLowerCase().includes("pdf") ||
    String(attachment.file_name || "").toLowerCase().endsWith(".pdf")
  );
}

function isDocxAttachment(attachment) {
  const mime = String(attachment.mime_type || "").toLowerCase();
  const fileName = String(attachment.file_name || "").toLowerCase();
  return mime.includes("wordprocessingml.document") || fileName.endsWith(".docx");
}

function isImageAttachment(attachment) {
  const mime = String(attachment.mime_type || "").toLowerCase();
  const fileName = String(attachment.file_name || "").toLowerCase();
  return (
    mime.startsWith("image/") ||
    /\.(jpe?g|png|bmp|tiff?|webp)$/i.test(fileName)
  );
}

function attachmentKeyLooksRelevant(key) {
  return /attachment|attachments|file|files|allegat/i.test(String(key || ""));
}

function extractUrls(value) {
  return String(value || "").match(/https?:\/\/[^\s"',<>{}\]]+/gi) || [];
}

function filenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

function filenameFromContentDisposition(value) {
  const header = String(value || "");
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  const plain = header.match(/filename="?([^";]+)"?/i)?.[1];
  return plain || null;
}

function tryParseJsonString(value) {
  const text = String(value || "").trim();
  if (!/^[\[{]/.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeAttachmentDescriptor(raw) {
  const url =
    raw?.attachment ||
    raw?.url ||
    raw?.file ||
    raw?.download_url ||
    raw?.href ||
    raw?.value ||
    null;
  const fileName =
    raw?.fileName ||
    raw?.file_name ||
    raw?.filename ||
    raw?.truncateFilename ||
    raw?.truncate_filename ||
    raw?.name ||
    raw?.originalname ||
    raw?.title ||
    filenameFromUrl(url) ||
    "allegato";
  const mimeType = raw?.mime_type || raw?.mimetype || raw?.mimeType || raw?.content_type || "";

  if (!url && !raw?.buffer) return null;

  return {
    field_name: raw?.fieldname || raw?.field_name || null,
    file_name: String(fileName),
    mime_type: String(mimeType),
    size: raw?.size || null,
    url: typeof url === "string" && /^https?:\/\//i.test(url) ? url : null,
    kind: attachmentKind(fileName),
    supported_by_scraper: isPdfAttachment({
      file_name: fileName,
      mime_type: mimeType,
    }) || isDocxAttachment({ file_name: fileName, mime_type: mimeType }) || isImageAttachment({ file_name: fileName, mime_type: mimeType }),
    buffer: raw?.buffer || null,
  };
}

function collectZapierAttachments(body, files) {
  const collected = [];
  const seen = new Set();

  const add = (descriptor) => {
    if (!descriptor) return;
    const key = descriptor.url || `${descriptor.file_name}|${descriptor.field_name || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(descriptor);
  };

  (Array.isArray(files) ? files : []).forEach((file) => add(normalizeAttachmentDescriptor(file)));

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const groups = {};
    Object.entries(body).forEach(([key, value]) => {
      const match = String(key).match(/^(attachment|file|allegato)[\s_-]*(\d+)[\s_-]*(.+)$/i);
      if (!match) return;
      const groupKey = `${match[1].toLowerCase()}_${match[2]}`;
      groups[groupKey] = groups[groupKey] || {};
      groups[groupKey][match[3]] = value;
    });
    Object.values(groups).forEach((group) => add(normalizeAttachmentDescriptor(group)));
  }

  const visit = (value, key = "") => {
    if (!value) return;

    if (typeof value === "string") {
      const parsed = tryParseJsonString(value);
      if (parsed) {
        visit(parsed, key);
        return;
      }

      if (attachmentKeyLooksRelevant(key)) {
        extractUrls(value).forEach((url, index) => {
          add(
            normalizeAttachmentDescriptor({
              attachment: url,
              fileName: index === 0 ? key : `${key}_${index + 1}`,
            })
          );
        });
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${key}_${index + 1}`));
      return;
    }

    if (typeof value === "object") {
      const descriptor = normalizeAttachmentDescriptor(value);
      if (descriptor) add(descriptor);
      Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }
  };

  visit(body);
  return collected;
}

function inferAttachmentFormat(attachment, buffer) {
  if (isPdfAttachment(attachment)) return "pdf";
  if (isDocxAttachment(attachment)) return "docx";
  if (buffer?.subarray(0, 4).toString("utf8") === "%PDF") return "pdf";
  if (buffer?.subarray(0, 2).toString("utf8") === "PK") return "docx";
  if (isImageAttachment(attachment)) return "image";
  return "unknown";
}

async function readAttachment(attachment) {
  if (attachment.buffer) {
    return {
      ...attachment,
      buffer: attachment.buffer,
      format: inferAttachmentFormat(attachment, attachment.buffer),
    };
  }
  if (!attachment.url) return null;

  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(
      `Download allegato fallito (${attachment.file_name}): ${response.status} ${response.statusText}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const headerFileName = filenameFromContentDisposition(response.headers.get("content-disposition"));
  const mimeType = response.headers.get("content-type") || attachment.mime_type || "";
  const fileName =
    headerFileName ||
    (attachment.file_name && !/^attachments?(_\d+)?$/i.test(attachment.file_name)
      ? attachment.file_name
      : filenameFromUrl(attachment.url)) ||
    attachment.file_name;

  const resolved = {
    ...attachment,
    file_name: fileName,
    mime_type: mimeType,
    kind: attachment.kind === "unknown" ? attachmentKind(fileName) : attachment.kind,
    buffer,
  };
  return {
    ...resolved,
    format: inferAttachmentFormat(resolved, buffer),
  };
}

async function extractAttachmentText(resolvedAttachment, eventId, result) {
  if (resolvedAttachment.format === "docx") {
    return (await parseDocxBuffer(resolvedAttachment.buffer)).text;
  }
  if (["pdf", "image"].includes(resolvedAttachment.format)) {
    if (resolvedAttachment.url) {
      try {
        const ocrResult = await ocrFileUrlWithPdfApp({
          fileUrl: resolvedAttachment.url,
          fileName: resolvedAttachment.file_name,
        });
        if (ocrResult.ok && ocrResult.text) {
          if (eventId) {
            await updateProcessingEvent(eventId, {}, {
              message: "PDF-app OCR completed",
              data: {
                file_name: resolvedAttachment.file_name,
                text_length: ocrResult.text.length,
                job_id: ocrResult.job_id || null,
              },
            });
          }
          return ocrResult.text;
        }
        if (eventId) {
          await updateProcessingEvent(eventId, {}, {
            message: "PDF-app OCR skipped or empty",
            data: {
              file_name: resolvedAttachment.file_name,
              reason: ocrResult.reason || "Nessun testo OCR restituito.",
              job_id: ocrResult.job_id || null,
            },
          });
        }
        addUniqueNote(
          result,
          `${resolvedAttachment.file_name}: OCR PDF-app non eseguito o senza testo (${ocrResult.reason || "Nessun testo OCR restituito."})`
        );
      } catch (error) {
        if (eventId) {
          await updateProcessingEvent(eventId, {}, {
            level: "error",
            message: "PDF-app OCR failed; local parser fallback",
            data: {
              file_name: resolvedAttachment.file_name,
              error: error.message || String(error),
            },
          });
        }
        addUniqueNote(
          result,
          `${resolvedAttachment.file_name}: OCR PDF-app fallito (${error.message || String(error)})`
        );
      }
    }

    if (resolvedAttachment.format === "pdf") {
      return (await parsePdfBuffer(resolvedAttachment.buffer)).text;
    }
  }
  return "";
}

function addUniqueNote(result, note) {
  if (!note) return;
  result.notes = Array.isArray(result.notes) ? result.notes : [];
  if (!result.notes.includes(note)) result.notes.push(note);
}

async function prepareZapierScraperResult(event, body, files) {
  const emailText = resolveEmailText(body);
  const attachmentInputs = collectZapierAttachments(body, files);
  const attachments = attachmentInputs.map(({ buffer, ...safeDescriptor }) => safeDescriptor);
  const result = {
    ok: true,
    mode: "zapier_scraper_preview",
    ready_for_zapier: false,
    codice_pratica: resolveCodicePraticaFromPayload(body) || "",
    email: {
      subject: firstBodyValue(body, ["subject", "email_subject", "oggetto"]) || null,
      from: firstBodyValue(body, ["from", "email_from", "mittente"]) || null,
      has_body_text: emailText.trim().length > 0,
    },
    attachments,
    extracted: {
      annuncio: null,
      proposta: null,
      provvigione: null,
    },
    zapier_response: null,
    notes: [],
  };

  await updateProcessingEvent(
    event.id,
    { result },
    {
      message: "Zapier payload normalized for extraction",
      data: {
        attachment_count: attachments.length,
        initially_supported_count: attachments.filter((attachment) => attachment.supported_by_scraper).length,
      },
    }
  );

  const emailAnnouncementText = normalizeEmailTextForScraper(emailText);
  if (emailAnnouncementText) {
    const emailAnnouncement = scrapeAnnuncioFromText(emailAnnouncementText, "Corpo email");
    if (hasUsefulAnnuncioData(emailAnnouncement)) {
      result.extracted.annuncio = emailAnnouncement;
      if (!result.codice_pratica) {
        result.codice_pratica = scrapeCodicePraticaFromText(emailAnnouncementText) || "";
      }
      await updateProcessingEvent(event.id, { result }, {
        message: "Email body announcement scraper completed",
        data: emailAnnouncement,
      });
    }
  }

  if (attachmentInputs.length === 0) {
    result.notes.push("Nessun allegato trovato nel payload ricevuto.");
    finalizeZapierResult(result);
    await updateProcessingEvent(
      event.id,
      {
        result,
        error: buildMissingFieldsError(result),
      },
      {
        message: "No supported scraper input found",
        data: {
          accepted_formats: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/*"],
          received_files: attachments.map((attachment) => ({
            file_name: attachment.file_name,
            mime_type: attachment.mime_type,
          })),
        },
      }
    );
    return result;
  }

  await updateProcessingEvent(event.id, { status: "extracting" }, { message: "Scraper extraction started" });

  for (const attachment of attachmentInputs) {
    let resolvedAttachment = null;
    try {
      resolvedAttachment = await readAttachment(attachment);
    } catch (error) {
      result.notes.push(`${attachment.file_name}: download fallito (${error.message || String(error)})`);
      continue;
    }

    if (!resolvedAttachment?.buffer) continue;

    const safeDescriptor = {
      field_name: resolvedAttachment.field_name,
      file_name: resolvedAttachment.file_name,
      mime_type: resolvedAttachment.mime_type,
      size: resolvedAttachment.size,
      url: resolvedAttachment.url,
      kind: resolvedAttachment.kind,
      supported_by_scraper: ["pdf", "docx", "image"].includes(resolvedAttachment.format),
      format: resolvedAttachment.format,
    };
    const existingIndex = result.attachments.findIndex(
      (item) => item.url === safeDescriptor.url || item.file_name === attachment.file_name
    );
    if (existingIndex >= 0) result.attachments[existingIndex] = safeDescriptor;

    if (resolvedAttachment.kind === "ignored") {
      continue;
    }

    if (!["pdf", "docx", "image"].includes(resolvedAttachment.format)) {
      result.notes.push(`Formato non supportato: ${resolvedAttachment.file_name}`);
      continue;
    }

    try {
      if (resolvedAttachment.kind === "provvigione") {
        const attachmentText = await extractAttachmentText(resolvedAttachment, event.id, result);
        const provvigionePercentuale = scrapeProvvigionePercentuale(attachmentText);
        result.extracted.provvigione = {
          file_pdf: resolvedAttachment.file_name,
          provvigione_percentuale: provvigionePercentuale,
          raw_length: attachmentText.length,
        };
        await updateProcessingEvent(event.id, { result }, {
          message: "Commission scraper completed",
          data: result.extracted.provvigione,
        });
        continue;
      }

      if (resolvedAttachment.kind === "proposta") {
        const attachmentText = await extractAttachmentText(resolvedAttachment, event.id, result);
        const extractedProposta = scrapePropostaFromText(attachmentText, resolvedAttachment.file_name);

        result.extracted.proposta = mergeExtractedProposta(result.extracted.proposta, extractedProposta);
        await updateProcessingEvent(event.id, { result }, {
          message: "Proposal scraper completed",
          data: extractedProposta,
        });
        continue;
      }

      if (resolvedAttachment.kind === "annuncio") {
        const attachmentText = await extractAttachmentText(resolvedAttachment, event.id, result);
        result.extracted.annuncio = scrapeAnnuncioFromText(attachmentText, resolvedAttachment.file_name);
        if (
          isMissingValue(result.extracted.annuncio.provvigione_percentuale) &&
          !isMissingValue(result.extracted.provvigione?.provvigione_percentuale)
        ) {
          result.extracted.annuncio.provvigione_percentuale = result.extracted.provvigione.provvigione_percentuale;
          result.extracted.annuncio.provvigione_source = result.extracted.provvigione.file_pdf;
        }
        if (!result.codice_pratica) {
          result.codice_pratica = scrapeCodicePraticaFromText(attachmentText) || "";
        }
        await updateProcessingEvent(event.id, { result }, {
          message: "Auction announcement scraper completed",
          data: result.extracted.annuncio,
        });
        continue;
      }
    } catch (error) {
      result.notes.push(
        `${resolvedAttachment.file_name}: estrazione fallita (${error.message || String(error)})`
      );
      continue;
    }

    result.notes.push(`Allegato non classificato: ${resolvedAttachment.file_name}`);
  }

  if (
    result.extracted.annuncio &&
    isMissingValue(result.extracted.annuncio.provvigione_percentuale) &&
    !isMissingValue(result.extracted.provvigione?.provvigione_percentuale)
  ) {
    result.extracted.annuncio.provvigione_percentuale = result.extracted.provvigione.provvigione_percentuale;
    result.extracted.annuncio.provvigione_source = result.extracted.provvigione.file_pdf;
  }

  finalizeZapierResult(result);
  const extractionError = buildMissingFieldsError(result);

  await updateProcessingEvent(
    event.id,
    {
      status: result.ready_for_zapier ? "completed" : "received",
      result,
      error: extractionError,
    },
    {
      message: result.ready_for_zapier
        ? "Scraper extraction completed"
        : "Scraper extraction completed without classified data",
      data: {
        ready_for_zapier: result.ready_for_zapier,
      },
    }
  );

  return result;
}

async function fetchIbanInfo(iban) {
  if (!iban || typeof iban !== "string") return { bic: null, bank: null };
  const clean = iban.replace(/\s+/g, "").trim();
  if (!clean) return { bic: null, bank: null };
  try {
    const resp = await fetch(
      `https://openiban.com/validate/${encodeURIComponent(clean)}?getBIC=true`
    );
    if (!resp.ok) throw new Error(`openiban status ${resp.status}`);
    const data = await resp.json();
    const bic = data?.bankData?.bic || null;
    const bank = data?.bankData?.name || null;
    return { bic, bank };
  } catch {
    return { bic: null, bank: null };
  }
}

async function geocodeAddress(address) {
  if (!address || typeof address !== "string") return null;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  const clean = address.trim();
  if (!clean) return null;
  try {
    const params = new URLSearchParams({
      address: clean,
      key: apiKey,
      language: "it",
      region: "it",
    });
    const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`google geocode status ${resp.status}`);
    const data = await resp.json();
    if (data?.status && data.status !== "OK") return null;
    const result = Array.isArray(data?.results) ? data.results[0] : null;
    if (!result) return null;
    const comps = Array.isArray(result.address_components) ? result.address_components : [];
    const pick = (type) =>
      comps.find((c) => Array.isArray(c.types) && c.types.includes(type))?.long_name || null;
    const route = pick("route");
    const streetNumber = pick("street_number");
    const comune =
      pick("locality") ||
      pick("postal_town") ||
      pick("administrative_area_level_3") ||
      pick("administrative_area_level_2") ||
      null;
    const indirizzo = [route, streetNumber].filter(Boolean).join(", ") || null;
    return {
      indirizzo,
      comune,
      cap: pick("postal_code"),
      provincia: pick("administrative_area_level_2"),
      formatted_address: result.formatted_address || null,
    };
  } catch {
    return null;
  }
}

app.post("/callAI", upload, async (req, res) => {
  let processingEvent = null;
  try {
    const body = Array.isArray(req.body) ? req.body[0] || {} : req.body || {};
    processingEvent = await createProcessingEvent({
      source: "callAI",
      status: "processing",
      body,
      files: req.files,
      metadata: {
        subject: body.subject || body.email_subject || body.oggetto || null,
        from: body.from || body.email_from || body.mittente || null,
        zap_run_id: body.zap_run_id || body.zapRunId || null,
        email_id: body.email_id || body.message_id || body.gmail_id || null,
      },
    });
    const rawEmailBody = typeof body.email_body_text === "string" ? body.email_body_text : "";
    const codice_pratica =
      resolveCodicePraticaFromPayload(body) || scrapeCodicePraticaFromText(rawEmailBody);
    const provvigioneOcrText =
      typeof body.provvigione_ocr === "string"
        ? body.provvigione_ocr
        : typeof body.provvigione_ocr_text === "string"
        ? body.provvigione_ocr_text
        : "";
    const files = Array.isArray(req.files) ? req.files : [];
    await updateProcessingEvent(
      processingEvent.id,
      { status: "extracting" },
      {
        message: "Validated input and started extraction",
        data: {
          codice_pratica,
          has_email_body: rawEmailBody.trim().length > 0,
          file_count: files.length,
        },
      }
    );

    const propostaUploadFile = fileByField(files, "proposta") || firstFile(files);

    const hasAnnuncioEmail = rawEmailBody.trim().length > 0;
    if (!hasAnnuncioEmail) {
      throw new Error("Manca annuncio: popola 'email_body_text' con il testo dell'annuncio.");
    }

    const annuncioFileName = body.annuncio_name || "AnnuncioEmail.txt";
    const annuncioText = rawEmailBody;

    // Proposta: OCR testo prioritario; PDF come fallback (upload/base64/url).
    let proBuf = null;
    let proName = body.proposta_name || "Proposta.txt";
    if (propostaUploadFile?.buffer) {
      proBuf = propostaUploadFile.buffer;
      proName = propostaUploadFile.originalname || body.proposta_name || "Proposta.pdf";
    } else if (body.proposta_base64) {
      const parts = String(body.proposta_base64).split(",");
      const payload = parts.length > 1 ? parts[1] : parts[0];
      proBuf = Buffer.from(payload, "base64");
      proName = body.proposta_name || "Proposta.pdf";
    } else if (body.proposta_url) {
      const url = String(body.proposta_url).trim();
      if (url) {
        const resp = await fetch(url);
        if (!resp.ok)
          throw new Error(`Download proposta fallito: ${resp.status} ${resp.statusText}`);
        const arrayBuf = await resp.arrayBuffer();
        proBuf = Buffer.from(arrayBuf);
        proName = body.proposta_name || "Proposta.pdf";
      }
    }

    // testo proposta: OCR sempre usato se presente
    const propostaTextBody =
      typeof body.proposta_ocr === "string"
        ? body.proposta_ocr
        : typeof body.proposta_text === "string"
        ? body.proposta_text
        : typeof body.proposta_ocr_text === "string"
        ? body.proposta_ocr_text
        : typeof body.ocr_text === "string"
        ? body.ocr_text
        : "";

    let combinedProText = propostaTextBody;
    if (!combinedProText.trim()) {
      if (!proBuf) {
        throw new Error("Manca testo OCR della proposta (proposta_ocr) e nessun PDF fornito.");
      }
      const parsedPro = await parsePdfBuffer(proBuf);
      combinedProText = parsedPro?.text || "";
    }
    const aiAnnuncio = await aiExtractAnnuncio({
      text: annuncioText,
      fileName: annuncioFileName,
      mode: "email",
    });
    await updateProcessingEvent(processingEvent.id, { status: "extracting" }, {
      message: "Auction announcement extracted",
      data: aiAnnuncio,
    });

    let aiProposta = await aiExtractProposta({ text: combinedProText, fileName: proName });
    await updateProcessingEvent(processingEvent.id, { status: "extracting" }, {
      message: "Proposal extracted",
      data: aiProposta,
    });

    let provvigioneFromOcr = null;
    if (provvigioneOcrText.trim()) {
      const aiProvvigione = await aiExtractProvvigionePercentuale({
        text: provvigioneOcrText,
        fileName: "provvigione_ocr.txt",
      });
      if (typeof aiProvvigione?.provvigione_percentuale === "number") {
        provvigioneFromOcr = aiProvvigione.provvigione_percentuale;
      }
    }

    // BIC lookup da IBAN (se presente)
    if (aiProposta.iban_beneficiario) {
      const { bic, bank } = await fetchIbanInfo(aiProposta.iban_beneficiario);
      if (!aiProposta.bic_cauzione) aiProposta.bic_cauzione = bic;
      if (!aiProposta.beneficiario_cauzione) aiProposta.beneficiario_cauzione = bank;
    }
    // Fallback beneficiario dal testo proposta (es. "intestato a ...")
    if (!aiProposta.beneficiario_cauzione && combinedProText) {
      const m = combinedProText.match(/intestat[oa]\s+a\s+([^\n;,]+?)(?=\s*(iban|iban:|IBAN|Iban|;|,|\n))/i);
      if (m?.[1]) aiProposta.beneficiario_cauzione = m[1].trim();
    }

    const addressCandidate = aiProposta?.indirizzo_immobile || aiAnnuncio?.indirizzo || null;
    const geocoded = await geocodeAddress(addressCandidate);

    const data_apertura_pubblicazione = computeDataAperturaPubblicazione();
    const data_redazione_oggi = formatLocalISODate(new Date());
    const anno_redazione_oggi = new Date().getFullYear();
    const dataTermineDepositoRaw = aiAnnuncio.data_termine_deposito || null;
    const dataTermineDepositoISO = toISOFromITDate(dataTermineDepositoRaw);
    const dataGaraAnnuncioISO = toISOFromITDate(aiAnnuncio.data_vendita);
    let data_termine_deposito = dataTermineDepositoISO || dataTermineDepositoRaw || null;
    const ora_termine_deposito = aiAnnuncio.ora_termine_deposito || null;
    let data_gara = null;
    let dataGaraComputed = false;
    if (dataTermineDepositoISO) {
      // +2 giorni pieni -> gara il terzo giorno di calendario (weekend inclusi).
      data_gara = addDaysToISODate(dataTermineDepositoISO, 3);
      dataGaraComputed = true;
    } else if (dataGaraAnnuncioISO) {
      data_gara = dataGaraAnnuncioISO;
      if (!data_termine_deposito) {
        data_termine_deposito = addDaysToISODate(dataGaraAnnuncioISO, -3);
      }
    }
    if (dataGaraComputed && data_gara) data_gara = shiftISOToNextBusinessDay(data_gara);
    const ora_gara_inizio = aiAnnuncio.ora_gara_inizio || "09:00";
    const ora_gara_fine = aiAnnuncio.ora_gara_fine || "12:00";
    const provvigione_percentuale =
      typeof provvigioneFromOcr === "number" && provvigioneFromOcr > 0
        ? provvigioneFromOcr
        : typeof aiAnnuncio.provvigione_percentuale === "number" && aiAnnuncio.provvigione_percentuale > 0
        ? aiAnnuncio.provvigione_percentuale
        : 3;

    const merged = mergeAnnuncioProposta(
      {
        file_pdf: aiAnnuncio.file_pdf,
        indirizzo: aiAnnuncio.indirizzo,
        data_vendita: aiAnnuncio.data_vendita,
        ora_vendita: aiAnnuncio.ora_vendita,
        offerta_minima: aiAnnuncio.offerta_minima,
        rilancio_minimo: 1000,
        offerta_minima_ammissibile:
          aiAnnuncio.offerta_minima != null
            ? Number(aiAnnuncio.offerta_minima) + 1000
            : null,
        stato: aiAnnuncio.stato,
        ora_gara_inizio: aiAnnuncio.ora_gara_inizio,
        ora_gara_fine: aiAnnuncio.ora_gara_fine,
        termine_richieste_visite_data: aiAnnuncio.termine_richieste_visite_data,
        termine_richieste_visite_ora: aiAnnuncio.termine_richieste_visite_ora,
        data_termine_deposito: aiAnnuncio.data_termine_deposito,
        ora_termine_deposito: aiAnnuncio.ora_termine_deposito,
        descrizione: aiAnnuncio.descrizione,
        provvigione_percentuale,
      },
      {
        file_pdf: aiProposta.file_pdf,
        proponente: aiProposta.proponente,
        indirizzo_immobile: aiProposta.indirizzo_immobile,
        descrizione_immobile: aiProposta.descrizione_immobile,
        prezzo_offerto: aiProposta.prezzo_offerto,
        deposito_cauzionale: aiProposta.deposito_cauzionale,
        cauzione_percentuale: aiProposta.cauzione_percentuale,
        iban_beneficiario: aiProposta.iban_beneficiario,
        bic_cauzione: aiProposta.bic_cauzione,
        beneficiario_cauzione: aiProposta.beneficiario_cauzione,
        irrevocabile_giorni: aiProposta.irrevocabile_giorni,
        rogito_entro_giorni: aiProposta.rogito_entro_giorni,
        catasto: aiProposta.catasto,
        luogo_redazione: aiProposta.luogo_redazione,
        data_redazione: aiProposta.data_redazione,
        anno_redazione: aiProposta.anno_redazione,
      }
    );

    if (geocoded) {
      if (geocoded.indirizzo) merged.immobile.indirizzo = geocoded.indirizzo;
      if (geocoded.comune) merged.immobile.comune = geocoded.comune;
      if (geocoded.cap) merged.immobile.cap = geocoded.cap;
      if (geocoded.provincia) merged.immobile.provincia = geocoded.provincia;
    }

    merged.deposito = merged.deposito || {};
    merged.deposito.data_termine_deposito =
      merged.deposito.data_termine_deposito ?? data_termine_deposito;
    merged.deposito.ora_termine_deposito =
      merged.deposito.ora_termine_deposito ?? ora_termine_deposito;
    merged.gara.data_gara = data_gara;
    merged.gara.ora_inizio = merged.gara.ora_inizio || ora_gara_inizio;
    merged.gara.ora_fine = merged.gara.ora_fine || ora_gara_fine;
    merged.data_apertura_pubblicazione = data_apertura_pubblicazione;
    merged.codice_pratica = codice_pratica;
    if (merged.redazione) {
      merged.redazione.data = data_redazione_oggi;
      merged.redazione.anno = anno_redazione_oggi;
    }

    // Default numerici a 0 se mancanti
    ensureNumberDefaults(merged.gara, ["offerta_minima", "offerta_minima_ammissibile", "rilancio_minimo"]);
    ensureNumberDefaults(merged.deposito, ["deposito_cauzionale"]);
    ensureNumberDefaults(merged.termini, ["irrevocabile_giorni", "rogito_entro_giorni"]);
    ensureNumberDefaults(merged.redazione, ["anno"]);

    // Output date in formato testuale italiano ("10 dicembre 2025")
    const formatDateFields = (obj, keys) => {
      keys.forEach((k) => {
        if (obj && obj[k]) obj[k] = toItalianTextDate(obj[k]);
      });
    };

    formatDateFields(merged.gara, ["data", "data_gara", "data_vendita"]);
    formatDateFields(merged.asta, ["data"]);
    formatDateFields(merged.visite, ["termine_data"]);
    formatDateFields(merged.deposito, ["data_termine_deposito"]);
    formatDateFields(merged.redazione, ["data"]);
    merged.data_apertura_pubblicazione = toItalianTextDate(merged.data_apertura_pubblicazione);

    // Formatta importi come stringhe italiane 0.000,00
    const formatMoneyFields = (obj, keys) => {
      keys.forEach((k) => {
        if (obj && obj[k] !== undefined) obj[k] = formatMoneyIT(obj[k]);
      });
    };
    formatMoneyFields(merged.gara, ["offerta_minima", "offerta_minima_ammissibile", "rilancio_minimo"]);
    formatMoneyFields(merged.deposito, ["deposito_cauzionale"]);

    // Sostituisci i null residui con stringa vuota
    replaceNullishWithEmptyString(merged);

    const responsePayload = { ok: true, codice_pratica: codice_pratica || "", merged };
    await updateProcessingEvent(
      processingEvent.id,
      {
        status: "completed",
        result: responsePayload,
      },
      {
        message: "Processing completed",
        data: {
          codice_pratica: responsePayload.codice_pratica,
        },
      }
    );

    res.json(responsePayload);
  } catch (error) {
    console.error("[callAI] error", error);
    if (processingEvent?.id) {
      await updateProcessingEvent(
        processingEvent.id,
        {
          status: "failed",
          error: {
            message: error.message || String(error),
            stack: error.stack || null,
          },
        },
        {
          level: "error",
          message: "Processing failed",
        }
      );
    }
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

export function startServer(port = process.env.PORT || 3000) {
  return app.listen(port, () => console.log(`Server up on http://localhost:${port}`));
}

export { app };

const executedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (executedUrl === import.meta.url) {
  startServer();
}
