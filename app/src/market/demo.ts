/**
 * Offline market data with deterministic, made-up prices.
 *
 * Used only when the UI runs in a plain browser (`npm run dev`) instead of
 * inside the desktop shell, where real requests are blocked by CORS.
 */
import { addDays, type CorporateActions, type DividendEvent } from "../domain/corporateActions";
import type { InstrumentProfile, UpcomingEvents } from "../domain/profile";
import type { CurrencyCode, InstrumentSearchResult, SeriesPoint } from "../domain/types";
import { todayIso } from "../util/input";
import {
  MarketDataError,
  type HistoryRange,
  type MarketDataProvider,
  type QuoteDetails,
} from "./provider";

interface DemoInstrument extends InstrumentSearchResult {
  currency: CurrencyCode;
  basePrice: number;
  profile: InstrumentProfile;
  /** Ex-dividend dates as month and day ("MM-DD") with the amount per share. */
  dividends: { day: string; amount: number }[];
  /** Days from ex-date to payment. */
  paymentDelay: number;
}

const company = (sector: InstrumentProfile["sector"], industry: string, country: string) => ({
  sector,
  industry,
  country,
  sectorWeights: null,
});

const INSTRUMENTS: DemoInstrument[] = [
  {
    symbol: "EUNL.DE",
    name: "iShares Core MSCI World UCITS ETF",
    exchange: "XETRA",
    kind: "ETF",
    currency: "EUR",
    basePrice: 104.62,
    profile: {
      sector: null,
      industry: null,
      country: null,
      sectorWeights: {
        technology: 0.25,
        financialServices: 0.15,
        healthcare: 0.11,
        industrials: 0.11,
        consumerCyclical: 0.1,
        communicationServices: 0.08,
        consumerDefensive: 0.06,
        energy: 0.04,
        basicMaterials: 0.04,
        utilities: 0.03,
        realEstate: 0.02,
      },
    },
    // Accumulating fund: no payouts.
    dividends: [],
    paymentDelay: 0,
  },
  {
    symbol: "SAP.DE",
    name: "SAP SE",
    exchange: "XETRA",
    kind: "EQUITY",
    currency: "EUR",
    basePrice: 241.1,
    profile: company("technology", "Software—Application", "DE"),
    dividends: [{ day: "05-14", amount: 2.35 }],
    paymentDelay: 2,
  },
  {
    symbol: "SIE.DE",
    name: "Siemens AG",
    exchange: "XETRA",
    kind: "EQUITY",
    currency: "EUR",
    basePrice: 172.3,
    profile: company("industrials", "Specialty Industrial Machinery", "DE"),
    dividends: [{ day: "02-14", amount: 5.2 }],
    paymentDelay: 2,
  },
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NASDAQ",
    kind: "EQUITY",
    currency: "USD",
    basePrice: 229.8,
    profile: company("technology", "Consumer Electronics", "US"),
    dividends: ["02-10", "05-12", "08-11", "11-10"].map((day) => ({ day, amount: 0.26 })),
    paymentDelay: 3,
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corporation",
    exchange: "NASDAQ",
    kind: "EQUITY",
    currency: "USD",
    basePrice: 431.2,
    profile: company("technology", "Software—Infrastructure", "US"),
    dividends: ["02-19", "05-15", "08-21", "11-20"].map((day) => ({ day, amount: 0.83 })),
    paymentDelay: 24,
  },
];

const RANGE_DAYS: Record<HistoryRange, number> = { "1mo": 31, "6mo": 183, "1y": 365, "5y": 1826 };
const USD_PER_EUR = 1.08;

export class DemoMarketDataProvider implements MarketDataProvider {
  async search(query: string): Promise<InstrumentSearchResult[]> {
    const needle = query.trim().toLowerCase();
    return INSTRUMENTS.filter(
      (i) => i.symbol.toLowerCase().includes(needle) || i.name.toLowerCase().includes(needle),
    ).map(({ symbol, name, exchange, kind }) => ({ symbol, name, exchange, kind }));
  }

  async getQuote(symbol: string): Promise<QuoteDetails> {
    const pair = /^([A-Z]{3})([A-Z]{3})=X$/.exec(symbol);
    if (pair) {
      const [, from, to] = pair as unknown as [string, string, string];
      const rate = await this.getExchangeRate(from, to);
      return {
        symbol,
        price: rate,
        previousClose: rate,
        currency: to,
        fetchedAt: new Date().toISOString(),
        name: null,
        exchange: null,
      };
    }
    const instrument = find(symbol);
    const history = this.series(instrument, 2);
    return {
      symbol,
      price: history.at(-1)!.value,
      previousClose: history.at(-2)!.value,
      currency: instrument.currency,
      fetchedAt: new Date().toISOString(),
      name: instrument.name,
      exchange: instrument.exchange,
    };
  }

  async getHistory(symbol: string, range: HistoryRange): Promise<SeriesPoint[]> {
    return this.series(find(symbol), RANGE_DAYS[range]);
  }

  async getExchangeRate(from: CurrencyCode, to: CurrencyCode): Promise<number> {
    if (from === to) return 1;
    if (from === "EUR" && to === "USD") return USD_PER_EUR;
    if (from === "USD" && to === "EUR") return 1 / USD_PER_EUR;
    throw new MarketDataError(`No demo rate for ${from}/${to}.`);
  }

  async getCorporateActions(symbol: string, since: string): Promise<CorporateActions> {
    const today = todayIso();
    return {
      dividends: dividendEvents(find(symbol)).filter((d) => d.date >= since && d.date <= today),
      splits: [],
    };
  }

  async getProfile(symbol: string): Promise<InstrumentProfile> {
    return find(symbol).profile;
  }

  async getUpcomingEvents(symbol: string): Promise<UpcomingEvents> {
    const instrument = find(symbol);
    const next = dividendEvents(instrument).find((d) => d.date > todayIso());

    return {
      exDividendDate: next?.date ?? null,
      dividendPaymentDate: next ? addDays(next.date, instrument.paymentDelay) : null,
      earningsDate: addDays(todayIso(), 9 + ((symbol.length * 7) % 40)),
      earningsDateEstimated: instrument.currency === "USD",
    };
  }

  /** A seeded random walk ending at the instrument's base price today. */
  private series(instrument: DemoInstrument, days: number): SeriesPoint[] {
    let seed = [...instrument.symbol].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const points: SeriesPoint[] = [];
    let value = instrument.basePrice;
    const today = new Date();
    for (let offset = 0; offset < days; offset++) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      points.push({ date: date.toISOString().slice(0, 10), value });
      value = value / (1 + (random() - 0.47) * 0.03);
    }
    return points.reverse();
  }
}

/** Dividend dates of the last five and the next year. */
function dividendEvents(instrument: DemoInstrument): DividendEvent[] {
  const year = new Date().getUTCFullYear();
  const events: DividendEvent[] = [];
  for (let y = year - 5; y <= year + 1; y++) {
    for (const { day, amount } of instrument.dividends)
      events.push({ date: `${y}-${day}`, amount });
  }
  return events;
}

function find(symbol: string): DemoInstrument {
  const instrument = INSTRUMENTS.find((i) => i.symbol === symbol);
  if (!instrument) throw new MarketDataError(`Symbol not found: ${symbol}`);
  return instrument;
}
