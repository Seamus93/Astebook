import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";

import { cleanEmailBodyForAI } from "./lib/email_cleaner.js";
import { mergeAnnuncioProposta } from "./lib/merge_json.js";
import {
  aiExtractAnnuncio,
  aiExtractCodicePratica,
  aiExtractProposta,
  aiExtractProvvigionePercentuale,
} from "./lib/ai.js";
import { parseDocxBuffer } from "./lib/docx.js";
import { buildDocumentDocx, buildDocumentPdf } from "./lib/document_builder.js";
import { parsePdfBuffer } from "./lib/pdf.js";
import { ocrFileUrlWithPdfApp } from "./lib/pdf_app.js";
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

async function getSmtpSettings() {
  const host = await getEffectiveSetting("SMTP_HOST", "smtp_host");
  const port = await getEffectiveSetting("SMTP_PORT", "smtp_port");
  const secure = await getEffectiveSetting("SMTP_SECURE", "smtp_secure");
  const user = await getEffectiveSetting("SMTP_USER", "smtp_user");
  const password = await getEffectiveSetting("SMTP_PASSWORD", "smtp_password");
  const from = await getEffectiveSetting("SMTP_FROM", "smtp_from");
  return {
    host: String(host || "").trim(),
    port: Number(port || 587),
    secure: String(secure || "").trim().toLowerCase() === "true",
    user: String(user || "").trim(),
    password: String(password || ""),
    from: String(from || "").trim(),
  };
}

async function hasSmtpConfig() {
  const smtp = await getSmtpSettings();
  return Boolean(smtp.host && smtp.from);
}

async function createSmtpTransporter() {
  const smtp = await getSmtpSettings();
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user
      ? {
          user: smtp.user,
          pass: smtp.password || "",
        }
      : undefined,
  });
}

