function cleanProcedureCode(event) {
  const result = event?.result || {};
  const merged = result.merged || result.zapier_response?.merged || {};
  return String(
    result.codice_pratica ||
      merged.codice_pratica ||
      event?.metadata?.codice_pratica ||
      event?.metadata?.zap_run_id ||
      event?.id ||
      ""
  ).trim();
}

function safeFilename(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function documentProcedureCode(event) {
  return cleanProcedureCode(event) || "procedura";
}

export function documentDisplayTitle(event) {
  return `AI Intrum - DISCIPLINARE DI GARA ${documentProcedureCode(event)}`;
}

export function documentFileName(event, extension = "pdf") {
  const ext = String(extension || "pdf").replace(/^\./, "");
  return `${safeFilename(documentDisplayTitle(event))}.${ext}`;
}
