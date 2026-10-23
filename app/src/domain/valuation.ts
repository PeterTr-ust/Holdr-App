/**
 * Valuation and statistics on top of position accounting.
 *
 * Every function here returns amounts in the user's display currency. The
 * conversion is injected so the domain stays free of any network access.
 */
import type { PositionSummary } from "./portfolio";
import type { CurrencyCode, Quote } from "./types";

/** Converts an amount from the given currency into the display currency, or null if no rate is known. */
export type Converter = (amount: number, from: CurrencyCode) => number | null;

export interface HoldingView {
  position: PositionSummary;
  quote: Quote | null;
  /** Current price per share in instrument currency. */
  price: number | null;
  marketValue: number | null;
  costBasis: number | null;
  unrealized: number | null;
  /** Unrealized result relative to cost basis, e.g. 0.25 for +25 %. */
  unrealizedRatio: number | null;
  dayChange: number | null;
  dayChangeRatio: number | null;
  /** Share of the total market value, between 0 and 1. */
  weight: number | null;
}

export interface PortfolioTotals {
  marketValue: number;
  costBasis: number;
  unrealized: number;
  unrealizedRatio: number | null;
  dayChange: number;
  dayChangeRatio: number | null;
  /** Number of open positions that could not be valued (no quote or exchange rate). */
  unpricedCount: number;
}

export interface PortfolioValuation {
  /** Positions with shares currently held, largest first. */
  holdings: HoldingView[];
  /** Positions that were fully sold. */
  closed: PositionSummary[];
  totals: PortfolioTotals;
}

const QUANTITY_EPSILON = 1e-9;

export function valuePortfolio(
  positions: readonly PositionSummary[],
  quotes: ReadonlyMap<string, Quote>,
  convert: Converter,
): PortfolioValuation {
  const open = positions.filter((p) => p.quantity > QUANTITY_EPSILON);
  const closed = positions.filter((p) => p.quantity <= QUANTITY_EPSILON);

  const holdings = open.map((position) => valueHolding(position, quotes, convert));
  const priced = holdings.filter((h) => h.marketValue !== null && h.costBasis !== null);

  const marketValue = sum(priced.map((h) => h.marketValue!));
  const pricedCost = sum(priced.map((h) => h.costBasis!));
  const dayChange = sum(priced.map((h) => h.dayChange ?? 0));
  const previousValue = marketValue - dayChange;

  for (const holding of holdings) {
    holding.weight =
      holding.marketValue !== null && marketValue > 0 ? holding.marketValue / marketValue : null;
  }
  holdings.sort((a, b) => (b.marketValue ?? -Infinity) - (a.marketValue ?? -Infinity));

  return {
    holdings,
    closed,
    totals: {
      marketValue,
      costBasis: sum(holdings.map((h) => h.costBasis ?? 0)),
      unrealized: marketValue - pricedCost,
      unrealizedRatio: pricedCost > 0 ? (marketValue - pricedCost) / pricedCost : null,
      dayChange,
      dayChangeRatio: previousValue > 0 ? dayChange / previousValue : null,
      unpricedCount: holdings.length - priced.length,
    },
  };
}

function valueHolding(
  position: PositionSummary,
  quotes: ReadonlyMap<string, Quote>,
  convert: Converter,
): HoldingView {
  const quote = quotes.get(position.instrument.symbol) ?? null;
  const currency = position.instrument.currency;
  const costBasis = convert(position.costBasis, currency);
  const marketValue = quote ? convert(position.quantity * quote.price, currency) : null;
  const unrealized = marketValue !== null && costBasis !== null ? marketValue - costBasis : null;
  const dayChange =
    quote?.previousClose != null
      ? convert(position.quantity * (quote.price - quote.previousClose), currency)
      : null;

  return {
    position,
    quote,
    price: quote?.price ?? null,
    marketValue,
    costBasis,
    unrealized,
    unrealizedRatio: unrealized !== null && costBasis ? unrealized / costBasis : null,
    dayChange,
    dayChangeRatio: quote?.previousClose
      ? (quote.price - quote.previousClose) / quote.previousClose
      : null,
    weight: null,
  };
}

