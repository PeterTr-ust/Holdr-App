/**
 * Offline market data with deterministic, made-up prices.
 *
 * Used only when the UI runs in a plain browser (`npm run dev`) instead of
 * inside the desktop shell, where real requests are blocked by CORS.
 */
import type { CurrencyCode, InstrumentSearchResult, SeriesPoint } from "../domain/types";
import {
  MarketDataError,
  type HistoryRange,
  type MarketDataProvider,
  type QuoteDetails,
} from "./provider";

interface DemoInstrument extends InstrumentSearchResult {
  currency: CurrencyCode;
  basePrice: number;
}

const INSTRUMENTS: DemoInstrument[] = [
  {
    symbol: "EUNL.DE",
    name: "iShares Core MSCI World UCITS ETF",
    exchange: "XETRA",
    kind: "ETF",
    currency: "EUR",
    basePrice: 104.62,
  },
  {
    symbol: "SAP.DE",
    name: "SAP SE",
    exchange: "XETRA",
    kind: "EQUITY",
    currency: "EUR",
    basePrice: 241.1,
  },
  {
    symbol: "SIE.DE",
    name: "Siemens AG",
    exchange: "XETRA",
    kind: "EQUITY",
    currency: "EUR",
    basePrice: 172.3,
  },
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NASDAQ",
    kind: "EQUITY",
    currency: "USD",
    basePrice: 229.8,
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corporation",
    exchange: "NASDAQ",
    kind: "EQUITY",
    currency: "USD",
    basePrice: 431.2,
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

function find(symbol: string): DemoInstrument {
  const instrument = INSTRUMENTS.find((i) => i.symbol === symbol);
  if (!instrument) throw new MarketDataError(`Symbol not found: ${symbol}`);
  return instrument;
}
