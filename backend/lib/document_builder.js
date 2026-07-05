import PDFDocument from "pdfkit";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { disciplinareTemplate } from "../templates/disciplinare.js";
import { getEffectiveSetting } from "./app_config.js";

function valueAt(obj, path) {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

function firstValue(obj, paths, fallback = "-") {
  for (const path of paths) {
    const value = valueAt(obj, path);
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
}

function money(value) {
  if (value === "-" || value === null || value === undefined || value === "") return "-";
  const number = typeof value === "number" ? value : Number(String(value).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
}

function currentItalianDate() {
  return new Date().toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function buildDocumentFields(event) {
  const result = event?.result || {};
  const extracted = result.extracted || {};
  const proposta = extracted.proposta || result.zapier_response?.proposta || {};
  const annuncio = extracted.annuncio || result.zapier_response?.annuncio || {};
  const codicePratica =
    result.codice_pratica ||
    event?.metadata?.zap_run_id ||
    event?.metadata?.email_id ||
    "-";

  return {
    comune: firstValue({ proposta, annuncio }, ["annuncio.comune", "proposta.comune"]),
    provincia: firstValue({ proposta, annuncio }, ["annuncio.provincia", "proposta.provincia"]),
    indirizzo: firstValue(
      { proposta, annuncio },
      ["proposta.indirizzo_immobile", "annuncio.indirizzo", "annuncio.indirizzo_raw"]
    ),
    cap: firstValue({ proposta, annuncio }, ["annuncio.cap", "proposta.cap"]),
    descrizione_immobile: firstValue(
      { proposta, annuncio },
      ["proposta.descrizione_immobile", "annuncio.descrizione", "annuncio.categoria_macro"]
    ),
    catasto_fg: firstValue({ proposta }, ["proposta.catasto.foglio"]),
    catasto_mappale: firstValue({ proposta }, ["proposta.catasto.particella"]),
    catasto_sub: firstValue({ proposta }, ["proposta.catasto.subalterno"]),
    catasto_categoria: firstValue({ proposta, annuncio }, ["proposta.catasto.categoria", "annuncio.categoria_macro"]),
    stato_occupazione: firstValue({ annuncio }, ["annuncio.stato"], "non indicato"),
    prezzo_base_eur: money(firstValue({ proposta, annuncio }, ["proposta.prezzo_offerto", "annuncio.offerta_minima"])),
    offerta_minima_eur: money(firstValue({ annuncio, proposta }, ["annuncio.offerta_minima", "proposta.prezzo_offerto"])),
    rilancio_minimo_eur: money(firstValue({ annuncio }, ["annuncio.rilancio_minimo"], 1000)),
    iban_cauzione: firstValue({ proposta }, ["proposta.iban_beneficiario"]),
    beneficiario_cauzione: firstValue({ proposta }, ["proposta.beneficiario_cauzione"], "-"),
    codice_pratica: codicePratica,
    proviggione: firstValue({ annuncio }, ["annuncio.provvigione_percentuale"], 3),
    data_apertura_pubblicazione: firstValue({ result }, ["result.data_apertura_pubblicazione"], currentItalianDate()),
    data_termine_deposito: firstValue({ annuncio }, ["annuncio.data_termine_deposito"]),
    ora_termine_deposito: firstValue({ annuncio }, ["annuncio.ora_termine_deposito"], "12:00"),
    data_gara: firstValue({ annuncio }, ["annuncio.data_vendita"]),
    ora_gara_inizio: firstValue({ annuncio }, ["annuncio.ora_gara_inizio"], "09:00"),
    ora_gara_fine: firstValue({ annuncio }, ["annuncio.ora_gara_fine"], "12:00"),
    termine_richieste_visite_data: firstValue({ annuncio }, ["annuncio.termine_richieste_visite_data"]),
    termine_richieste_visite_ora: firstValue({ annuncio }, ["annuncio.termine_richieste_visite_ora"]),
    luogo_redazione: firstValue({ proposta }, ["proposta.luogo_redazione"], "Milano"),
    data_redazione: currentItalianDate(),
    anno_redazione: new Date().getFullYear(),
  };
}

export function fillTemplate(template, fields) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key) => {
    const value = fields[String(key).trim()];
    return value === undefined || value === null || value === "" ? "-" : String(value);
  });
}

export function buildDocumentText(event) {
  return fillTemplate(disciplinareTemplate, buildDocumentFields(event));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildDocumentHtml(event) {
  const text = buildDocumentText(event);
  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <title>Disciplinare Astebook</title>
    <style>
      body { margin: 0; background: #f4f6f8; color: #111827; font-family: Georgia, "Times New Roman", serif; }
      main { width: min(900px, calc(100vw - 32px)); margin: 24px auto; background: white; padding: 56px 64px; box-shadow: 0 16px 50px rgba(17,24,39,.14); }
      pre { white-space: pre-wrap; font: inherit; line-height: 1.45; margin: 0; }
      @media print { body { background: white; } main { width: auto; margin: 0; box-shadow: none; padding: 0; } }
    </style>
  </head>
  <body><main><pre>${escapeHtml(text)}</pre></main></body>
</html>`;
}

export function buildDocumentPdf(event) {
  const text = buildDocumentText(event);
  const doc = new PDFDocument({ size: "A4", margin: 54, bufferPages: true });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  doc.font("Times-Roman").fontSize(11).text(text, {
    align: "left",
    lineGap: 3,
  });
  doc.end();
  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function googleFileIdFromUrl(url) {
  const value = String(url || "");
  return (
    value.match(/\/document\/d\/([^/]+)/)?.[1] ||
    value.match(/\/file\/d\/([^/]+)/)?.[1] ||
    value.match(/[?&]id=([^&]+)/)?.[1] ||
    null
  );
}

function docxDownloadUrl(templateUrl) {
  const value = String(templateUrl || "").trim();
  if (!value) return "";
  const googleDocId = value.includes("docs.google.com/document/")
    ? googleFileIdFromUrl(value)
    : null;
  if (googleDocId) {
    return `https://docs.google.com/document/d/${encodeURIComponent(googleDocId)}/export?format=docx`;
  }
  const driveFileId = googleFileIdFromUrl(value);
  if (driveFileId && value.includes("drive.google.com")) {
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveFileId)}`;
  }
  return value;
}

async function fetchTemplateDocxBuffer() {
  const templateUrl = await getEffectiveSetting("DOCUMENT_TEMPLATE_URL", "document_template_url");
  if (!templateUrl) return null;

  const response = await fetch(docxDownloadUrl(templateUrl));
  if (!response.ok) {
    throw new Error(`Download template DOCX fallito: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function buildDocumentDocx(event) {
  const templateBuffer = await fetchTemplateDocxBuffer();
  if (!templateBuffer) return null;

  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    delimiters: {
      start: "{{",
      end: "}}",
    },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "-",
  });
  doc.render(buildDocumentFields(event));
  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}
