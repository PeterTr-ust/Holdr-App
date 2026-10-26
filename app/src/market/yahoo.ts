/**
 * Market data from Yahoo Finance's public chart, search and quote summary
 * endpoints.
 *
 * These endpoints need no API key but are not an official, documented API.
 * The quote summary (profiles, upcoming dates) additionally needs a session
 * cookie, which the desktop shell handles (`src-tauri/src/yahoo.rs`); without
 * it, those capabilities are left out.
 *
 * ⚠️ Yahoo's terms do not permit commercial use. As long as this provider is
 * used, Holdr may only be offered free of charge.
 * All parsing is isolated in pure functions so a format change is easy to
 * spot in tests and to fix in one place.
 */
import type { CorporateActions } from "../domain/corporateActions";
import {
  countryCodeFromName,
  sectorFromLabel,
  type InstrumentProfile,
  type Sector,
  type UpcomingEvents,
} from "../domain/profile";
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

/** Modules requested from the quote summary endpoint per capability. */
const PROFILE_MODULES = ["assetProfile", "topHoldings"];
const EVENT_MODULES = ["calendarEvents"];

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
/** Loads the quote summary JSON for a symbol; needs Yahoo's session cookie. */
export type QuoteSummaryFn = (symbol: string, modules: readonly string[]) => Promise<unknown>;

export class YahooFinanceProvider implements MarketDataProvider {
  readonly getProfile?: (symbol: string) => Promise<InstrumentProfile>;
  readonly getUpcomingEvents?: (symbol: string) => Promise<UpcomingEvents>;

  constructor(
    private readonly fetchFn: FetchFn,
    quoteSummary?: QuoteSummaryFn,
  ) {
    if (quoteSummary) {
      const load = async (symbol: string, modules: readonly string[]) => {
        try {
          return await quoteSummary(symbol, modules);
        } catch (error) {
          throw new MarketDataError("Quote summary could not be loaded.", { cause: error });
        }
      };
      this.getProfile = async (symbol) => parseProfile(await load(symbol, PROFILE_MODULES));
      this.getUpcomingEvents = async (symbol) =>
        parseUpcomingEvents(await load(symbol, EVENT_MODULES), new Date());
    }
  }

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

  async getCorporateActions(symbol: string, since: string): Promise<CorporateActions> {
    const params = new URLSearchParams({
      period1: String(Math.floor(Date.parse(`${since}T00:00:00Z`) / 1000)),
      period2: String(Math.floor(Date.now() / 1000)),
      interval: "1d",
      events: "div,split",
    });
    const url = `${CHART_URL}${encodeURIComponent(symbol)}?${params}`;
    return parseCorporateActions(await this.getJson(url));
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
  events?: {
    dividends?: Record<string, { amount?: number; date?: number }>;
    splits?: Record<string, { date?: number; numerator?: number; denominator?: number }>;
  };
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
    byDate.set(exchangeDate(timestamp, offset), close * factor);
  });

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));
}

export function parseCorporateActions(json: unknown): CorporateActions {
  const result = chartResult(json);
  const { factor } = normalizeCurrency(result.meta.currency);
  const offset = result.meta.gmtoffset ?? 0;

  const dividends = Object.values(result.events?.dividends ?? {})
    .filter((d) => typeof d.date === "number" && typeof d.amount === "number" && d.amount > 0)
    .map((d) => ({ date: exchangeDate(d.date!, offset), amount: d.amount! * factor }));
  const splits = Object.values(result.events?.splits ?? {})
    .filter((s) => typeof s.date === "number" && s.numerator! > 0 && s.denominator! > 0)
    .map((s) => ({
      date: exchangeDate(s.date!, offset),
      ratioTo: s.numerator!,
      ratioFrom: s.denominator!,
    }));

  const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);
  return { dividends: dividends.sort(byDate), splits: splits.sort(byDate) };
}

/** Converts a Unix timestamp into the trading date at the exchange. */
function exchangeDate(timestamp: number, gmtOffset: number): string {
  return new Date((timestamp + gmtOffset) * 1000).toISOString().slice(0, 10);
}

// --- Quote summary ---------------------------------------------------------

/** Quote summary values come either plain or as `{ raw, fmt }`. */
type Value<T> = T | { raw?: T } | undefined;

interface SummaryResult {
  assetProfile?: { sector?: string; industry?: string; country?: string };
  topHoldings?: { sectorWeightings?: Record<string, Value<number>>[] };
  calendarEvents?: {
    exDividendDate?: Value<number>;
    dividendDate?: Value<number>;
    earnings?: { earningsDate?: Value<number>[]; isEarningsDateEstimate?: Value<boolean> };
  };
}

function summaryResult(json: unknown): SummaryResult {
  const summary = (json as { quoteSummary?: { result?: SummaryResult[] | null } })?.quoteSummary;
  const result = summary?.result?.[0];
  if (!result) throw new MarketDataError("No quote summary available.");
  return result;
}

function raw<T>(value: Value<T>): T | undefined {
  return typeof value === "object" && value !== null ? (value as { raw?: T }).raw : value;
}

export function parseProfile(json: unknown): InstrumentProfile {
  const result = summaryResult(json);
  const asset = result.assetProfile;

  const weights: Partial<Record<Sector, number>> = {};
  for (const entry of result.topHoldings?.sectorWeightings ?? []) {
    for (const [label, value] of Object.entries(entry)) {
      const sector = sectorFromLabel(label);
      const weight = raw(value);
      if (sector && typeof weight === "number" && weight > 0) {
        weights[sector] = (weights[sector] ?? 0) + weight;
      }
    }
  }

  return {
    sector: sectorFromLabel(asset?.sector),
    industry: asset?.industry?.trim() || null,
    country: countryCodeFromName(asset?.country),
    sectorWeights: Object.keys(weights).length > 0 ? weights : null,
  };
}

/** Keeps only dates from today on; Yahoo often still reports the last past date. */
export function parseUpcomingEvents(json: unknown, now: Date): UpcomingEvents {
  const calendar = summaryResult(json).calendarEvents;
  const today = now.toISOString().slice(0, 10);
  const upcoming = (value: Value<number>) => {
    const seconds = raw(value);
    if (typeof seconds !== "number") return null;
    const date = new Date(seconds * 1000).toISOString().slice(0, 10);
    return date >= today ? date : null;
  };

  const earnings = (calendar?.earnings?.earningsDate ?? [])
    .map(upcoming)
    .filter((date): date is string => date !== null)
    .sort();
  // Two dates mean the company has only announced a time window.
  const estimated =
    raw(calendar?.earnings?.isEarningsDateEstimate) === true ||
    (calendar?.earnings?.earningsDate?.length ?? 0) > 1;

  return {
    exDividendDate: upcoming(calendar?.exDividendDate),
    dividendPaymentDate: upcoming(calendar?.dividendDate),
    earningsDate: earnings[0] ?? null,
    earningsDateEstimated: earnings.length > 0 && estimated,
  };
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
