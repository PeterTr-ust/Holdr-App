/**
 * Market data from Yahoo Finance's public chart and search endpoints.
 *
 * These endpoints need no API key but are not an official, documented API.
 *
 * ⚠️ Yahoo's terms do not permit commercial use. As long as this provider is
 * used, Holdr may only be offered free of charge.
 * All parsing is isolated in pure functions so a format change is easy to
 * spot in tests and to fix in one place.
 */
import type { CurrencyCode, InstrumentSearchResult, SeriesPoint } from "../domain/types";
import {
  MarketDataError,
  type HistoryRange,
  type MarketDataProvider,
  type QuoteDetails,
} from "./provider";

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search";

/** Yahoo quotes some markets in minor units, e.g. London in pence ("GBp"). */
const MINOR_UNITS: Record<string, { currency: CurrencyCode; factor: number }> = {
  GBp: { currency: "GBP", factor: 0.01 },
  GBX: { currency: "GBP", factor: 0.01 },
  ZAc: { currency: "ZAR", factor: 0.01 },
  ILA: { currency: "ILS", factor: 0.01 },
};

/** Instrument types worth offering in search; excludes futures, options, etc. */
const SEARCHABLE_TYPES = new Set(["EQUITY", "ETF", "MUTUALFUND", "INDEX", "CRYPTOCURRENCY"]);

const INTERVAL_FOR_RANGE: Record<HistoryRange, string> = {
  "1mo": "1d",
  "6mo": "1d",
  "1y": "1d",
  "5y": "1wk",
};

/** Yahoo rejects requests without a browser-like user agent. */
const REQUEST_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; Holdr)",
};

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class YahooFinanceProvider implements MarketDataProvider {
  constructor(private readonly fetchFn: FetchFn) {}

  async search(query: string): Promise<InstrumentSearchResult[]> {
    const params = new URLSearchParams({ q: query, quotesCount: "10", newsCount: "0" });
    return parseSearch(await this.getJson(`${SEARCH_URL}?${params}`));
  }

  async getQuote(symbol: string): Promise<QuoteDetails> {
    // A one-day range makes `chartPreviousClose` the previous trading day's close.
    const json = await this.getJson(chartUrl(symbol, "1d", "1d"));
    return parseQuote(json, new Date());
  }

  async getHistory(symbol: string, range: HistoryRange): Promise<SeriesPoint[]> {
    return parseHistory(await this.getJson(chartUrl(symbol, range, INTERVAL_FOR_RANGE[range])));
  }

  async getExchangeRate(from: CurrencyCode, to: CurrencyCode): Promise<number> {
    if (from === to) return 1;
    const quote = await this.getQuote(`${from}${to}=X`);
    return quote.price;
  }

  private async getJson(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(url, { headers: REQUEST_HEADERS });
    } catch (error) {
      throw new MarketDataError("Market data provider is not reachable.", { cause: error });
    }
    if (!response.ok) {
      throw new MarketDataError(`Market data request failed with status ${response.status}.`);
    }
    return response.json();
  }
}

function chartUrl(symbol: string, range: string, interval: string): string {
  const params = new URLSearchParams({ range, interval, includePrePost: "false" });
  return `${CHART_URL}${encodeURIComponent(symbol)}?${params}`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface ChartResult {
  meta: {
    symbol: string;
    currency?: string;
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    longName?: string;
    shortName?: string;
    fullExchangeName?: string;
    exchangeName?: string;
    gmtoffset?: number;
  };
  timestamp?: number[];
  indicators?: { quote?: { close?: (number | null)[] }[] };
}

function chartResult(json: unknown): ChartResult {
  const chart = (json as { chart?: { result?: ChartResult[] | null; error?: unknown } })?.chart;
  const result = chart?.result?.[0];
  if (!result?.meta) {
    throw new MarketDataError("Symbol not found or no data available.");
  }
  return result;
}

function normalizeCurrency(currency: string | undefined): {
  currency: CurrencyCode;
  factor: number;
} {
  if (!currency) return { currency: "USD", factor: 1 };
  return MINOR_UNITS[currency] ?? { currency: currency.toUpperCase(), factor: 1 };
}

export function parseQuote(json: unknown, now: Date): QuoteDetails {
  const { meta } = chartResult(json);
  if (typeof meta.regularMarketPrice !== "number") {
    throw new MarketDataError(`No price available for ${meta.symbol}.`);
  }
  const { currency, factor } = normalizeCurrency(meta.currency);
  const previousClose = meta.chartPreviousClose ?? meta.previousClose;

  return {
    symbol: meta.symbol,
    price: meta.regularMarketPrice * factor,
    previousClose: typeof previousClose === "number" ? previousClose * factor : null,
    currency,
    fetchedAt: now.toISOString(),
    name: meta.longName ?? meta.shortName ?? null,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
  };
}

export function parseHistory(json: unknown): SeriesPoint[] {
  const result = chartResult(json);
  const { factor } = normalizeCurrency(result.meta.currency);
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const offset = result.meta.gmtoffset ?? 0;

  // Keyed by date so duplicate entries for the current day collapse into one.
  const byDate = new Map<string, number>();
  timestamps.forEach((timestamp, index) => {
    const close = closes[index];
    if (typeof close !== "number") return;
    const date = new Date((timestamp + offset) * 1000).toISOString().slice(0, 10);
    byDate.set(date, close * factor);
  });

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

interface SearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  exchange?: string;
  quoteType?: string;
}

export function parseSearch(json: unknown): InstrumentSearchResult[] {
  const quotes = (json as { quotes?: SearchQuote[] })?.quotes ?? [];
  return quotes
    .filter((q): q is SearchQuote & { symbol: string } => Boolean(q.symbol))
    .filter((q) => !q.quoteType || SEARCHABLE_TYPES.has(q.quoteType))
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname ?? q.shortname ?? q.symbol,
      exchange: q.exchDisp ?? q.exchange ?? null,
      kind: q.quoteType ?? null,
    }));
}
