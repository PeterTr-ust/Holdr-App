/**
 * Hooks that load price histories and turn them into chart series.
 */
import { useEffect, useMemo, useState } from "react";
import { buildValueSeries } from "../domain/history";
import type { SeriesPoint } from "../domain/types";
import type { HistoryRange } from "../market/provider";
import { useApp } from "../state/AppState";
import type { SeriesStatus } from "./ValueChart";

interface SeriesResult {
  series: SeriesPoint[];
  status: SeriesStatus;
}

/** Market value of the whole portfolio over the given range. */
export function usePortfolioSeries(range: HistoryRange): SeriesResult {
  const { positions, getHistory, convert } = useApp();
  const symbols = useMemo(() => positions.map((p) => p.instrument.symbol), [positions]);
  const { data, status } = useHistories(symbols, range, getHistory);

  const series = useMemo(
    () => (data ? buildValueSeries(positions, data, convert) : []),
    [data, positions, convert],
  );
  return { series, status };
}

/** Price history of a single instrument, in its own currency. */
export function useInstrumentSeries(symbol: string, range: HistoryRange): SeriesResult {
  const { getHistory } = useApp();
  const symbols = useMemo(() => [symbol], [symbol]);
  const { data, status } = useHistories(symbols, range, getHistory);
  return { series: data?.get(symbol) ?? [], status };
}

function useHistories(
  symbols: readonly string[],
  range: HistoryRange,
  getHistory: (symbol: string, range: HistoryRange) => Promise<SeriesPoint[]>,
) {
  const [state, setState] = useState<{
    key: string;
    data: Map<string, SeriesPoint[]> | null;
    failed: boolean;
  }>({ key: "", data: null, failed: false });
  const key = `${range}|${symbols.join(",")}`;

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(symbols.map((symbol) => getHistory(symbol, range))).then((results) => {
      if (cancelled) return;
      const data = new Map<string, SeriesPoint[]>();
      results.forEach((result, index) => {
        if (result.status === "fulfilled") data.set(symbols[index]!, result.value);
      });
      setState({ key, data, failed: data.size < symbols.length });
    });
    return () => {
      cancelled = true;
    };
  }, [key, symbols, range, getHistory]);

  // While a new range loads, keep showing nothing rather than stale data.
  const current = state.key === key;
  const status: SeriesStatus = !current
    ? "loading"
    : state.failed && state.data?.size === 0
      ? "error"
      : "ready";
  return { data: current ? state.data : null, status };
}
