/**
 * Line chart for a value or price series with range picker and hover readout.
 * Drawn as plain SVG in pixel space; no charting library needed.
 */
import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import type { CurrencyCode, SeriesPoint } from "../domain/types";
import { useI18n } from "../i18n";
import { HISTORY_RANGES, type HistoryRange } from "../market/provider";

export type SeriesStatus = "loading" | "ready" | "error";

interface ValueChartProps {
  series: readonly SeriesPoint[];
  status: SeriesStatus;
  currency: CurrencyCode;
  range: HistoryRange;
  onRangeChange(range: HistoryRange): void;
}

const HEIGHT = 180;
const PADDING_TOP = 28; // room for the hover tooltip
const PADDING_BOTTOM = 6;

export function ValueChart({ series, status, currency, range, onRangeChange }: ValueChartProps) {
  const { t, money, date } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const geometry = width > 0 && series.length > 1 ? layout(series, width) : null;
  const hovered = hoverIndex !== null && geometry ? geometry.points[hoverIndex] : undefined;

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const index = Math.round((x / width) * (series.length - 1));
    setHoverIndex(Math.max(0, Math.min(series.length - 1, index)));
  };

  let content;
  if (status === "loading" && series.length === 0) {
    content = <div className="chart-message">{t("chart.loading")}</div>;
  } else if (status === "error" && series.length === 0) {
    content = <div className="chart-message">{t("chart.error")}</div>;
  } else if (!geometry) {
    content = <div className="chart-message">{width > 0 ? t("chart.empty") : null}</div>;
  } else {
    const last = geometry.points.at(-1)!;
    content = (
      <>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={t("chart.aria", { range: t(`chart.${range}`) })}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {geometry.gridLines.map((y) => (
            <line key={y} x1="0" x2={width} y1={y} y2={y} stroke="var(--line)" strokeWidth="1" />
          ))}
          <path d={geometry.area} fill="url(#chart-fill)" />
          <path
            d={geometry.line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={last.x} cy={last.y} r="4.5" fill="var(--accent)" />
          {hovered && (
            <>
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={PADDING_TOP - 4}
                y2={HEIGHT}
                stroke="var(--mute)"
                strokeDasharray="3 3"
              />
              <circle
                cx={hovered.x}
                cy={hovered.y}
                r="4"
                fill="var(--bg)"
                stroke="var(--accent)"
                strokeWidth="2"
              />
            </>
          )}
        </svg>
        {hovered && hoverIndex !== null && (
          <div
            className="chart-tooltip"
            style={{ left: Math.min(Math.max(hovered.x, 80), width - 80) }}
          >
            {date(series[hoverIndex]!.date)} · {money(series[hoverIndex]!.value, currency)}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="chart">
      <div className="ranges" role="group" aria-label={t("chart.label")}>
        {HISTORY_RANGES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === range}
            onClick={() => onRangeChange(option)}
          >
            {t(`chart.${option}`)}
          </button>
        ))}
      </div>
      <div className="chart-area" ref={containerRef}>
        {content}
      </div>
    </div>
  );
}

interface Geometry {
  points: { x: number; y: number }[];
  line: string;
  area: string;
  gridLines: number[];
}

function layout(series: readonly SeriesPoint[], width: number): Geometry {
  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Avoid a division by zero for flat series and keep some headroom.
  const span = max - min || Math.abs(max) || 1;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const points = series.map((point, index) => ({
    x: (index / (series.length - 1)) * width,
    y: PADDING_TOP + (1 - (point.value - min) / span) * plotHeight,
  }));
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join("");

  return {
    points,
    line,
    area: `${line}L${width},${HEIGHT}L0,${HEIGHT}Z`,
    gridLines: [PADDING_TOP, PADDING_TOP + plotHeight / 2, PADDING_TOP + plotHeight],
  };
}

/** Tracks the rendered width of an element. */
function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
