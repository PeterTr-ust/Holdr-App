/**
 * Abstraction over a market data source, so the provider can be swapped
 * (e.g. Yahoo Finance today, another API later) without touching the UI.
 */
import type { CurrencyCode, InstrumentSearchResult, Quote, SeriesPoint } from "../domain/types";

/** Time ranges offered for the value chart. */
export const HISTORY_RANGES = ["1mo", "6mo", "1y", "5y"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** Quote plus descriptive data, returned when looking up a symbol. */
export interface QuoteDetails extends Quote {
  name: string | null;
  exchange: string | null;
}

export interface MarketDataProvider {
  /** Finds instruments by name, ticker symbol or ISIN. */
  search(query: string): Promise<InstrumentSearchResult[]>;
  getQuote(symbol: string): Promise<QuoteDetails>;
  /** Daily (or weekly for long ranges) closing prices, oldest first. */
  getHistory(symbol: string, range: HistoryRange): Promise<SeriesPoint[]>;
  /** How many units of `to` one unit of `from` buys. */
  getExchangeRate(from: CurrencyCode, to: CurrencyCode): Promise<number>;
}

/** Raised when the provider cannot be reached or answers with unusable data. */
export class MarketDataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MarketDataError";
  }
}