export interface ResultBreakdown {
  /** Sum of all profitable closed trades. */
  realizedGains: number;
  /** Sum of all losing closed trades (a negative number or 0). */
  realizedLosses: number;
  /** Dividends after fees, before taxes. */
  dividends: number;
  fees: number;
  /** Taxes withheld on sales and dividends. */
  taxes: number;
  /** Number of sell transactions with a positive / negative result. */
  winningTrades: number;
  losingTrades: number;
}

export interface YearStatistics extends ResultBreakdown {
  year: number;
}

export interface InstrumentStatistics {
  position: PositionSummary;
  realizedTrades: number;
  dividends: number;
  taxes: number;
  unrealized: number | null;
  /** Realized + dividends + unrealized, minus taxes. */
  total: number;
}

export interface Statistics extends ResultBreakdown {
  netRealized: number;
  unrealized: number;
  /** Everything earned so far: realized trades, dividends and unrealized result, after taxes. */
  totalResult: number;
  byYear: YearStatistics[];
  byInstrument: InstrumentStatistics[];
}

/**
 * Aggregates realized results, dividends, fees and taxes across all positions.
 * Amounts are converted with the current exchange rate.
 */
export function computeStatistics(
  positions: readonly PositionSummary[],
  valuation: PortfolioValuation,
  convert: Converter,
): Statistics {
  const total = emptyBreakdown();
  const years = new Map<number, YearStatistics>();
  const yearOf = (date: string): YearStatistics => {
    const year = Number(date.slice(0, 4));
    let entry = years.get(year);
    if (!entry) {
      entry = { year, ...emptyBreakdown() };
      years.set(year, entry);
    }
    return entry;
  };

  for (const position of positions) {
    const currency = position.instrument.currency;
    for (const event of position.events) {
      const amount = convert(event.amount, currency) ?? 0;
      for (const target of [total, yearOf(event.date)]) addEvent(target, event.kind, amount);
    }
    for (const tx of position.transactions) {
      const fee = convert(tx.fee, currency) ?? 0;
      const tax = convert(tx.tax, currency) ?? 0;
      for (const target of [total, yearOf(tx.date)]) {
        target.fees += fee;
        target.taxes += tax;
      }
    }
  }

  const unrealizedById = new Map(
    valuation.holdings.map((h) => [h.position.instrument.id, h.unrealized]),
  );
  const byInstrument = positions
    .map((position): InstrumentStatistics => {
      const currency = position.instrument.currency;
      const realizedTrades = convert(position.realizedTrades, currency) ?? 0;
      const dividends = convert(position.dividends, currency) ?? 0;
      const taxes = convert(position.taxes, currency) ?? 0;
      const unrealized = unrealizedById.get(position.instrument.id) ?? null;
      return {
        position,
        realizedTrades,
        dividends,
        taxes,
        unrealized,
        total: realizedTrades + dividends + (unrealized ?? 0) - taxes,
      };
    })
    .sort((a, b) => b.total - a.total);

  const netRealized = total.realizedGains + total.realizedLosses;
  const unrealized = valuation.totals.unrealized;

  return {
    ...total,
    netRealized,
    unrealized,
    totalResult: netRealized + total.dividends + unrealized - total.taxes,
    byYear: [...years.values()].sort((a, b) => b.year - a.year),
    byInstrument,
  };
}

function addEvent(target: ResultBreakdown, kind: "TRADE" | "DIVIDEND", amount: number): void {
  if (kind === "DIVIDEND") {
    target.dividends += amount;
  } else if (amount >= 0) {
    target.realizedGains += amount;
    target.winningTrades += 1;
  } else {
    target.realizedLosses += amount;
    target.losingTrades += 1;
  }
}

function emptyBreakdown(): ResultBreakdown {
  return {
    realizedGains: 0,
    realizedLosses: 0,
    dividends: 0,
    fees: 0,
    taxes: 0,
    winningTrades: 0,
    losingTrades: 0,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
