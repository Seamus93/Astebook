import { getRuntimeSettings } from "./app_config.js";

const DETAIL_URL_RE = /^https?:\/\/(?:www\.)?immobiliare\.it\/annunci\/\d+\/?/i;

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return cleanText(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&euro;/gi, "€");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

function absoluteImmobiliareUrl(raw) {
  try {
    const parsed = new URL(raw);
    if (!/^(www\.)?immobiliare\.it$/i.test(parsed.hostname)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractImmobiliareAnnouncementUrls(text) {
  const matches = String(text || "").match(/https?:\/\/(?:www\.)?immobiliare\.it\/[^\s"'<>]+/gi) || [];
  const seen = new Set();
  return matches
    .map((url) => absoluteImmobiliareUrl(url.replace(/[),.;]+$/g, "")))
    .filter((url) => url && DETAIL_URL_RE.test(url))
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function metaContent(html, selectors) {
  for (const selector of selectors) {
    const re = new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${selector}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
    const match = html.match(re);
    if (match) return decodeHtml(match[1]);
  }
  return null;
}

function titleFromHtml(html) {
  return decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function jsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed) blocks.push(parsed);
    } catch {
      // Ignore malformed embedded JSON-LD; metadata fallback still works.
    }
  }
  return blocks;
}

function firstJsonLdListing(blocks) {
  const flat = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    flat.push(node);
    if (node["@graph"]) visit(node["@graph"]);
  };
  visit(blocks);
  return flat.find((node) => {
    const type = Array.isArray(node["@type"]) ? node["@type"].join(" ") : node["@type"];
    return /Product|Offer|Residence|Apartment|House|RealEstateListing|SingleFamilyResidence/i.test(String(type || ""));
  }) || flat.find((node) => node.name || node.description || node.offers) || null;
}

function numberFromText(value) {
  const match = String(value || "").match(/(\d[\d.\s]*)(?:,\d{1,2})?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/\./g, "").replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

async function configuredProvider(provider) {
  if (provider) return String(provider).trim().toLowerCase();
  const settings = await getRuntimeSettings();
  return String(
    process.env.IMMOBILIARE_SCRAPER_PROVIDER ||
      settings.immobiliare_scraper_provider ||
      "direct"
  ).trim().toLowerCase();
}

async function readApifyConfig(overrides = {}) {
  const settings = await getRuntimeSettings();
  return {
    apiBaseUrl: String(overrides.apiBaseUrl || process.env.APIFY_API_BASE_URL || "https://api.apify.com").replace(/\/$/, ""),
    token: String(overrides.token || process.env.APIFY_TOKEN || settings.apify_token || "").trim(),
    actorId: String(overrides.actorId || process.env.APIFY_IMMOBILIARE_ACTOR_ID || settings.apify_immobiliare_actor_id || "").trim(),
    inputTemplate: overrides.inputTemplate || process.env.APIFY_IMMOBILIARE_INPUT_TEMPLATE || settings.apify_immobiliare_input_template || null,
  };
}

function apifyActorPath(actorId) {
  return encodeURIComponent(String(actorId || "").replace("/", "~"));
}

function replaceUrlPlaceholder(value, url) {
  if (typeof value === "string") return value.replaceAll("{url}", url);
  if (Array.isArray(value)) return value.map((item) => replaceUrlPlaceholder(item, url));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceUrlPlaceholder(item, url)]));
  }
  return value;
}

function buildApifyInput(url, config) {
  if (config.inputTemplate) {
    try {
      return replaceUrlPlaceholder(JSON.parse(config.inputTemplate), url);
    } catch {
      return { startUrls: [{ url }], url };
    }
  }
  const actorId = String(config.actorId || "").toLowerCase();
  if (actorId.includes("immobiliare-it-listing-page-scraper-by-search-url")) {
    return { startUrl: url, maxItems: 10 };
  }
  if (actorId.includes("immobiliare-it-listing-page-scraper-by-items-urls")) {
    return { startUrls: [url] };
  }
  return { startUrls: [{ url }], maxItems: 1 };
}

function firstValue(source, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], source);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function scalarFromValue(value) {
  if (value === undefined || value === null || value === "") return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "object") {
    return firstValue(value, [
      "value",
      "formattedValue",
      "label",
      "name",
      "text",
      "amount",
      "price",
    ]);
  }
  return null;
}

