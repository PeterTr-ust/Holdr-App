/**
 * Dividends and splits reported by the market data provider, and the
 * suggestions derived from them: payments and splits that affect the user's
 * holdings but are not recorded yet.
 *
 * Suggestions are never applied automatically. The user reviews each one,
 * adds missing details such as withheld taxes, and saves it as a normal
 * transaction, or dismisses it.
 */
import { quantityAt, splitFactor } from "./portfolio";
import type { Instrument, Transaction } from "./types";

/** A dividend per share, paid to everyone holding shares before the ex-date. */
export interface DividendEvent {
  /** Ex-dividend date (YYYY-MM-DD). */
  date: string;
  /**
   * Gross amount per share, in the instrument's currency. Like price
   * histories, it is adjusted for later splits.
   */
  amount: number;
}

/** A split effective on `date`: `ratioFrom` old shares become `ratioTo` new shares. */
export interface SplitEvent {
  date: string;
  ratioTo: number;
  ratioFrom: number;
}

export interface CorporateActions {
  /** Oldest first. */
  dividends: DividendEvent[];
  /** Oldest first. */
  splits: SplitEvent[];
}

interface SuggestionBase {
  /** Stable identifier, used to remember dismissed suggestions. */
  key: string;
  instrument: Instrument;
}

export interface DividendSuggestion extends SuggestionBase {
  kind: "DIVIDEND";
  event: DividendEvent;
  /** Shares held at the end of the day before the ex-date. */
  shares: number;
  /** Expected gross amount: shares times amount per share. */
  amount: number;
}

export interface SplitSuggestion extends SuggestionBase {
  kind: "SPLIT";
  event: SplitEvent;
  sharesBefore: number;
  sharesAfter: number;
}

export type Suggestion = DividendSuggestion | SplitSuggestion;

/**
 * A recorded dividend counts as the payment for an event if it is dated
 * between a few days before the ex-date (data may differ by a day or two)
 * and the usual latest payment date.
 */
const DIVIDEND_MATCH_DAYS_BEFORE = 5;
const DIVIDEND_MATCH_DAYS_AFTER = 90;
/** A recorded split within this many days of the reported date counts as the same split. */
const SPLIT_MATCH_DAYS = 5;

export function suggestionKey(symbol: string, kind: Suggestion["kind"], date: string): string {
  return `${symbol}|${kind}|${date}`;
}

/**
 * Finds dividends and splits of one instrument that affect shares the user
 * held but that have no matching transaction yet.
 */
export function findSuggestions(
  instrument: Instrument,
  transactions: readonly Transaction[],
  actions: CorporateActions,
  dismissed: ReadonlySet<string>,
): Suggestion[] {
  const own = transactions.filter((t) => t.instrumentId === instrument.id);
  const suggestions: Suggestion[] = [];

  const recordedSplits = own.filter((t) => t.type === "SPLIT");
  for (const event of actions.splits) {
    const key = suggestionKey(instrument.symbol, "SPLIT", event.date);
    if (dismissed.has(key)) continue;
    if (recordedSplits.some((t) => daysBetween(t.date, event.date) <= SPLIT_MATCH_DAYS)) continue;
    const sharesBefore = quantityAt(own, addDays(event.date, -1));
    if (sharesBefore <= 0) continue;
    suggestions.push({
      kind: "SPLIT",
      key,
      instrument,
      event,
      sharesBefore,
      sharesAfter: sharesBefore * splitFactor(event),
    });
  }

  const held = actions.dividends
    .map((event) => ({ event, shares: quantityAt(own, addDays(event.date, -1)) }))
    .filter(({ shares }) => shares > 0);

  // Each recorded dividend accounts for one event: the latest one before it.
  const matched = new Set<DividendEvent>();
  const recorded = own.filter((t) => t.type === "DIVIDEND").map((t) => t.date);
  for (const date of recorded.sort()) {
    const latestEx = addDays(date, DIVIDEND_MATCH_DAYS_BEFORE);
    const earliestEx = addDays(date, -DIVIDEND_MATCH_DAYS_AFTER);
    const candidate = held
      .filter(({ event }) => !matched.has(event))
      .filter(({ event }) => event.date >= earliestEx && event.date <= latestEx)
      .sort((a, b) => b.event.date.localeCompare(a.event.date))[0];
    if (candidate) matched.add(candidate.event);
  }

  for (const { event, shares } of held) {
    if (matched.has(event)) continue;
    const key = suggestionKey(instrument.symbol, "DIVIDEND", event.date);
    if (dismissed.has(key)) continue;
    suggestions.push({
      kind: "DIVIDEND",
      key,
      instrument,
      event,
      shares,
      // Undo the split adjustment, so the amount fits the shares held back then.
      amount: shares * event.amount * reportedSplitFactorAfter(actions.splits, event.date),
    });
  }

  return suggestions.sort((a, b) => b.event.date.localeCompare(a.event.date));
}

/**
 * Estimates the next ex-dividend date from the usual interval between past
 * payments, e.g. for companies that have not announced the date yet.
 * Returns null without a regular pattern or if payments seem to have stopped.
 */
export function estimateNextExDate(
  dividends: readonly DividendEvent[],
  today: string,
): string | null {
  const dates = dividends.map((d) => d.date).sort();
  if (dates.length < 2) return null;

  const recent = dates.slice(-5);
  const interval = median(recent.slice(1).map((date, index) => daysBetween(recent[index]!, date)));
  // Monthly to yearly payers only; anything else is too irregular to predict.
  if (interval < 25 || interval > 400) return null;

  const next = addDays(dates.at(-1)!, Math.round(interval));
  // An overdue estimate says nothing useful: the payment is late or stopped.
  return next < today ? null : next;
}

function reportedSplitFactorAfter(splits: readonly SplitEvent[], date: string): number {
  return splits.filter((s) => s.date > date).reduce((factor, s) => factor * splitFactor(s), 1);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/** Adds (or subtracts) whole days to an ISO date. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}
