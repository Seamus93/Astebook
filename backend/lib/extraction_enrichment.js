import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getEffectiveSetting } from "./app_config.js";
import { formatMoneyIT, toItalianTextDate } from "./format_utils.js";

const runtimeDir = process.env.RUNTIME_DIR || join(process.cwd(), "runtime");
const geocodeCacheFile = process.env.GEOCODE_CACHE_FILE || join(runtimeDir, "geocode-cache.json");
let lastNominatimRequestAt = 0;

export function formatMergedOutput(merged) {
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

export async function fetchIbanInfo(iban) {
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

async function readGeocodeCache() {
  await mkdir(runtimeDir, { recursive: true });
  if (!existsSync(geocodeCacheFile)) {
    await writeFile(geocodeCacheFile, "{}\n", "utf8");
  }
  try {
    const raw = await readFile(geocodeCacheFile, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

async function writeGeocodeCache(cache) {
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(geocodeCacheFile, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function cacheKey(provider, address) {
  return `${provider}:${String(address || "").trim().toLowerCase()}`;
}

async function geocodeWithCache(provider, address, resolver) {
  const cache = (await readGeocodeCache()) || {};
  const key = cacheKey(provider, address);
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
  const result = await resolver();
  cache[key] = result || null;
  await writeGeocodeCache(cache);
  return cache[key];
}

async function throttleNominatim() {
  const elapsed = Date.now() - lastNominatimRequestAt;
  if (elapsed < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
  }
  lastNominatimRequestAt = Date.now();
}

function provinceCode(value) {
  const clean = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(clean) ? clean : null;
}

function normalizeNominatimResult(item) {
  const addr = item?.address || {};
  const road = addr.road || addr.pedestrian || addr.footway || addr.path || addr.cycleway || addr.suburb || null;
  const houseNumber = addr.house_number || null;
  const comune =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.hamlet ||
    addr.county ||
    null;
  const provinciaRaw = addr.province || addr.county || addr.state_district || null;
  const provinceMatch = String(provinciaRaw || "").match(/\b([A-Z]{2})\b/);
  const provincia = provinceCode(addr["ISO3166-2-lvl6"]?.split("-").pop()) || provinceMatch?.[1] || provinciaRaw;
  const indirizzo = [road, houseNumber].filter(Boolean).join(", ") || null;
  return {
    indirizzo,
    comune,
    cap: addr.postcode || null,
    provincia,
    formatted_address: item?.display_name || null,
    provider: "nominatim",
  };
}

async function geocodeWithNominatim(address) {
  const baseUrl = (await getEffectiveSetting("NOMINATIM_BASE_URL", "nominatim_base_url")) ||
    "https://nominatim.openstreetmap.org";
  const userAgent = (await getEffectiveSetting("NOMINATIM_USER_AGENT", "nominatim_user_agent")) ||
    "Astebook/0.1 (https://astebook.it)";

  return geocodeWithCache("nominatim", address, async () => {
    await throttleNominatim();
    const params = new URLSearchParams({
      q: address,
      format: "jsonv2",
      addressdetails: "1",
      countrycodes: "it",
      limit: "1",
      "accept-language": "it",
    });
    const url = `${String(baseUrl).replace(/\/$/, "")}/search?${params.toString()}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        "Accept-Language": "it",
      },
    });
    if (!resp.ok) throw new Error(`nominatim status ${resp.status}`);
    const data = await resp.json();
    const first = Array.isArray(data) ? data[0] : null;
    return first ? normalizeNominatimResult(first) : null;
  });
}

async function geocodeWithGoogle(address) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  return geocodeWithCache("google", address, async () => {
    const params = new URLSearchParams({
      address,
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
      provider: "google",
    };
  });
}

export async function geocodeAddress(address) {
  if (!address || typeof address !== "string") return null;
  const clean = address.trim();
  if (!clean) return null;
  const provider = String(
    process.env.GEOCODER_PROVIDER ||
      (await getEffectiveSetting("GEOCODER_PROVIDER", "geocoder_provider")) ||
      "nominatim"
  ).toLowerCase();
  try {
    if (provider === "none" || provider === "off" || provider === "false") return null;
    if (provider === "google") return geocodeWithGoogle(clean);
    return geocodeWithNominatim(clean);
  } catch {
    return null;
  }
}
