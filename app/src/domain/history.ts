/**
 * Builds the portfolio value over time from per-instrument price histories.
 */
import { quantityAt, type PositionSummary } from "./portfolio";
import type { SeriesPoint } from "./types";
import type { Converter } from "./valuation";

/**
 * Returns the daily market value of all positions held at each date.
 *
 * Exchanges trade on different days, so a missing price is carried forward
 * from the instrument's previous close. Dates before the first transaction
 * are omitted.
 */
export function buildValueSeries(
  positions: readonly PositionSummary[],
  histories: ReadonlyMap<string, readonly SeriesPoint[]>,
  convert: Converter,
): SeriesPoint[] {
  const firstTradeDate = positions
    .flatMap((p) => p.transactions.map((t) => t.date))
    .sort()
    .at(0);
  if (!firstTradeDate) return [];

  const dates = [...new Set([...histories.values()].flatMap((series) => series.map((p) => p.date)))]
    .filter((date) => date >= firstTradeDate)
    .sort();

  const cursors = positions.map((position) => ({
    position,
    series: histories.get(position.instrument.symbol) ?? [],
    index: -1,
  }));

  return dates.map((date) => {
    let value = 0;
    for (const cursor of cursors) {
      // Advance to the last price at or before this date.
      while (
        cursor.index + 1 < cursor.series.length &&
        cursor.series[cursor.index + 1]!.date <= date
      ) {
        cursor.index += 1;
      }
      const price = cursor.series[cursor.index]?.value;
      if (price === undefined) continue;

      const quantity = quantityAt(cursor.position.transactions, date);
      if (quantity > 0) {
        value += convert(quantity * price, cursor.position.instrument.currency) ?? 0;
      }
    }
    return { date, value };
  });
}
