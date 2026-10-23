/**
 * Parsing helpers for user input.
 */

/**
 * Parses a decimal number typed in German or English notation:
 * "1234.5", "1234,5", "1.234,50" and "1,234.50" are all accepted.
 * Returns null for empty or invalid input.
 */
export function parseDecimal(input: string): number | null {
  let text = input.trim().replace(/[\s']/g, "");
  if (text === "") return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal separator.
    const thousands = lastComma > lastDot ? "." : ",";
    text = text.split(thousands).join("");
  }
  text = text.replace(",", ".");

  if (!/^-?\d*\.?\d+$/.test(text) && !/^-?\d+\.$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Today's date in the local time zone as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Formats a number for an input field in the given language, without grouping. */
export function formatDecimalInput(value: number, language: "de" | "en"): string {
  const text = String(Math.round(value * 1e6) / 1e6);
  return language === "de" ? text.replace(".", ",") : text;
}