function deepFirstValue(source, names, maxDepth = 5) {
  const seen = new Set();
  const queue = [{ node: source, depth: 0 }];
  const wanted = new Set(names.map((name) => String(name).toLowerCase()));
  while (queue.length) {
    const { node, depth } = queue.shift();
    if (!node || typeof node !== "object" || seen.has(node) || depth > maxDepth) continue;
    seen.add(node);
    if (!Array.isArray(node)) {
      for (const [key, value] of Object.entries(node)) {
        if (wanted.has(key.toLowerCase())) {
          const scalar = scalarFromValue(value);
          if (scalar !== null) return scalar;
        }
      }
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") queue.push({ node: value, depth: depth + 1 });
    }
  }
  return null;
}

function collectFeatureValues(source, keys) {
  const values = [];
  const seen = new Set();
  const wanted = keys.map((key) => String(key).toLowerCase());
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== "object" || seen.has(node) || depth > 5) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const label = String(node.label || node.name || node.title || node.type || node.key || "").toLowerCase();
    if (wanted.some((key) => label.includes(key))) {
      const value = scalarFromValue(node.value) ?? scalarFromValue(node.text) ?? scalarFromValue(node.name);
      if (value !== null) values.push(value);
    }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  visit(source);
  return values;
}

function normalizeAddress(value) {
  if (!value) return { raw: null, text: null };
  if (typeof value === "string") return { raw: value, text: cleanText(value) || null };
  const parts = [
    scalarFromValue(value.street || value.streetAddress || value.address || value.route),
    scalarFromValue(value.streetNumber || value.houseNumber || value.number),
    scalarFromValue(value.city || value.locality || value.municipality || value.addressLocality),
    scalarFromValue(value.town || value.macrozone),
    scalarFromValue(value.province || value.region || value.addressRegion),
  ];
  return { raw: value, text: parts.filter(Boolean).join(" ").replace(/\s+,/g, ",").trim() || null };
}

function normalizeApifyItem(item, url) {
  const address = normalizeAddress(firstValue(item, [
    "address",
    "location",
    "property.address",
    "realEstate.location",
  ]));
  const priceRaw = firstValue(item, [
    "price",
    "prezzo",
    "priceRaw",
    "price.raw",
    "price.value",
    "price.formattedValue",
    "details.price",
    "property.price",
    "realEstate.price.value",
    "realEstate.price.formattedValue",
  ]) ?? deepFirstValue(item, ["price", "prezzo", "formattedValue"]);
  const featureSurface = collectFeatureValues(item, ["superficie", "surface", "mq", "m²"])[0] || null;
  const featureRooms = collectFeatureValues(item, ["locali", "rooms", "stanze"])[0] || null;
  return {
    source: "apify",
    url: firstValue(item, ["url", "listingUrl", "link", "realEstate.url"]) || url,
    title: firstValue(item, [
      "title",
      "name",
      "headline",
      "caption",
      "property.title",
      "realEstate.title",
      "realEstate.properties.0.title",
      "realEstate.properties.0.caption",
    ]) || deepFirstValue(item, ["title", "caption", "headline", "name"]),
    description: firstValue(item, [
      "description",
      "descrizione",
      "defaultDescription",
      "text",
      "property.description",
      "realEstate.description",
      "realEstate.defaultDescription",
      "realEstate.properties.0.description",
      "realEstate.properties.0.defaultDescription",
    ]) || deepFirstValue(item, ["description", "defaultDescription", "descrizione"]),
    prezzo: typeof priceRaw === "number" ? priceRaw : numberFromText(priceRaw),
    prezzo_raw: priceRaw != null ? String(priceRaw) : null,
    disponibilita: firstValue(item, [
      "availability",
      "disponibilita",
      "status",
      "state.name",
      "property.availability",
      "realEstate.state.name",
      "realEstate.properties.0.state.name",
    ]) || deepFirstValue(item, ["availability", "disponibilita", "status"]),
    indirizzo: address.text,
    address: address.raw,
    superficie_mq: firstValue(item, [
      "surface",
      "surfaceMq",
      "area",
      "details.surface",
      "realEstate.properties.0.surface",
    ]) || featureSurface,
    rooms: firstValue(item, ["rooms", "locali", "details.rooms", "realEstate.properties.0.rooms"]) || featureRooms,
    property_type: firstValue(item, [
      "propertyType",
      "typology",
      "type",
      "typology.name",
      "category.name",
      "realEstate.typology.name",
      "realEstate.properties.0.typology.name",
      "realEstate.properties.0.category.name",
    ]) || deepFirstValue(item, ["propertyType", "typology", "category"]),
    apify_keys: Object.keys(item).slice(0, 30),
  };
}