async function sendRecoveryEmail({ to, credentials }) {
  if (!(await hasSmtpConfig())) return false;
  const smtp = await getSmtpSettings();
  const transporter = await createSmtpTransporter();

  await transporter.sendMail({
    from: smtp.from,
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
if (!existsSync(join(reactAdminDir, "index.html"))) {
  console.warn("React admin build not found at frontend/dist; please run 'npm run build' in the frontend folder before deploying.");
}
app.use("/admin", requireAdminSession, express.static(reactAdminDir));
// SPA fallback: serve index.html for any admin route (lets React Router handle client-side routing)
app.get("/admin/*", requireAdminSession, (_req, res) => {
  res.sendFile(join(reactAdminDir, "index.html"));
});

function redactSecret(value) {
  if (!value) return "";
  const str = String(value);
  if (str.length <= 8) return "********";
  return `${str.slice(0, 4)}...${str.slice(-4)}`;
}

function parseEmailRecipients(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateEmailRecipients(recipients) {
  const invalid = recipients.filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (invalid.length) {
    throw new Error(`Destinatari non validi: ${invalid.join(", ")}`);
  }
}

function configIssue(key, label, detail) {
  return { key, label, detail };
}

async function collectPipelineConfigurationIssues() {
  const issues = [];
  const aiApiKey = await getEffectiveSetting("AI_API_KEY", "ai_api_key");
  const aiBaseUrl = await getEffectiveSetting("AI_BASE_URL", "ai_base_url");
  const aiModel = await getEffectiveSetting("AI_MODEL", "ai_model");
  const pdfAppApiKey = await getEffectiveSetting("PDF_APP_API_KEY", "pdf_app_api_key");
  const pdfAppOcrEndpoint = await getEffectiveSetting("PDF_APP_OCR_ENDPOINT", "pdf_app_ocr_endpoint");
  const documentTemplateUrl = await getEffectiveSetting("DOCUMENT_TEMPLATE_URL", "document_template_url");
  const documentSendTo = await getEffectiveSetting("DOCUMENT_SEND_TO", "document_send_to");

  if (process.env.ASTEBOOK_AI_MOCK !== "1" && !String(aiApiKey || "").trim()) {
    issues.push(configIssue("ai_api_key", "AI API Key", "Configura la chiave API per l'analisi AI."));
  }
  if (!String(aiBaseUrl || "").trim()) {
    issues.push(configIssue("ai_base_url", "AI Base URL", "Configura l'endpoint AI."));
  }
  if (!String(aiModel || "").trim()) {
    issues.push(configIssue("ai_model", "AI Model", "Configura il modello AI."));
  }
  if (!String(pdfAppApiKey || "").trim()) {
    issues.push(configIssue("pdf_app_api_key", "PDF-app API Key", "Configura la chiave PDF-app per OCR."));
  }
  if (!String(pdfAppOcrEndpoint || "").trim()) {
    issues.push(configIssue("pdf_app_ocr_endpoint", "PDF-app OCR Endpoint", "Configura l'endpoint OCR PDF-app."));
  }
  if (!String(documentTemplateUrl || "").trim()) {
    issues.push(configIssue("document_template_url", "Template Documento", "Configura il template Google Doc/DOCX per generare il PDF."));
  }

  const recipients = parseEmailRecipients(documentSendTo);
  if (!recipients.length) {
    issues.push(configIssue("document_send_to", "Send to", "Configura almeno un destinatario email."));
  } else {
    try {
      validateEmailRecipients(recipients);
    } catch (error) {
      issues.push(configIssue("document_send_to", "Send to", error.message || String(error)));
    }
  }

  const smtp = await getSmtpSettings();
  if (!smtp.host) {
    issues.push(configIssue("smtp_host", "SMTP Host", "Configura l'host SMTP."));
  }
  if (!smtp.from) {
    issues.push(configIssue("smtp_from", "SMTP From", "Configura il mittente SMTP."));
  }
  if (smtp.user && !smtp.password) {
    issues.push(configIssue("smtp_password", "SMTP Password", "SMTP User e configurato ma manca SMTP Password."));
  }

  return issues;
}

function qualityResponsibility(field) {
  const text = `${field?.field || ""} ${field?.path || ""}`.toLowerCase();
  if (/prezzo|offerta|rilancio/.test(text)) {
    return "Il campo economico non era ben leggibile o non e stato riconosciuto con sufficiente confidenza.";
  }
  if (/iban|bic|banc|beneficiario/.test(text)) {
    return "Il campo bancario non e stato trovato: probabile assenza, scrittura errata o OCR non chiaro.";
  }
  if (/catasto|foglio|particella|mappale|subalterno/.test(text)) {
    return "Il dato catastale non e stato trovato o potrebbe essere stato letto male dal documento sorgente.";
  }
  if (/indirizzo|comune|provincia/.test(text)) {
    return "Il dato immobile non era completo o la formattazione dell'indirizzo non era univoca.";
  }
  if (/data|ora|vendita|deposito/.test(text)) {
    return "Il termine temporale non era presente in modo chiaro o non e stato interpretato correttamente.";
  }
  return "Dato non trovato o non letto con sufficiente affidabilita dal documento sorgente.";
}

function buildDocumentQualityReport(event) {
  const result = event?.result || {};
  const missing = Array.isArray(result.missing_fields)
    ? result.missing_fields
    : Array.isArray(event?.error?.missing_fields)
    ? event.error.missing_fields
    : [];
  const issues = missing.map((field) => ({
    title: field.field || field.path || "Campo mancante",
    detail: field.message || "Dato non trovato o mancante.",
    source: field.expected_file || "Documento sorgente",
    responsibility: qualityResponsibility(field),
  }));

  (Array.isArray(result.notes) ? result.notes : []).forEach((note) => {
    issues.push({
      title: "Nota elaborazione",
      detail: String(note),
      source: "Pipeline Astebook",
      responsibility: /conflitto/i.test(String(note))
        ? "Valori discordanti tra le fonti: serve verifica manuale."
        : "Nota generata durante OCR, parsing o normalizzazione.",
    });
  });

  (Array.isArray(event?.steps) ? event.steps : [])
    .filter((step) => step.level === "error")
    .forEach((step) => {
      issues.push({
        title: step.message || "Errore pipeline",
        detail: step.data?.error || step.data?.reason || "Errore durante elaborazione.",
        source: step.data?.file_name || step.data?.file_pdf || "Pipeline Astebook",
        responsibility: /ocr/i.test(step.message || "")
          ? "OCR non completato o testo non leggibile nel file sorgente."
          : "Analisi automatica non completata: serve controllo manuale.",
      });
    });

  return {
    ok: issues.length === 0,
    issues,
  };
}

function documentEmailSubject(event) {
  const code = event?.result?.codice_pratica || event?.metadata?.zap_run_id || event?.id;
  return `Astebook - Documento procedura ${code}`;
}

function buildDocumentEmailHtml(event, report) {
  const result = event?.result || {};
  const merged = result.merged || {};
  const code = result.codice_pratica || event?.metadata?.zap_run_id || event?.id || "-";
  const address = [merged.immobile?.indirizzo, merged.immobile?.comune, merged.immobile?.provincia]
    .filter((value) => value && String(value).trim())
    .join(", ");
  const issueRows = report.issues.length
    ? report.issues
        .map(
          (issue) => `
            <tr>
              <td>${escapeHtml(issue.title)}</td>
              <td>${escapeHtml(issue.detail)}</td>
              <td>${escapeHtml(issue.source)}</td>
              <td>${escapeHtml(issue.responsibility)}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="4">Nessuna criticita rilevata dalla pipeline automatica.</td></tr>`;

  return `<!doctype html>
<html lang="it">
  <body style="margin:0;background:#f4f5f7;color:#1f2933;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="width:720px;max-width:calc(100vw - 32px);background:#ffffff;border:1px solid #d9dee7;">
            <tr>
              <td style="padding:28px 36px 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-family:Georgia,serif;font-size:34px;color:#202020;">Astebook</td>
                    <td align="right" style="font-size:30px;font-weight:800;color:#111827;">i-resales</td>
                  </tr>
                  <tr>
                    <td style="font-size:10px;color:#6b7280;">IL SISTEMA CHE Cambia il sistema</td>
                    <td></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:10px 36px 24px;">
                <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;line-height:1.45;color:#000;">
                  DISCIPLINARE DI GARA<br />
                  PROCEDURA COMPETITIVA<br />
                  MODALITA' ASTA TELEMATICA
                </div>
                <div style="margin-top:12px;font-size:24px;color:#0070c0;">www.astebook.it</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 36px 28px;">
                <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">In allegato il documento PDF generato per la procedura <strong>${escapeHtml(code)}</strong>.</p>
                <p style="margin:0 0 20px;font-size:14px;color:#4b5563;">${escapeHtml(address || "Immobile non indicato")}</p>
                <h2 style="margin:0 0 10px;font-size:16px;">Report elaborazione automatica</h2>
                <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
                  <thead>
                    <tr style="background:#111827;color:#ffffff;text-align:left;">
                      <th>Campo</th>
                      <th>Esito</th>
                      <th>Fonte attesa</th>
                      <th>Responsabilita probabile</th>
                    </tr>
                  </thead>
                  <tbody>${issueRows}</tbody>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildDocumentEmailText(event, report) {
  const result = event?.result || {};
  const code = result.codice_pratica || event?.metadata?.zap_run_id || event?.id || "-";
  const lines = [`Documento PDF Astebook per procedura ${code}.`, "", "Report elaborazione automatica:"];
  if (!report.issues.length) {
    lines.push("- Nessuna criticita rilevata dalla pipeline automatica.");
  } else {
    report.issues.forEach((issue) => {
      lines.push(`- ${issue.title}: ${issue.detail} Fonte: ${issue.source}. Responsabilita probabile: ${issue.responsibility}`);
    });
  }
  return lines.join("\n");
}

async function sendDocumentEmailForEvent(event, recipients) {
  if (!(await hasSmtpConfig())) {
    throw new Error("SMTP non configurato: imposta SMTP Host e SMTP From.");
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error("Nessun destinatario configurato in Send to.");
  }
  validateEmailRecipients(recipients);

  const pdf = await buildDocumentPdf(event);
  const report = buildDocumentQualityReport(event);
  const code = event.result?.codice_pratica || event.metadata?.zap_run_id || event.id;
  const fileName = `astebook-${code}.pdf`.replace(/[^\w.-]+/g, "_");
  const smtp = await getSmtpSettings();
  const transporter = await createSmtpTransporter();

  await transporter.sendMail({
    from: smtp.from,
    to: recipients,
    subject: documentEmailSubject(event),
    text: buildDocumentEmailText(event, report),
    html: buildDocumentEmailHtml(event, report),
    attachments: [
      {
        filename: fileName,
        content: pdf,
        contentType: "application/pdf",
      },
    ],
  });

  return {
    status: "sent",
    recipients,
    attachment: fileName,
    report,
  };
}

async function autoSendMergedDocumentEmail(eventId) {
  const storedEvent = await getProcessingEvent(eventId);
  if (!storedEvent?.result?.merged) return null;

  const result = storedEvent.result;
  const recipients = parseEmailRecipients(await getEffectiveSetting("DOCUMENT_SEND_TO", "document_send_to"));
  const markResult = async (documentEmail, step) => {
    result.document_email = documentEmail;
    await updateProcessingEvent(eventId, { result }, step);
    return documentEmail;
  };

  if (!recipients.length) {
    return markResult(
      { status: "skipped", reason: "Nessun destinatario configurato in Send to." },
      {
        message: "Automatic document email skipped",
        data: { reason: "missing_recipients" },
      }
    );
  }

  if (!(await hasSmtpConfig())) {
    return markResult(
      { status: "skipped", recipients, reason: "SMTP non configurato: imposta SMTP Host e SMTP From." },
      {
        message: "Automatic document email skipped",
        data: { recipients, reason: "missing_smtp" },
      }
    );
  }

  try {
    const delivery = await sendDocumentEmailForEvent(storedEvent, recipients);
    return markResult(
      {
        status: "sent",
        recipients: delivery.recipients,
        attachment: delivery.attachment,
        report_issues: delivery.report.issues.length,
      },
      {
        message: "Automatic document email sent",
        data: {
          recipients: delivery.recipients,
          attachment: delivery.attachment,
          report_issues: delivery.report.issues.length,
        },
      }
    );
  } catch (error) {
    return markResult(
      {
        status: "failed",
        recipients,
        error: error.message || String(error),
      },
      {
        level: "error",
        message: "Automatic document email failed",
        data: {
          recipients,
          error: error.message || String(error),
        },
      }
    );
  }
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
      ai_api_key: secretValue("AI_API_KEY", "ai_api_key"),
      ai_base_url: secretValue("AI_BASE_URL", "ai_base_url"),
      ai_model: secretValue("AI_MODEL", "ai_model"),
      pdf_app_api_key: secretValue("PDF_APP_API_KEY", "pdf_app_api_key"),
      pdf_app_ocr_endpoint:
        process.env.PDF_APP_OCR_ENDPOINT || settings.pdf_app_ocr_endpoint || "",
      pdf_app_job_endpoint:
        process.env.PDF_APP_JOB_ENDPOINT || settings.pdf_app_job_endpoint || "",
      document_template_url:
        process.env.DOCUMENT_TEMPLATE_URL || settings.document_template_url || "",
      document_send_to:
        process.env.DOCUMENT_SEND_TO || settings.document_send_to || "",
      smtp_host: secretValue("SMTP_HOST", "smtp_host"),
      smtp_port: process.env.SMTP_PORT || settings.smtp_port || "587",
      smtp_secure: process.env.SMTP_SECURE || settings.smtp_secure || "false",
      smtp_user: secretValue("SMTP_USER", "smtp_user"),
      smtp_password: secretValue("SMTP_PASSWORD", "smtp_password"),
      smtp_from: process.env.SMTP_FROM || settings.smtp_from || "",
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
  assignIfFilled("ai_api_key");
  assignIfFilled("ai_base_url");
  assignIfFilled("ai_model");
  assignIfFilled("pdf_app_api_key");
  assignIfFilled("pdf_app_ocr_endpoint");
  assignIfFilled("pdf_app_job_endpoint");
  assignIfFilled("document_template_url");
  assignIfFilled("smtp_host");
  assignIfFilled("smtp_port");
  assignIfFilled("smtp_secure");
  assignIfFilled("smtp_user");
  assignIfFilled("smtp_password");
  assignIfFilled("smtp_from");
  if (Object.prototype.hasOwnProperty.call(body, "document_send_to")) {
    settings.document_send_to = String(body.document_send_to || "").trim();
  }

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
    const result = await runAiExtractionPipeline({
      body,
      files: req.files,
      eventId: event.id,
      source: "zapier.email_activation",
    });
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
    res.status(410).json({
      ok: false,
      error: "Formato legacy non supportato. Usa format=pdf o format=docx con DOCUMENT_TEMPLATE_URL.",
    });
    return;
  }

  if (format === "doc") {
    res.status(410).json({
      ok: false,
      error: "Formato legacy non supportato. Usa format=docx.",
    });
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
    res.status(410).json({
      ok: false,
      error: "Formato legacy non supportato. Usa format=pdf o format=docx.",
    });
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

app.post("/api/v1/processing-events/:id/send-document", requireProcessingUiToken, async (req, res) => {
  const event = await getProcessingEvent(req.params.id);
  if (!event) {
    res.status(404).json({ ok: false, error: "Processing event not found" });
    return;
  }

  if (!(await hasSmtpConfig())) {
    res.status(400).json({ ok: false, error: "SMTP non configurato: imposta SMTP Host e SMTP From." });
    return;
  }

  const bodyRecipients = parseEmailRecipients(req.body?.send_to || req.body?.to);
  const configuredRecipients = parseEmailRecipients(
    await getEffectiveSetting("DOCUMENT_SEND_TO", "document_send_to")
  );
  const recipients = bodyRecipients.length ? bodyRecipients : configuredRecipients;
  if (!recipients.length) {
    res.status(400).json({ ok: false, error: "Nessun destinatario configurato in Send to." });
    return;
  }

  try {
    validateEmailRecipients(recipients);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || String(error) });
    return;
  }

  try {
    const delivery = await sendDocumentEmailForEvent(event, recipients);

    await updateProcessingEvent(event.id, {}, {
      message: "Document email sent",
      data: {
        recipients: delivery.recipients,
        attachment: delivery.attachment,
        report_issues: delivery.report.issues.length,
      },
    });

    res.json({
      ok: true,
      recipients: delivery.recipients,
      attachment: delivery.attachment,
      report: delivery.report,
    });
  } catch (error) {
    await updateProcessingEvent(event.id, {}, {
      level: "error",
      message: "Document email failed",
      data: {
        recipients,
        error: error.message || String(error),
      },
    });
    res.status(500).json({
      ok: false,
      error: "Invio documento fallito.",
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

  const configurationIssues = await collectPipelineConfigurationIssues();
  if (configurationIssues.length) {
    res.status(400).json({
      ok: false,
      error: "Non sono state configurate queste cose",
      missing_configuration: configurationIssues,
    });
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
  const result = await runAiExtractionPipeline({
    body,
    files: [],
    eventId: event.id,
    source: event.source || "zapier.email_activation",
  });
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
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

function normalizeDirectCodicePratica(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s*([-_])\s*/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .toUpperCase();
  return normalized || null;
}

function directCodicePraticaFromPayload(body) {
  return normalizeDirectCodicePratica(
    firstBodyValue(body, ["codice_pratica", "codicePratica", "practice_code", "practiceCode", "sigla"])
  );
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

function resolvePropostaText(body) {
  return String(
    firstBodyValue(body, [
      "proposta_ocr",
      "proposta_text",
      "proposta_ocr_text",
      "ocr_text",
    ]) || ""
  );
}

function resolveProvvigioneText(body) {
  return String(
    firstBodyValue(body, [
      "provvigione_ocr",
      "provvigione_ocr_text",
      "provvigione_text",
    ]) || ""
  );
}

export function normalizeEmailTextForExtraction(text) {
  return cleanEmailBodyForAI(text);
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

function comparableText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(via|viale|piazza|corso|largo|vicolo|strada|piazzale|vico|borgo)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function addSourceConflictNotes(result) {
  const annuncioAddress = result.extracted?.annuncio?.indirizzo;
  const propostaAddress = result.extracted?.proposta?.indirizzo_immobile;
  if (
    !isMissingValue(annuncioAddress) &&
    !isMissingValue(propostaAddress) &&
    comparableText(annuncioAddress) !== comparableText(propostaAddress)
  ) {
    addUniqueNote(
      result,
      `Conflitto indirizzo: Annuncio "${annuncioAddress}" diverso da Proposta "${propostaAddress}".`
    );
  }
}

function propostaSourcePriority(proposta) {
  const source = String(proposta?.source_format || proposta?.file_pdf || "").toLowerCase();
  if (/pdf|image|png|jpe?g|tiff?|bmp|heic/.test(source)) return 20;
  if (/docx|document/.test(source)) return 10;
  return 0;
}

export function mergeExtractedProposta(current, next) {
  if (!current) return next;
  if (!next) return current;

  const currentPriority = propostaSourcePriority(current);
  const nextPriority = propostaSourcePriority(next);
  const nextWins = nextPriority > currentPriority;
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
  if (nextWins) {
    merged.file_pdf = next.file_pdf || merged.file_pdf;
    merged.source_format = next.source_format || merged.source_format;
  }
  const currentVoci = Array.isArray(current.catasto_voci)
    ? current.catasto_voci
    : Array.isArray(current.catasto?.voci)
    ? current.catasto.voci
    : [];
  const nextVoci = Array.isArray(next.catasto_voci)
    ? next.catasto_voci
    : Array.isArray(next.catasto?.voci)
    ? next.catasto.voci
    : [];
  const mergedVoci = nextWins
    ? mergeCatastoVoci(nextVoci, currentVoci)
    : mergeCatastoVoci(currentVoci, nextVoci);
  if (mergedVoci.length) {
    merged.catasto.voci = mergedVoci;
    merged.catasto_voci = mergedVoci;
  }

  const mergeValue = (key) => {
    if (!isMissingValue(next[key]) && (isMissingValue(merged[key]) || nextWins)) merged[key] = next[key];
  };
  const mergeNestedValue = (parent, key) => {
    if (!isMissingValue(next[parent]?.[key]) && (isMissingValue(merged[parent]?.[key]) || nextWins)) {
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
    "data_termine_offerta",
    "ora_termine_offerta",
    "data_termine_deposito",
    "ora_termine_deposito",
  ].forEach(mergeValue);
  ["nominativo", "telefono", "cellulare", "documento"].forEach((key) => mergeNestedValue("proponente", key));
  ["foglio", "particella", "subalterno", "sezione", "categoria"].forEach((key) => mergeNestedValue("catasto", key));

  return merged;
}

function mergeCatastoVoci(primary = [], fallback = []) {
  const merged = [];
  const add = (voce) => {
    if (!voce || typeof voce !== "object") return;
    const key = [voce.foglio, voce.mappale || voce.particella, voce.subalterno, voce.sezione, voce.categoria]
      .map((value) => String(value || "").trim().toLowerCase())
      .join("|");
    if (!key.replace(/\|/g, "")) return;
    if (!merged.some((item) => item.key === key)) merged.push({ key, voce });
  };
  primary.forEach(add);
  fallback.forEach(add);
  return merged.map((item) => item.voce);
}

function finalizeZapierResult(result) {
  addSourceConflictNotes(result);
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
    return !clean || clean === "-" || /^[…._\s”")/]+$/.test(clean);
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

function isPngAttachment(attachment) {
  const mime = String(attachment.mime_type || "").toLowerCase();
  const fileName = String(attachment.file_name || "").toLowerCase();
  return mime === "image/png" || fileName.endsWith(".png");
}

function isImageAttachment(attachment) {
  if (isPngAttachment(attachment)) return false;
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
    supported_by_extraction:
      !isPngAttachment({ file_name: fileName, mime_type: mimeType }) &&
      (isPdfAttachment({
        file_name: fileName,
        mime_type: mimeType,
      }) ||
        isDocxAttachment({ file_name: fileName, mime_type: mimeType }) ||
        isImageAttachment({ file_name: fileName, mime_type: mimeType })),
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
  if (isPngAttachment(attachment)) return "png";
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

async function runAiExtractionPipeline({ body = {}, files = [], eventId, source = "zapier.email_activation" }) {
  const event = { id: eventId };
  const emailText = resolveEmailText(body);
  const initialCodicePratica = directCodicePraticaFromPayload(body) || "";
  const attachmentInputs = collectZapierAttachments(body, files);
  const attachments = attachmentInputs.map(({ buffer, ...safeDescriptor }) => safeDescriptor);
  const result = {
    ok: true,
    mode: "ai_extraction_pipeline",
    source,
    ready_for_zapier: false,
    codice_pratica: initialCodicePratica,
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
      message: "Payload normalized for AI extraction",
      data: {
        attachment_count: attachments.length,
        initially_supported_count: attachments.filter((attachment) => attachment.supported_by_extraction).length,
      },
    }
  );

  const emailAnnouncementText = cleanEmailBodyForAI(emailText);
  // persist original and cleaned bodies in the result so UI can display them
  result.email = result.email || {};
  result.email.original_body = String(emailText || "");
  result.email.cleaned_body = String(emailAnnouncementText || "");
  await updateProcessingEvent(event.id, { result }, { message: "Email body cleaned for AI" });
  if (!result.codice_pratica) {
    const codiceAi = await extractCodicePraticaAiOnly({
      text: [
        firstBodyValue(body, ["subject", "email_subject", "oggetto"]),
        emailAnnouncementText,
      ].filter(Boolean).join("\n"),
      fileName: "Oggetto e corpo email",
      eventId: event.id,
      result,
    });
    result.codice_pratica = codiceAi || "";
  }

  if (emailAnnouncementText) {
    const emailAnnouncement = await extractAnnuncioAiFirst({
      text: emailAnnouncementText,
      fileName: "Corpo email",
      eventId: event.id,
      result,
      fallbackMessage: "Email body announcement local fallback completed",
    });
    if (hasUsefulAnnuncioData(emailAnnouncement)) {
      result.extracted.annuncio = emailAnnouncement;
      await updateProcessingEvent(event.id, { result }, {
        message: "Email body announcement extracted",
        data: emailAnnouncement,
      });
    }
  }

  const bodyPropostaText = resolvePropostaText(body);
  if (bodyPropostaText.trim()) {
    const fileName = firstBodyValue(body, ["proposta_name", "proposta_file_name"]) || "Proposta OCR body.txt";
    const extractedProposta = await extractPropostaAiFirst({
      text: bodyPropostaText,
      fileName,
      eventId: event.id,
      result,
    });
    extractedProposta.source_format = "text";
    result.extracted.proposta = mergeExtractedProposta(result.extracted.proposta, extractedProposta);
    await updateProcessingEvent(event.id, { result }, {
      message: "Proposal body OCR extracted",
      data: extractedProposta,
    });
  }

  const bodyProvvigioneText = resolveProvvigioneText(body);
  if (bodyProvvigioneText.trim()) {
    const provvigionePercentuale = await extractProvvigioneAiFirst({
      text: bodyProvvigioneText,
      fileName: "Provvigione OCR body.txt",
      eventId: event.id,
      result,
    });
    result.extracted.provvigione = {
      file_pdf: "Provvigione OCR body.txt",
      provvigione_percentuale: provvigionePercentuale,
      raw_length: bodyProvvigioneText.length,
    };
    await updateProcessingEvent(event.id, { result }, {
      message: "Commission body OCR extracted",
      data: result.extracted.provvigione,
    });
  }

  if (attachmentInputs.length === 0 && !bodyPropostaText.trim() && !bodyProvvigioneText.trim()) {
    result.notes.push("Nessun allegato trovato nel payload ricevuto.");
    finalizeZapierResult(result);
    await updateProcessingEvent(
      event.id,
      {
        result,
        error: buildMissingFieldsError(result),
      },
      {
        message: "No supported AI extraction input found",
        data: {
          accepted_formats: [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image/jpeg",
            "image/tiff",
            "image/bmp",
            "image/heic",
            "image/webp",
          ],
          received_files: attachments.map((attachment) => ({
            file_name: attachment.file_name,
            mime_type: attachment.mime_type,
          })),
        },
      }
    );
    return result;
  }

  await updateProcessingEvent(event.id, { status: "extracting" }, { message: "AI extraction started" });

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
      supported_by_extraction: ["pdf", "docx", "image"].includes(resolvedAttachment.format),
      format: resolvedAttachment.format,
    };
    const existingIndex = result.attachments.findIndex(
      (item) => item.url === safeDescriptor.url || item.file_name === attachment.file_name
    );
    if (existingIndex >= 0) result.attachments[existingIndex] = safeDescriptor;

    if (resolvedAttachment.kind === "ignored") {
      continue;
    }

    if (resolvedAttachment.format === "png") {
      addUniqueNote(result, `${resolvedAttachment.file_name}: PNG escluso da OCR e analisi AI.`);
      continue;
    }

    if (!["pdf", "docx", "image"].includes(resolvedAttachment.format)) {
      result.notes.push(`Formato non supportato: ${resolvedAttachment.file_name}`);
      continue;
    }

    try {
      if (resolvedAttachment.kind === "provvigione") {
        const attachmentText = await extractAttachmentText(resolvedAttachment, event.id, result);
        const provvigionePercentuale = await extractProvvigioneAiFirst({
          text: attachmentText,
          fileName: resolvedAttachment.file_name,
          eventId: event.id,
          result,
        });
        result.extracted.provvigione = {
          file_pdf: resolvedAttachment.file_name,
          provvigione_percentuale: provvigionePercentuale,
          raw_length: attachmentText.length,
        };
        await updateProcessingEvent(event.id, { result }, {
          message: "Commission extracted",
          data: result.extracted.provvigione,
        });
        continue;
      }

      if (resolvedAttachment.kind === "proposta") {
        const attachmentText = await extractAttachmentText(resolvedAttachment, event.id, result);
        const extractedProposta = await extractPropostaAiFirst({
          text: attachmentText,
          fileName: resolvedAttachment.file_name,
          eventId: event.id,
          result,
        });
        extractedProposta.source_format = resolvedAttachment.format;

        result.extracted.proposta = mergeExtractedProposta(result.extracted.proposta, extractedProposta);
        await updateProcessingEvent(event.id, { result }, {
          message: "Proposal extracted",
          data: extractedProposta,
        });
        continue;
      }

      if (resolvedAttachment.kind === "annuncio") {
        const attachmentText = await extractAttachmentText(resolvedAttachment, event.id, result);
        result.extracted.annuncio = await extractAnnuncioAiFirst({
          text: attachmentText,
          fileName: resolvedAttachment.file_name,
          eventId: event.id,
          result,
          fallbackMessage: "Auction announcement local fallback completed",
        });
        if (
          isMissingValue(result.extracted.annuncio.provvigione_percentuale) &&
          !isMissingValue(result.extracted.provvigione?.provvigione_percentuale)
        ) {
          result.extracted.annuncio.provvigione_percentuale = result.extracted.provvigione.provvigione_percentuale;
          result.extracted.annuncio.provvigione_source = result.extracted.provvigione.file_pdf;
        }
        if (!result.codice_pratica) {
          result.codice_pratica = await extractCodicePraticaAiOnly({
            text: attachmentText,
            fileName: resolvedAttachment.file_name,
            eventId: event.id,
            result,
          }) || "";
        }
        await updateProcessingEvent(event.id, { result }, {
          message: "Auction announcement extracted",
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
  result.merged = await buildMergedFromExtractionResult(result);
  result.zapier_response.merged = result.merged;
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
        ? "AI extraction completed"
        : "AI extraction completed with missing data",
      data: {
        ready_for_zapier: result.ready_for_zapier,
      },
    }
  );

  await autoSendMergedDocumentEmail(event.id);
  const finalEvent = await getProcessingEvent(event.id);

  return finalEvent?.result || result;
}

async function extractAnnuncioAiFirst({ text, fileName, eventId, result, fallbackMessage }) {
  try {
    return await aiExtractAnnuncio({ text, fileName });
  } catch (error) {
    await updateProcessingEvent(eventId, {}, {
      level: "error",
      message: "Announcement AI extraction failed",
      data: {
        file_name: fileName,
        error: error.message || String(error),
      },
    });
    addUniqueNote(result, `${fileName}: AI annuncio fallita (${error.message || String(error)})`);
    throw error;
  }
}

async function extractPropostaAiFirst({ text, fileName, eventId, result }) {
  try {
    return await aiExtractProposta({ text, fileName });
  } catch (error) {
    await updateProcessingEvent(eventId, {}, {
      level: "error",
      message: "Proposal AI extraction failed",
      data: {
        file_name: fileName,
        error: error.message || String(error),
      },
    });
    addUniqueNote(result, `${fileName}: AI proposta fallita (${error.message || String(error)})`);
    throw error;
  }
}

async function extractProvvigioneAiFirst({ text, fileName, eventId, result }) {
  try {
    const ai = await aiExtractProvvigionePercentuale({ text, fileName });
    return typeof ai?.provvigione_percentuale === "number" ? ai.provvigione_percentuale : null;
  } catch (error) {
    await updateProcessingEvent(eventId, {}, {
      level: "error",
      message: "Commission AI extraction failed",
      data: {
        file_name: fileName,
        error: error.message || String(error),
      },
    });
    addUniqueNote(result, `${fileName}: AI provvigione fallita (${error.message || String(error)})`);
    throw error;
  }
}

async function extractCodicePraticaAiOnly({ text, fileName, eventId, result }) {
  if (!String(text || "").trim()) return null;
  try {
    const ai = await aiExtractCodicePratica({ text, fileName });
    return ai?.codice_pratica || null;
  } catch (error) {
    await updateProcessingEvent(eventId, {}, {
      level: "error",
      message: "Practice code AI extraction failed",
      data: {
        file_name: fileName,
        error: error.message || String(error),
      },
    });
    addUniqueNote(result, `${fileName}: AI codice pratica fallita (${error.message || String(error)})`);
    return null;
  }
}

async function buildMergedFromExtractionResult(result) {
  const annuncio = result.extracted?.annuncio || {};
  const proposta = result.extracted?.proposta || {};
  const provvigioneFromFile = result.extracted?.provvigione?.provvigione_percentuale;

  if (proposta.iban_beneficiario) {
    const { bic, bank } = await fetchIbanInfo(proposta.iban_beneficiario);
    if (!proposta.bic_cauzione) proposta.bic_cauzione = bic;
    if (!proposta.beneficiario_cauzione) proposta.beneficiario_cauzione = bank;
  }

  const addressCandidate = proposta.indirizzo_immobile || annuncio.indirizzo || null;
  const geocoded = await geocodeAddress(addressCandidate);

  const dataAperturaPubblicazione = computeDataAperturaPubblicazione();
  const dataRedazioneOggi = formatLocalISODate(new Date());
  const annoRedazioneOggi = new Date().getFullYear();
  const dataTermineDepositoRaw =
    annuncio.data_termine_deposito || proposta.data_termine_deposito || proposta.data_termine_offerta || null;
  const dataTermineDepositoISO = toISOFromITDate(dataTermineDepositoRaw);
  const dataGaraAnnuncioISO = toISOFromITDate(annuncio.data_vendita);
  let dataTermineDeposito = dataTermineDepositoISO || dataTermineDepositoRaw || null;
  let dataGara = null;

  if (dataTermineDepositoISO) {
    dataGara = shiftISOToNextBusinessDay(addDaysToISODate(dataTermineDepositoISO, 3));
  } else if (dataGaraAnnuncioISO) {
    dataGara = dataGaraAnnuncioISO;
    if (!dataTermineDeposito) dataTermineDeposito = addDaysToISODate(dataGaraAnnuncioISO, -3);
  }

  const provvigionePercentuale =
    typeof provvigioneFromFile === "number" && provvigioneFromFile > 0
      ? provvigioneFromFile
      : typeof annuncio.provvigione_percentuale === "number" && annuncio.provvigione_percentuale > 0
      ? annuncio.provvigione_percentuale
      : 3;
  const offertaMinima = annuncio.offerta_minima ?? annuncio.prezzo_base ?? null;

  const merged = mergeAnnuncioProposta(
    {
      file_pdf: annuncio.file_pdf,
      indirizzo: annuncio.indirizzo,
      data_vendita: annuncio.data_vendita,
      ora_vendita: annuncio.ora_vendita,
      prezzo_base: annuncio.prezzo_base,
      offerta_minima: offertaMinima,
      rilancio_minimo: annuncio.rilancio_minimo || 1000,
      offerta_minima_ammissibile:
        offertaMinima != null ? Number(offertaMinima) + 1000 : null,
      stato: annuncio.stato,
      ora_gara_inizio: annuncio.ora_gara_inizio,
      ora_gara_fine: annuncio.ora_gara_fine,
      termine_richieste_visite_data: annuncio.termine_richieste_visite_data,
      termine_richieste_visite_ora: annuncio.termine_richieste_visite_ora,
      data_termine_deposito: annuncio.data_termine_deposito,
      ora_termine_deposito: annuncio.ora_termine_deposito,
      descrizione: annuncio.descrizione,
      provvigione_percentuale: provvigionePercentuale,
    },
    {
      file_pdf: proposta.file_pdf,
      proponente: proposta.proponente,
      indirizzo_immobile: proposta.indirizzo_immobile,
      descrizione_immobile: proposta.descrizione_immobile,
      prezzo_offerto: proposta.prezzo_offerto,
      deposito_cauzionale: proposta.deposito_cauzionale,
      cauzione_percentuale: proposta.cauzione_percentuale || proposta.deposito_cauzionale_percentuale,
      iban_beneficiario: proposta.iban_beneficiario,
      bic_cauzione: proposta.bic_cauzione,
      beneficiario_cauzione: proposta.beneficiario_cauzione,
      irrevocabile_giorni: proposta.irrevocabile_giorni,
      rogito_entro_giorni: proposta.rogito_entro_giorni,
      catasto: proposta.catasto,
      luogo_redazione: proposta.luogo_redazione,
      data_redazione: proposta.data_redazione,
      anno_redazione: proposta.anno_redazione,
    }
  );

  if (geocoded) {
    if (geocoded.indirizzo) merged.immobile.indirizzo = geocoded.indirizzo;
    if (geocoded.comune) merged.immobile.comune = geocoded.comune;
    if (geocoded.cap) merged.immobile.cap = geocoded.cap;
    if (geocoded.provincia) merged.immobile.provincia = geocoded.provincia;
  }

  merged.deposito = merged.deposito || {};
  merged.deposito.data_termine_deposito = merged.deposito.data_termine_deposito ?? dataTermineDeposito;
  merged.deposito.ora_termine_deposito =
    merged.deposito.ora_termine_deposito ?? annuncio.ora_termine_deposito ?? proposta.ora_termine_deposito;
  merged.gara.data_gara = dataGara;
  merged.gara.ora_inizio = merged.gara.ora_inizio || annuncio.ora_gara_inizio || "09:00";
  merged.gara.ora_fine = merged.gara.ora_fine || annuncio.ora_gara_fine || "12:00";
  merged.data_apertura_pubblicazione = dataAperturaPubblicazione;
  merged.codice_pratica = result.codice_pratica || "";
  if (merged.redazione) {
    merged.redazione.data = dataRedazioneOggi;
    merged.redazione.anno = annoRedazioneOggi;
  }

  ensureNumberDefaults(merged.gara, ["offerta_minima", "offerta_minima_ammissibile", "rilancio_minimo"]);
  ensureNumberDefaults(merged.deposito, ["deposito_cauzionale"]);
  ensureNumberDefaults(merged.termini, ["irrevocabile_giorni", "rogito_entro_giorni"]);
  ensureNumberDefaults(merged.redazione, ["anno"]);

  formatMergedOutput(merged);
  replaceNullishWithEmptyString(merged);
  return merged;
}

function formatMergedOutput(merged) {
  const formatDateFields = (obj, keys) => {
    keys.forEach((key) => {
      if (obj && obj[key]) obj[key] = toItalianTextDate(obj[key]);
    });
  };
  const formatMoneyFields = (obj, keys) => {
    keys.forEach((key) => {
      if (obj && obj[key] !== undefined) obj[key] = formatMoneyIT(obj[key]);
    });
  };

  formatDateFields(merged.gara, ["data", "data_gara", "data_vendita"]);
  formatDateFields(merged.asta, ["data"]);
  formatDateFields(merged.visite, ["termine_data"]);
  formatDateFields(merged.deposito, ["data_termine_deposito"]);
  formatDateFields(merged.redazione, ["data"]);
  merged.data_apertura_pubblicazione = toItalianTextDate(merged.data_apertura_pubblicazione);

  formatMoneyFields(merged.gara, ["offerta_minima", "offerta_minima_ammissibile", "rilancio_minimo"]);
  formatMoneyFields(merged.deposito, ["deposito_cauzionale"]);
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

    const result = await runAiExtractionPipeline({
      body,
      files: req.files,
      eventId: processingEvent.id,
      source: "callAI",
    });

    res.json({
      ok: result.ok,
      event_id: processingEvent.id,
      codice_pratica: result.codice_pratica || "",
      merged: result.merged,
      result,
    });
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
