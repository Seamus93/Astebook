import { formatMoneyIT, toItalianTextDate } from "./format_utils.js";

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

export async function geocodeAddress(address) {
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
