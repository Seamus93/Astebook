import { moneyNum } from "../../lib/text.js";

export function grabAfterLabel(text, labelRes, maxWindow = 160) {
  for (const labelRe of labelRes) {
    const m = text.match(new RegExp(
      `${labelRe.source}[\\s\\:]*([\\s\\S]{1,${maxWindow}}?)` +
      `($|[,;\\n]|\\bnato\\b|\\bnata\\b|\\bn\\.?\\s*a\\b|\\bil\\b)`,
      "i"
    ));
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

export function grabAmountStrict(text, labelRes, maxWindow = 200) {
  for (const labelRe of labelRes) {
    const m = text.match(new RegExp(
      `${labelRe.source}[\\s\\S]{0,${maxWindow}}?` +
      `(?:€\\s*|euro\\s*)` +
      `([\\d\\.,]{1,15})`,
      "i"
    ));
    if (m?.[1]) return moneyNum(m[1]);
  }
  return null;
}

export function grabPercent(text, labelRes, maxWindow = 120) {
  for (const labelRe of labelRes) {
    const m = text.match(new RegExp(
      `${labelRe.source}[\\s\\S]{0,${maxWindow}}?\\b(\\d{1,2})\\s*%`,
      "i"
    ));
    if (m?.[1]) return parseInt(m[1], 10);
  }
  return null;
}

export function grabDays(text, labelRes, maxWindow = 120) {
  for (const labelRe of labelRes) {
    const m = text.match(new RegExp(
      `${labelRe.source}[\\s\\S]{0,${maxWindow}}?\\b(\\d{1,3})\\b`,
      "i"
    ));
    if (m?.[1]) return parseInt(m[1], 10);
  }
  return null;
}
