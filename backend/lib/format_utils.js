export function formatLocalISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysToISODate(isoDate, days) {
  const m = typeof isoDate === "string" && isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function shiftISOToNextBusinessDay(isoDate) {
  const m = typeof isoDate === "string" && isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dow = d.getUTCDay();
  if (dow === 6) return addDaysToISODate(isoDate, 2);
  if (dow === 0) return addDaysToISODate(isoDate, 1);
  return isoDate;
}

export function toISOFromITDate(val) {
  if (!val) return null;
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
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

export function toItalianTextDate(val) {
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

  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${day} ${months[month - 1]} ${year}`;
    }
  }

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

export function toItalianNumericDate(val) {
  if (!val) return val ?? null;
  const iso = toISOFromITDate(val);
  if (!iso) return String(val).trim();
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(val).trim();
}

export function toItalianShortTextDate(val) {
  const full = toItalianTextDate(val);
  const m = String(full || "").trim().match(/^(\d{1,2})\s+([a-zà]+)\s+(\d{4})$/i);
  if (!m) return full;
  return `${m[1]} ${m[2].toLowerCase()} ${m[3].slice(-2)}`;
}

export function formatMoneyIT(val) {
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
