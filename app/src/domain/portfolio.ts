/**
 * Position accounting for Holdr.
 *
 * Realized gains are calculated with the FIFO method (first in, first out),
 * which is also the method required for private investors by German tax law.
 * Realized results are after fees but before taxes; taxes are summed
 * separately, so gains and the tax paid on them can both be shown.
 * All amounts in this module are in the instrument's own currency.
 */
import type { Instrument, TradeTransaction, Transaction } from "./types";

/** Tolerance for floating point share counts (fractional shares). */
const QUANTITY_EPSILON = 1e-9;

/** Order in which transactions on the same day are applied. */
const SAME_DAY_ORDER: Record<Transaction["type"], number> = { BUY: 0, DIVIDEND: 1, SELL: 2 };

/** A realized result: a closed (part of a) lot or a dividend payment. */
export interface RealizedEvent {
  transactionId: number;
  date: string;
  kind: "TRADE" | "DIVIDEND";
  /** Profit (positive) or loss (negative), after fees and before taxes. */
  amount: number;
  /** Taxes withheld on this sale or dividend. */
  tax: number;
}

/** Remaining open shares from one buy transaction. */
export interface OpenLot {
  transactionId: number;
  date: string;
  quantity: number;
  /** Cost per share including the proportional purchase fee. */
  unitCost: number;
}

export interface PositionSummary {
  instrument: Instrument;
  /** All transactions in the order they were applied. */
  transactions: Transaction[];
  openLots: OpenLot[];
  /** Shares currently held. */
  quantity: number;
  /** Purchase cost of the shares currently held, fees included. */
  costBasis: number;
  /** Average purchase cost per held share, or null if nothing is held. */
  averageCost: number | null;
  /** Sum of realized trade results (gains minus losses). */
  realizedTrades: number;
  /** Sum of dividends after fees and before taxes. */
  dividends: number;
  /** All fees paid on this instrument. */
  fees: number;
  /** All taxes withheld on sales and dividends of this instrument. */
  taxes: number;
  events: RealizedEvent[];
}

/** Thrown when a sell transaction exceeds the number of shares held at that time. */
export class OversellError extends Error {
  constructor(
    readonly transaction: TradeTransaction,
    readonly available: number,
  ) {
    super(
      `Cannot sell ${transaction.quantity} shares on ${transaction.date}: only ${available} held.`,
    );
    this.name = "OversellError";
  }
}

/** Sorts transactions chronologically; on the same day buys come before sells. */
export function sortTransactions<T extends Pick<Transaction, "date" | "type" | "id">>(
  transactions: readonly T[],
): T[] {
  return [...transactions].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      SAME_DAY_ORDER[a.type] - SAME_DAY_ORDER[b.type] ||
      a.id - b.id,
  );
}

/**
 * Replays all transactions of one instrument and derives holdings, cost basis
 * and realized results.
 *
 * @throws OversellError if a sell exceeds the shares held at that date.
 */
export function computePosition(
  instrument: Instrument,
  transactions: readonly Transaction[],
): PositionSummary {
  const ordered = sortTransactions(transactions.filter((t) => t.instrumentId === instrument.id));
  const openLots: OpenLot[] = [];
  const events: RealizedEvent[] = [];
  let fees = 0;
  let taxes = 0;

  for (const tx of ordered) {
    fees += tx.fee;
    taxes += tx.tax;

    switch (tx.type) {
      case "BUY":
        openLots.push({
          transactionId: tx.id,
          date: tx.date,
          quantity: tx.quantity,
          unitCost: tx.price + tx.fee / tx.quantity,
        });
        break;

      case "SELL": {
        const consumedCost = consumeLots(openLots, tx);
        const proceeds = tx.quantity * tx.price - tx.fee;
        events.push({
          transactionId: tx.id,
          date: tx.date,
          kind: "TRADE",
          amount: proceeds - consumedCost,
          tax: tx.tax,
        });
        break;
      }

      case "DIVIDEND":
        events.push({
          transactionId: tx.id,
          date: tx.date,
          kind: "DIVIDEND",
          amount: tx.amount - tx.fee,
          tax: tx.tax,
        });
        break;
    }
  }

  const quantity = sum(openLots.map((lot) => lot.quantity));
  const costBasis = sum(openLots.map((lot) => lot.quantity * lot.unitCost));

  return {
    instrument,
    transactions: ordered,
    openLots,
    quantity,
    costBasis,
    averageCost: quantity > QUANTITY_EPSILON ? costBasis / quantity : null,
    realizedTrades: sum(events.filter((e) => e.kind === "TRADE").map((e) => e.amount)),
    dividends: sum(events.filter((e) => e.kind === "DIVIDEND").map((e) => e.amount)),
    fees,
    taxes,
    events,
  };
}

/**
 * Checks whether the given transactions are consistent, i.e. no sell exceeds
 * the shares held at that date. Returns the first offending error or null.
 */
export function findOversell(
  instrument: Instrument,
  transactions: readonly Transaction[],
): OversellError | null {
  try {
    computePosition(instrument, transactions);
    return null;
  } catch (error) {
    if (error instanceof OversellError) return error;
    throw error;
  }
}

/** Returns the number of shares held at the end of the given date. */
export function quantityAt(transactions: readonly Transaction[], date: string): number {
  let quantity = 0;
  for (const tx of transactions) {
    if (tx.date > date) continue;
    if (tx.type === "BUY") quantity += tx.quantity;
    if (tx.type === "SELL") quantity -= tx.quantity;
  }
  return Math.max(0, quantity);
}

/** Removes shares from the oldest lots first and returns their purchase cost. */
function consumeLots(openLots: OpenLot[], sell: TradeTransaction): number {
  const available = sum(openLots.map((lot) => lot.quantity));
  if (sell.quantity > available + QUANTITY_EPSILON) {
    throw new OversellError(sell, available);
  }

  let remaining = sell.quantity;
  let cost = 0;
  while (remaining > QUANTITY_EPSILON && openLots.length > 0) {
    const lot = openLots[0]!;
    const taken = Math.min(lot.quantity, remaining);
    cost += taken * lot.unitCost;
    lot.quantity -= taken;
    remaining -= taken;
    if (lot.quantity <= QUANTITY_EPSILON) openLots.shift();
  }
  return cost;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
