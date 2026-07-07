import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const configFile = process.env.APP_CONFIG_FILE || join(runtimeDir, "app-config.json");

const defaultConfig = {
  admin: null,
  settings: {
    processing_ui_token: "",
    zapier_webhook_token: "",
    admin_session_secret: "",
    ai_api_key: "",
    ai_base_url: "https://openrouter.ai/api/v1",
    ai_model: "openai/gpt-4o-mini",
    pdf_app_api_key: "",
    pdf_app_ocr_endpoint: "",
    pdf_app_job_endpoint: "",
    document_template_url: "",
  },
};

async function ensureConfigFile() {
  await mkdir(runtimeDir, { recursive: true });
  if (!existsSync(configFile)) {
    await writeConfig(defaultConfig);
  }
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHash] = String(storedHash || "").split(":");
  if (!salt || !expectedHash) return false;
  const actualHash = hashPassword(password, salt).split(":")[1];
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const actualBuffer = Buffer.from(actualHash, "hex");
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export async function readConfig() {
  await ensureConfigFile();
  const raw = await readFile(configFile, "utf8");
  const parsed = raw.trim() ? JSON.parse(raw) : {};
  return {
    ...defaultConfig,
    ...parsed,
    settings: {
      ...defaultConfig.settings,
      ...(parsed.settings || {}),
    },
  };
}

export async function writeConfig(config) {
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function hasRuntimeAdmin() {
  const config = await readConfig();
  return Boolean(config.admin?.username && config.admin?.password_hash);
}

export async function createRuntimeAdmin({ username, password }) {
  const config = await readConfig();
  if (config.admin?.username) {
    throw new Error("Admin gia configurato.");
  }
  if (!username || !password) {
    throw new Error("Username e password sono obbligatori.");
  }

  config.admin = {
    username,
    password_hash: hashPassword(password),
    password_plain: String(password),
    created_at: new Date().toISOString(),
  };
  if (!config.settings.admin_session_secret) {
    config.settings.admin_session_secret = randomBytes(32).toString("hex");
  }

  await writeConfig(config);
  return config.admin;
}

export async function verifyRuntimeAdmin({ username, password }) {
  const config = await readConfig();
  if (!config.admin?.username || !config.admin?.password_hash) return false;
  return username === config.admin.username && verifyPassword(password, config.admin.password_hash);
}

export async function getRuntimeSettings() {
  const config = await readConfig();
  return config.settings;
}

export async function getRuntimeAdminUsername() {
  const config = await readConfig();
  return config.admin?.username || null;
}

export async function getRuntimeAdminPlainPassword() {
  const config = await readConfig();
  return config.admin?.password_plain || null;
}

export async function updateRuntimeSettings(input) {
  const config = await readConfig();
  config.settings = {
    ...config.settings,
    ...Object.fromEntries(
      Object.entries(input.settings || {}).filter(([, value]) => value !== undefined)
    ),
  };

  if (input.admin_password) {
    if (!config.admin?.username) {
      throw new Error("Admin non configurato.");
    }
    config.admin.password_hash = hashPassword(input.admin_password);
    config.admin.password_plain = String(input.admin_password);
    config.admin.updated_at = new Date().toISOString();
  }

  await writeConfig(config);
  return config;
}

export async function getEffectiveSetting(envName, runtimeName) {
  if (process.env[envName]) return process.env[envName];
  const settings = await getRuntimeSettings();
  return settings[runtimeName] || "";
}
