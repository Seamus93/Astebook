import { createHmac, timingSafeEqual } from "node:crypto";

import { escapeHtml } from "../lib/html.js";

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

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function adminLoginPage({ errorMessage = "", infoMessage = "", mode = "login", username = "", recovery = null } = {}) {
  const isSetup = mode === "setup";
  const title = isSetup ? "Crea admin Astebook" : "Accedi ad Astebook";
  const subtitle = isSetup
    ? "Configura il primo accesso runtime per proteggere la console."
    : "Console riservata per pipeline, mailbox e log operativi.";
  const errorHtml = errorMessage
    ? `<div class="notice notice-error" role="alert">${escapeHtml(errorMessage)}</div>`
    : "";
  const infoHtml = infoMessage
    ? `<div class="notice notice-info" role="status">${escapeHtml(infoMessage)}</div>`
    : "";
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
      :root {
        color-scheme: light;
        --accent: #c4005a;
        --accent-soft: #fff1f7;
        --bad: #c62828;
        --line: #ececec;
        --line-strong: #d8d8dc;
        --muted: #70707a;
        --text: #111111;
        --shadow: 0 18px 60px rgba(17, 17, 17, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background: #ffffff;
        color: var(--text);
        font-family: "Inter", "Manrope", "Helvetica Neue", Arial, sans-serif;
        letter-spacing: 0;
      }

      .login-page {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr;
      }

      .brand-bar {
        min-height: 72px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding: 14px clamp(20px, 5vw, 48px);
        background: #050505;
        color: #ffffff;
      }

      .brand-title {
        position: relative;
        color: #ffffff;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 29px;
        font-weight: 400;
        line-height: 1;
      }

      .brand-title::after {
        content: "";
        position: absolute;
        left: 3px;
        bottom: 1px;
        width: 10px;
        height: 10px;
        border-left: 3px solid var(--accent);
        transform: skewX(-18deg);
      }

      .brand-meta {
        color: rgba(255, 255, 255, 0.72);
        font-size: 13px;
        font-weight: 750;
      }

      .login-main {
        display: grid;
        grid-template-columns: minmax(0, 0.9fr) minmax(360px, 460px);
        align-items: stretch;
        min-height: 0;
      }

      .context-panel {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 30px;
        padding: clamp(36px, 7vw, 92px);
        border-right: 1px solid var(--line);
        background:
          linear-gradient(180deg, rgba(196, 0, 90, 0.045), transparent 280px),
          #ffffff;
      }

      .context-kicker,
      .form-kicker {
        margin: 0;
        color: var(--accent);
        font-size: 11px;
        font-weight: 850;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }

      .context-panel h1 {
        max-width: 760px;
        margin: 10px 0 0;
        color: #111111;
        font-size: 40px;
        font-weight: 900;
        line-height: 1.08;
      }

      .context-panel p {
        max-width: 620px;
        margin: 14px 0 0;
        color: var(--muted);
        font-size: 16px;
        font-weight: 650;
        line-height: 1.6;
      }

      .status-list {
        display: grid;
        gap: 12px;
        max-width: 580px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .status-list li {
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr);
        align-items: center;
        gap: 14px;
        min-height: 58px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 10px 14px;
        background: #ffffff;
        box-shadow: 0 10px 36px rgba(17, 17, 17, 0.05);
        color: #111111;
        font-size: 14px;
        font-weight: 850;
      }

      .status-list span {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 8px;
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 15px;
        font-weight: 900;
      }

      .form-panel {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: clamp(24px, 5vw, 48px);
        background: #ffffff;
      }

      .login-card {
        width: min(100%, 420px);
      }

      form {
        width: 100%;
        margin: 0;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 28px;
        background: #ffffff;
        box-shadow: var(--shadow);
      }

      h2 {
        margin: 8px 0 8px;
        color: #111111;
        font-size: 30px;
        font-weight: 900;
        line-height: 1.12;
      }

      .subtitle {
        margin: 0 0 22px;
        color: var(--muted);
        font-size: 14px;
        font-weight: 650;
        line-height: 1.5;
      }

      label {
        display: block;
        margin: 16px 0 7px;
        color: #111111;
        font-size: 13px;
        font-weight: 850;
      }

      input {
        width: 100%;
        border: 1px solid #dfdfe4;
        border-radius: 8px;
        padding: 12px 13px;
        background: #ffffff;
        color: #111111;
        font: inherit;
        font-size: 15px;
        outline: 0;
      }

      input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 4px rgba(196, 0, 90, 0.08);
      }

      button {
        width: 100%;
        min-height: 46px;
        border: 1px solid var(--accent);
        border-radius: 8px;
        padding: 12px 14px;
        margin-top: 20px;
        background: var(--accent);
        color: #ffffff;
        font: inherit;
        font-size: 14px;
        font-weight: 900;
        cursor: pointer;
      }

      button:hover {
        background: #a9004e;
        border-color: #a9004e;
      }

      button.secondary {
        margin-top: 14px;
        border-color: #111111;
        background: #ffffff;
        color: #111111;
      }

      button.secondary:hover {
        border-color: var(--accent);
        background: var(--accent-soft);
        color: var(--accent);
      }

      .notice {
        margin: 0 0 14px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 11px 12px;
        font-size: 13px;
        font-weight: 800;
        line-height: 1.45;
      }

      .notice-error {
        border-color: #ffd5d5;
        background: #fff0f0;
        color: var(--bad);
      }

      .notice-info {
        border-color: #dfeee6;
        background: #f5fbf8;
        color: #1f7a4d;
      }

      .hint {
        margin: 14px 0 0;
        color: var(--muted);
        font-size: 13px;
        font-weight: 650;
        line-height: 1.5;
      }

      details {
        margin-top: 22px;
        border-top: 1px solid var(--line);
        padding-top: 16px;
      }

      summary {
        cursor: pointer;
        color: #111111;
        font-size: 13px;
        font-weight: 850;
      }

      summary:hover {
        color: var(--accent);
      }

      .recovery-result {
        display: grid;
        gap: 6px;
        margin-top: 14px;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 12px;
        background: #f7f7f8;
        color: #111111;
        font-size: 13px;
        line-height: 1.45;
      }

      .recovery-result strong {
        color: var(--accent);
      }

      @media (max-width: 880px) {
        .brand-bar {
          min-height: 64px;
        }

        .brand-meta {
          display: none;
        }

        .login-main {
          grid-template-columns: 1fr;
        }

        .context-panel {
          padding: 32px 20px 20px;
          border-right: 0;
          border-bottom: 1px solid var(--line);
        }

        .context-panel h1 {
          font-size: 30px;
        }

        .status-list {
          display: none;
        }

        .form-panel {
          align-items: start;
          padding: 20px;
        }

        form {
          padding: 22px;
        }
      }
    </style>
  </head>
  <body>
    <div class="login-page">
      <header class="brand-bar">
        <div class="brand-title">Astebook</div>
        <div class="brand-meta">Admin Console</div>
      </header>
      <main class="login-main">
        <section class="context-panel" aria-label="Contesto Astebook">
          <div>
            <p class="context-kicker">Real estate automation</p>
            <h1>Backoffice operativo per aste, proposte e documenti.</h1>
            <p>Accesso protetto agli strumenti che leggono mailbox, normalizzano i dati immobiliari e preparano i documenti finali.</p>
          </div>
          <ul class="status-list" aria-label="Aree protette">
            <li><span>01</span>Pipeline email e allegati</li>
            <li><span>02</span>Estrazione AI e OCR</li>
            <li><span>03</span>Log, impostazioni e sicurezza</li>
          </ul>
        </section>
        <section class="form-panel" aria-label="${escapeHtml(title)}">
          <div class="login-card">
            <form method="post" action="${isSetup ? "/setup" : "/login"}">
              <p class="form-kicker">${isSetup ? "Primo accesso" : "Area riservata"}</p>
              <h2>${escapeHtml(title)}</h2>
              <p class="subtitle">${escapeHtml(subtitle)}</p>
              ${errorHtml}
              ${infoHtml}
              <label for="username">Utente</label>
              <input id="username" name="username" autocomplete="username" value="${escapeHtml(username)}" />
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="${isSetup ? "new-password" : "current-password"}" autofocus />
              <button type="submit">${isSetup ? "Crea admin" : "Entra"}</button>
              <p class="hint">${isSetup ? "Il primo utente diventa admin e viene autenticato automaticamente." : "Sessione protetta per UI processing e log operativi."}</p>
              ${
                isSetup
                  ? ""
                  : `<details>
                      <summary>Utente o password dimenticata?</summary>
                      <label for="recoveryEmail">Email</label>
                      <input id="recoveryEmail" name="email" type="email" form="recoveryForm" placeholder="nome@example.com" />
                      <button class="secondary" type="submit" form="recoveryForm">Invia credenziali</button>
                      ${recoveryHtml}
                    </details>`
              }
            </form>
          </div>
        </section>
      </main>
    </div>
    <form id="recoveryForm" method="post" action="/recover-login"></form>
  </body>
</html>`;
}

export function createAdminAuth({
  createRuntimeAdmin,
  getEffectiveSetting,
  getRuntimeAdminPlainPassword,
  getRuntimeAdminUsername,
  hasRuntimeAdmin,
  sendRecoveryEmail,
  verifyRuntimeAdmin,
}) {
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

  async function signAdminSession(username, expiresAt) {
    const secret = await getAdminSessionSecret();
    if (!secret) return "";
    return createHmac("sha256", secret)
      .update(`${username}.${expiresAt}`)
      .digest("hex");
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

  function clearAdminSession(res) {
    res.setHeader(
      "Set-Cookie",
      `${adminCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    );
    res.redirect("/login");
  }

  function registerAdminAuthRoutes(app) {
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

    app.get("/logout", (_req, res) => clearAdminSession(res));
    app.post("/logout", (_req, res) => clearAdminSession(res));
    app.post("/admin/logout", (_req, res) => clearAdminSession(res));
  }

  return {
    createAdminSession,
    getAdminLoginUsername,
    registerAdminAuthRoutes,
    requireAdminSession,
    setAdminSessionCookie,
    verifyAdminSession,
  };
}
