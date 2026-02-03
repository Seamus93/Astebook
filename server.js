import express from "express";
import multer from "multer";
import dotenv from "dotenv";

import { mergeAnnuncioProposta } from "./lib/merge_json.js";
import { aiExtractAnnuncio, aiExtractProposta, aiExtractProvvigionePercentuale } from "./lib/ai.js";
import { parsePdfBuffer } from "./lib/pdf.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "20mb" }));

// Upload in memoria; accetta qualsiasi field (Zapier può chiamarlo diversamente)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
}).any();

app.get("/health", (_req, res) => res.json({ ok: true }));

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
  try {
    const body = Array.isArray(req.body) ? req.body[0] || {} : req.body || {};
    const rawEmailBody = typeof body.email_body_text === "string" ? body.email_body_text : "";
    const provvigioneOcrText =
      typeof body.provvigione_ocr === "string"
        ? body.provvigione_ocr
        : typeof body.provvigione_ocr_text === "string"
        ? body.provvigione_ocr_text
        : "";
    const files = Array.isArray(req.files) ? req.files : [];

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

    let aiProposta = await aiExtractProposta({ text: combinedProText, fileName: proName });

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

    res.json({ ok: true, merged });
  } catch (error) {
    console.error("[callAI] error", error);
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server up on http://localhost:${PORT}`));
