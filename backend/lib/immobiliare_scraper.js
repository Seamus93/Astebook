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

export async function scrapeImmobiliareAnnouncement(url, { fetchImpl = fetch } = {}) {
  const safeUrl = absoluteImmobiliareUrl(url);
  if (!safeUrl || !DETAIL_URL_RE.test(safeUrl)) {
    return { ok: false, error: "URL Immobiliare.it non supportato.", url };
  }

  const response = await fetchImpl(safeUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Astebook/1.0 (+https://astebook.it; single-announcement enrichment)",
    },
  });
  if (!response.ok) {
    return { ok: false, error: `Immobiliare.it HTTP ${response.status}`, url: safeUrl };
  }
  const html = await response.text();
  return {
    ok: true,
    scraped_at: new Date().toISOString(),
    data: parseImmobiliareHtml(html, safeUrl),
  };
}
