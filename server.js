import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";

import { mergeAnnuncioProposta } from "./lib/merge_json.js";
import { aiExtractAnnuncio, aiExtractProposta, aiExtractProvvigionePercentuale } from "./lib/ai.js";
import { parsePdfBuffer } from "./lib/pdf.js";
import {
  createProcessingEvent,
  getProcessingEvent,
  listProcessingEvents,
  updateProcessingEvent,
} from "./lib/processing_log.js";
import {
  createRuntimeAdmin,
  getEffectiveSetting,
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

function adminLoginPage({ errorMessage = "", mode = "login", username = "admin" } = {}) {
  const errorHtml = errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : "";
  const isSetup = mode === "setup";
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
      .error { color: #b42318; margin: 0 0 12px; }
      .hint { color: #647084; font-size: 13px; margin: 14px 0 0; }
    </style>
  </head>
  <body>
    <form method="post" action="${isSetup ? "/admin/setup" : "/admin/login"}">
      <h1>${isSetup ? "Crea admin Astebook" : "Astebook"}</h1>
      ${errorHtml}
      <label for="username">Utente</label>
      <input id="username" name="username" autocomplete="username" value="${escapeHtml(username)}" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus />
      <button type="submit">${isSetup ? "Crea admin" : "Entra"}</button>
      <p class="hint">${isSetup ? "Il primo utente diventa admin e viene autenticato automaticamente." : "Accesso alla UI processing e ai log operativi."}</p>
    </form>
  </body>
</html>`;
}

async function requireAdminSession(req, res, next) {
  if (await verifyAdminSession(req)) {
    next();
    return;
  }

  if (!(await hasConfiguredAdmin())) {
    res.redirect("/admin/setup");
    return;
  }

  res.redirect("/admin/login");
}

app.get("/admin/setup", async (_req, res) => {
  if (await hasConfiguredAdmin()) {
    res.redirect("/admin/login");
    return;
  }
  res.type("html").send(adminLoginPage({ mode: "setup", username: "admin" }));
});

app.post("/admin/setup", async (req, res) => {
  if (await hasConfiguredAdmin()) {
    res.redirect("/admin/login");
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

app.get("/admin/login", async (_req, res) => {
  if (!(await hasConfiguredAdmin())) {
    res.redirect("/admin/setup");
    return;
  }
  res.type("html").send(adminLoginPage({ username: await getAdminLoginUsername() }));
});

app.post("/admin/login", async (req, res) => {
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

app.post("/admin/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    `${adminCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
  res.redirect("/admin/login");
});

app.use("/admin", requireAdminSession, express.static(join(process.cwd(), "public", "admin")));

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
    },
  });
});

app.post("/api/v1/admin/settings", requireAdminSession, async (req, res) => {
  const body = req.body || {};
  const settings = {};
  if (body.processing_ui_token) settings.processing_ui_token = String(body.processing_ui_token);
  if (body.zapier_webhook_token) settings.zapier_webhook_token = String(body.zapier_webhook_token);
  if (body.admin_session_secret) settings.admin_session_secret = String(body.admin_session_secret);

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
  try {
    const body = Array.isArray(req.body) ? req.body[0] || {} : req.body || {};
    const event = await createProcessingEvent({
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

    res.status(202).json({
      ok: true,
      event_id: event.id,
      status: event.status,
      admin_url: `/admin/#/events/${event.id}`,
    });
  } catch (error) {
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

function normalizeCodicePratica(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .trim()
    .replace(/\s*([-_])\s*/g, "$1")
    .replace(/\s+/g, "")
    .toUpperCase();
  return normalized || null;
}

function isValidCodicePratica(value) {
  const normalized = normalizeCodicePratica(value);
  return normalized ? /^[A-Z]{2,}[-_][A-Z]{2,}[-_]\d{4,}$/.test(normalized) : false;
}

function extractCodicePraticaFromText(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/\b([A-Z]{2,})\s*([-_])\s*([A-Z]{2,})\s*([-_])\s*(\d{4,})\b/i);
  if (!match) return null;
  return normalizeCodicePratica(`${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}`);
}

function resolveCodicePratica(body, emailText) {
  const candidates = [
    body?.codice_pratica,
    body?.codicePratica,
    body?.practice_code,
    body?.practiceCode,
    body?.sigla,
  ];
  const firstValid = candidates.find((candidate) => isValidCodicePratica(candidate));
  if (firstValid) return normalizeCodicePratica(firstValid);
  return extractCodicePraticaFromText(emailText);
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
    const codice_pratica = resolveCodicePratica(body, rawEmailBody);
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
