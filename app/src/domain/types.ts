/**
 * Core domain types for Holdr.
 *
 * All monetary values on instruments and transactions are stored in the
 * instrument's own trading currency (e.g. USD for AAPL on NASDAQ, EUR for
 * SAP.DE). Conversion into the user's display currency happens at the edges.
 */

/** ISO 4217 currency code, e.g. "EUR" or "USD". */
export type CurrencyCode = string;

/** Currencies the user can choose as display currency. */
export const DISPLAY_CURRENCIES = ["EUR", "USD"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/** A tradable security (stock, ETF, fund, ...) the user holds or held. */
export interface Instrument {
  id: number;
  /** Ticker symbol as used by the quote provider, e.g. "SAP.DE". */
  symbol: string;
  name: string;
  currency: CurrencyCode;
  /** Human readable exchange name, e.g. "XETRA". */
  exchange: string | null;
  /** Provider classification, e.g. "EQUITY" or "ETF". */
  kind: string | null;
  createdAt: string;
}

export type NewInstrument = Omit<Instrument, "id" | "createdAt">;

export type TransactionType = "BUY" | "SELL" | "DIVIDEND";

interface TransactionBase {
  id: number;
  instrumentId: number;
  /** Trade date in ISO format (YYYY-MM-DD). */
  date: string;
  /** Fees paid for this transaction (commission, exchange fees), in instrument currency. */
  fee: number;
  /**
   * Taxes withheld, in instrument currency: e.g. capital gains tax on a sale or
   * withholding tax on a dividend. Always 0 for buys, whose costs are fees.
   */
  tax: number;
  note: string | null;
  createdAt: string;
}

export interface TradeTransaction extends TransactionBase {
  type: "BUY" | "SELL";
  /** Number of shares; fractional shares are allowed (savings plans). */
  quantity: number;
  /** Price per share in instrument currency. */
  price: number;
}

export interface DividendTransaction extends TransactionBase {
  type: "DIVIDEND";
  /** Gross dividend amount received, in instrument currency. */
  amount: number;
}

export type Transaction = TradeTransaction | DividendTransaction;

/** Input shape for creating a transaction (ids and timestamps are assigned by storage). */
export type NewTransaction =
  Omit<TradeTransaction, "id" | "createdAt"> | Omit<DividendTransaction, "id" | "createdAt">;

/** An instrument the user wants to keep an eye on without owning it. */
export interface WatchlistItem {
  id: number;
  symbol: string;
  name: string;
  currency: CurrencyCode;
  exchange: string | null;
  kind: string | null;
  /** ISO timestamp of when it was added. */
  addedAt: string;
  /** Price when added, to show the change since then. */
  addedPrice: number | null;
}

export type NewWatchlistItem = Omit<WatchlistItem, "id" | "addedAt">;

/** Latest market data for one symbol. */
export interface Quote {
  symbol: string;
  price: number;
  /** Previous trading day's close; used for the "today" change. */
  previousClose: number | null;
  currency: CurrencyCode;
  /** ISO timestamp of when the quote was fetched. */
  fetchedAt: string;
}

/** A single point of a price or value time series. */
export interface SeriesPoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  value: number;
}

/** Search hit when looking up an instrument by name, ticker or ISIN. */
export interface InstrumentSearchResult {
  symbol: string;
  name: string;
  exchange: string | null;
  kind: string | null;
}

/** User preferences persisted in local storage. */
export interface Settings {
  language: "de" | "en";
  displayCurrency: DisplayCurrency;
}
