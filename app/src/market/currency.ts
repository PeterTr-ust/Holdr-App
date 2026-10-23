/**
 * Currency conversion into the display currency.
 *
 * Exchange rates are handled like any other quote (Yahoo symbol "USDEUR=X"),
 * so they are cached together with share prices and keep working offline.
 */
import type { CurrencyCode, DisplayCurrency, Quote } from "../domain/types";
import type { Converter } from "../domain/valuation";

/** Quote symbol for the rate that converts `from` into `to`. */
export function exchangeRateSymbol(from: CurrencyCode, to: CurrencyCode): string {
  return `${from}${to}=X`;
}

/** Symbols of all rates needed to show the given currencies in the display currency. */
export function requiredRateSymbols(
  currencies: Iterable<CurrencyCode>,
  display: DisplayCurrency,
): string[] {
  return [...new Set(currencies)]
    .filter((c) => c !== display)
    .map((c) => exchangeRateSymbol(c, display));
}

export function createConverter(
  display: DisplayCurrency,
  quotes: ReadonlyMap<string, Quote>,
): Converter {
  return (amount, from) => {
    if (from === display) return amount;
    const rate = quotes.get(exchangeRateSymbol(from, display))?.price;
    return rate === undefined ? null : amount * rate;
  };
}