async function scrapeWithApify(url, { fetchImpl = fetch, config } = {}) {
  if (!config.token) return { ok: false, provider: "apify", error: "APIFY_TOKEN non configurato.", url };
  if (!config.actorId) return { ok: false, provider: "apify", error: "APIFY_IMMOBILIARE_ACTOR_ID non configurato.", url };

  const endpoint = `${config.apiBaseUrl}/v2/actors/${apifyActorPath(config.actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(config.token)}`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(buildApifyInput(url, config)),
  });
  if (!response.ok) {
    return {
      ok: false,
      provider: "apify",
      error: `Apify HTTP ${response.status}`,
      http_status: response.status,
      url,
    };
  }
  const items = await response.json();
  const firstItem = Array.isArray(items) ? items[0] : items?.items?.[0] || items;
  if (!firstItem) {
    return { ok: false, provider: "apify", error: "Apify non ha restituito dati.", url };
  }
  return {
    ok: true,
    provider: "apify",
    scraped_at: new Date().toISOString(),
    data: normalizeApifyItem(firstItem, url),
  };
}

function dataAttribute(html, names) {
  for (const name of names) {
    const re = new RegExp(`(?:data-${name}|${name})=["']([^"']+)["']`, "i");
    const match = html.match(re);
    if (match) return decodeHtml(match[1]);
  }
  return null;
}

export function parseImmobiliareHtml(html, url) {
  const blocks = jsonLdBlocks(html);
  const listing = firstJsonLdListing(blocks) || {};
  const offers = Array.isArray(listing.offers) ? listing.offers[0] : listing.offers || {};
  const address = listing.address || {};
  const title = cleanText(
    listing.name ||
      metaContent(html, ["og:title", "twitter:title"]) ||
      titleFromHtml(html)
  ) || null;
  const description = stripTags(
    listing.description ||
      metaContent(html, ["og:description", "description", "twitter:description"]) ||
      ""
  ) || null;
  const priceRaw =
    offers.price ||
    offers.lowPrice ||
    metaContent(html, ["product:price:amount"]) ||
    dataAttribute(html, ["price", "prezzo"]);
  const availability =
    offers.availability ||
    dataAttribute(html, ["availability", "disponibilita"]) ||
    null;
  const streetAddress = cleanText(
    address.streetAddress ||
      address.addressLocality && address.streetAddress
  ) || null;
  const locality = cleanText(address.addressLocality || address.addressRegion || "") || null;
  const extractedAddress = [streetAddress, locality].filter(Boolean).join(", ") || null;

  return {
    source: "immobiliare.it",
    url,
    title,
    description,
    prezzo: numberFromText(priceRaw),
    prezzo_raw: priceRaw ? String(priceRaw) : null,
    disponibilita: availability ? stripTags(String(availability)).replace(/^https?:\/\/schema\.org\//i, "") : null,
    indirizzo: extractedAddress,
    address: Object.keys(address).length ? address : null,
    jsonld_found: blocks.length,
  };
}

export async function scrapeImmobiliareAnnouncement(url, { fetchImpl = fetch, provider, apifyConfig } = {}) {
  const safeUrl = absoluteImmobiliareUrl(url);
  if (!safeUrl || !DETAIL_URL_RE.test(safeUrl)) {
    return { ok: false, error: "URL Immobiliare.it non supportato.", url };
  }

  const selectedProvider = await configuredProvider(provider);
  if (selectedProvider === "off") {
    return { ok: false, skipped: true, error: "Acquisizione Immobiliare.it disattivata.", url: safeUrl };
  }
  if (selectedProvider === "apify") {
    return scrapeWithApify(safeUrl, { fetchImpl, config: await readApifyConfig(apifyConfig) });
  }

  const response = await fetchImpl(safeUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Astebook/1.0 (+https://astebook.it; single-announcement enrichment)",
    },
  });
  if (!response.ok) {
    const blocked = response.status === 401 || response.status === 403;
    return {
      ok: false,
      blocked,
      error: blocked ? "Accesso bloccato da Immobiliare.it." : `Immobiliare.it HTTP ${response.status}`,
      http_status: response.status,
      url: safeUrl,
    };
  }
  const html = await response.text();
  return {
    ok: true,
    scraped_at: new Date().toISOString(),
    data: parseImmobiliareHtml(html, safeUrl),
  };
}
