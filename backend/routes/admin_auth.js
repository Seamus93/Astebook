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
