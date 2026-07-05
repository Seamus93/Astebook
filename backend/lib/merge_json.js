// lib/merge_json.js
export function mergeAnnuncioProposta(annuncio, proposta) {
  // helper safe getter
  const get = (o, p, d = null) =>
    p.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), o) ?? d;

  // separa indirizzo e comune, gestendo formati senza virgole (es. "Foligno (PG) Via ...")
  const splitIndirizzoComune = (val) => {
    if (!val || typeof val !== "string") {
      return { indirizzo: null, comune: null, cap: null, provincia: null };
    }
    const raw = val.trim();

    const parseComuneCapProvincia = (input) => {
      if (!input || typeof input !== "string") {
        return { comune: null, cap: null, provincia: null };
      }
      let work = input.trim();
      if (!work) return { comune: null, cap: null, provincia: null };

      let cap = null;
      const capMatch = work.match(/(?:^|\b)(\d{5})(?:\b|$)/);
      if (capMatch) {
        cap = capMatch[1];
        work = work.replace(capMatch[0], " ");
      }

      let provincia = null;
      const provParen = work.match(/\((\s*[A-Z]{2}\s*)\)/i);
      if (provParen) {
        provincia = provParen[1].trim().toUpperCase();
        work = work.replace(provParen[0], " ");
      } else {
        const provTail = work.match(/([A-Z]{2})\s*$/i);
        if (provTail) {
          const remaining = work.replace(provTail[0], " ").trim();
          if (remaining.length >= 2) {
            provincia = provTail[1].toUpperCase();
            work = remaining;
          }
        }
      }

      const comune = work.replace(/[,\-;]+/g, " ").replace(/\s{2,}/g, " ").trim();
      return { comune: comune || null, cap, provincia };
    };

    const commaParts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (commaParts.length >= 2) {
      const comuneRaw = commaParts.pop();
      const indirizzo = commaParts.join(", ");
      const parsed = parseComuneCapProvincia(comuneRaw);
      return {
        indirizzo: indirizzo || null,
        comune: parsed.comune || comuneRaw || null,
        cap: parsed.cap,
        provincia: parsed.provincia,
      };
    }

    const streetKeywords = [
      "via",
      "viale",
      "corso",
      "piazza",
      "piazzale",
      "strada",
      "largo",
      "vicolo",
      "vico",
      "contrada",
      "sp",
      "ss",
    ];
    const regex = new RegExp(`\\b(${streetKeywords.join("|")})\\b`, "i");
    const matchStreet = regex.exec(raw);
    if (matchStreet && matchStreet.index > 0) {
      const comuneRaw = raw.slice(0, matchStreet.index).trim();
      const indirizzo = raw.slice(matchStreet.index).trim();
      const parsed = parseComuneCapProvincia(comuneRaw);
      return {
        indirizzo: indirizzo || null,
        comune: parsed.comune || comuneRaw || null,
        cap: parsed.cap,
        provincia: parsed.provincia,
      };
    }

    const m = raw.match(/^([A-Z\w][\w'\. ]{2,})\s+in\s+(.*)$/i);
    if (m) {
      const parsed = parseComuneCapProvincia(m[1].trim());
      return {
        comune: parsed.comune || m[1].trim() || null,
        indirizzo: m[2].trim() || null,
        cap: parsed.cap,
        provincia: parsed.provincia,
      };
    }

    const parsedFallback = parseComuneCapProvincia(raw);
    if (parsedFallback.comune || parsedFallback.cap || parsedFallback.provincia) {
      return { indirizzo: null, ...parsedFallback };
    }
    return { indirizzo: raw || null, comune: null, cap: null, provincia: null };
  };

  const indirizzoProposta =
    get(proposta, "indirizzo_immobile", null) || get(annuncio, "indirizzo", null);
  const split = splitIndirizzoComune(indirizzoProposta);

  const merged = {
    descrizione: get(annuncio, "descrizione", null),
    provvigione_percentuale: get(annuncio, "provvigione_percentuale", null),
    fonte: {
      annuncio_file: get(annuncio, "file_pdf", null),
      proposta_file: get(proposta, "file_pdf", null),
    },
    immobile: {
      indirizzo: split.indirizzo ?? " ",
      comune: split.comune ?? " ",
      cap: split.cap ?? " ",
      provincia: split.provincia ?? " ",
    },
    asta: {
      data: get(annuncio, "data_vendita", null),
      ora: get(annuncio, "ora_vendita", null),
    },
    gara: {
      offerta_minima: get(annuncio, "offerta_minima", null),
      offerta_minima_ammissibile: get(annuncio, "offerta_minima_ammissibile", null),
      rilancio_minimo: get(annuncio, "rilancio_minimo", null),
      ora_inizio: get(annuncio, "ora_gara_inizio", null) || get(annuncio, "ora_vendita", null) || null,
      ora_fine: get(annuncio, "ora_gara_fine", null),
    },
    visite: {
      termine_data: get(annuncio, "termine_richieste_visite_data", null),
      termine_ora: get(annuncio, "termine_richieste_visite_ora", null),
    },
    caratteristiche: {
      stato: get(annuncio, "stato", null) || "libero",
    },
    catasto: {
      foglio: get(proposta, "catasto.foglio", null),
      particella: get(proposta, "catasto.particella", null),
      mappale: get(proposta, "catasto.mappale", null) || get(proposta, "catasto.particella", null),
      subalterno: get(proposta, "catasto.subalterno", null),
      categoria: get(proposta, "catasto.categoria", null),
    },
    deposito: {
      deposito_cauzionale: get(proposta, "deposito_cauzionale", null),
      iban_beneficiario: get(proposta, "iban_beneficiario", null),
      beneficiario_cauzione: get(proposta, "beneficiario_cauzione", null),
      data_termine_deposito: get(annuncio, "data_termine_deposito", null) || get(proposta, "data_termine_deposito", null),
      ora_termine_deposito: get(annuncio, "ora_termine_deposito", null) || get(proposta, "ora_termine_deposito", null),
    },
    termini: {
      irrevocabile_giorni: get(proposta, "irrevocabile_giorni", null),
      rogito_entro_giorni: get(proposta, "rogito_entro_giorni", null),
    },
    redazione: {
      luogo: get(proposta, "luogo_redazione", null) || "Milano",
      data: get(proposta, "data_redazione", null),
      anno: get(proposta, "anno_redazione", null),
    },
  };

  return merged;
}
