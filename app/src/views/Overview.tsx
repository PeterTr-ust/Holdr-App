/**
 * Main screen: total wealth, value history and the list of positions.
 */
import { useState } from "react";
import { tone } from "../components/tone";
import { usePortfolioSeries } from "../components/useSeries";
import { ValueChart } from "../components/ValueChart";
import { useI18n } from "../i18n";
import type { HistoryRange } from "../market/provider";
import { useApp } from "../state/AppState";

interface OverviewProps {
  onOpenPosition(instrumentId: number): void;
  onAdd(): void;
}

export function Overview({ onOpenPosition, onAdd }: OverviewProps) {
  const { t, money, percent, quantity } = useI18n();
  const { valuation, settings, convert, instruments } = useApp();
  const [range, setRange] = useState<HistoryRange>("1y");
  const { series, status } = usePortfolioSeries(range);
  const currency = settings.displayCurrency;
  const { totals, holdings, closed } = valuation;

  if (instruments.length === 0) {
    return (
      <section className="empty">
        <h2>{t("empty.title")}</h2>
        <p>{t("empty.text")}</p>
        <button type="button" className="btn btn-accent" onClick={onAdd}>
          {t("empty.action")}
        </button>
      </section>
    );
  }

  const [whole, fraction] = splitAmount(money(totals.marketValue, currency));

  return (
    <>
      <section className="hero" aria-label={t("overview.wealth")}>
        <span className="eyebrow">{t("overview.wealth")}</span>
        <div className="hero-value">
          {whole}
          {fraction && <sup>{fraction}</sup>}
        </div>
        <div className="hero-sub">
          <span className={tone(totals.unrealized)}>
            {t("overview.totalResult", {
              amount: money(totals.unrealized, currency, { signed: true }),
              ratio: percent(totals.unrealizedRatio, { signed: true }),
            })}
          </span>
          <span className={tone(totals.dayChange)}>
            {t("overview.today", { amount: money(totals.dayChange, currency, { signed: true }) })}
          </span>
        </div>
      </section>

      <ValueChart
        series={series}
        status={status}
        currency={currency}
        range={range}
        onRangeChange={setRange}
      />

      {holdings.length > 0 && (
        <section className="section">
          <h2 className="section-title">
            {t("overview.positions")} <small>{holdings.length}</small>
          </h2>
          <div className="list-scroll">
            <div className="rows" role="table">
              <div className="row head" role="row">
                <div role="columnheader">{t("overview.colPosition")}</div>
                <div role="columnheader">{t("overview.colValue")}</div>
                <div role="columnheader">{t("overview.colCost")}</div>
                <div role="columnheader">{t("overview.colResult")}</div>
              </div>
              {holdings.map((holding) => {
                const { instrument } = holding.position;
                return (
                  <button
                    key={instrument.id}
                    type="button"
                    className="row"
                    role="row"
                    onClick={() => onOpenPosition(instrument.id)}
                  >
                    <div className="row-name" role="cell">
                      {instrument.name}
                      <small>
                        {t("overview.shares", { count: quantity(holding.position.quantity) })} ·{" "}
                        {instrument.symbol}
                      </small>
                      {holding.weight !== null && (
                        <span className="weight" aria-hidden="true">
                          <i style={{ width: `${(holding.weight * 100).toFixed(1)}%` }} />
                        </span>
                      )}
                    </div>
                    <div className="row-value" role="cell">
                      {money(holding.marketValue, currency)}
                      <small>{money(holding.price, instrument.currency)}</small>
                    </div>
                    <div className="row-value" role="cell">
                      {money(holding.costBasis, currency)}
                      <small>{money(holding.position.averageCost, instrument.currency)}</small>
                    </div>
                    <div className={`row-value ${tone(holding.unrealized) ?? ""}`} role="cell">
                      {money(holding.unrealized, currency, { signed: true })}
                      <small className={tone(holding.unrealized)}>
                        {percent(holding.unrealizedRatio, { signed: true })}
                      </small>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <details className="closed section">
          <summary className="section-title">
            {t("overview.closed")} <small>{closed.length}</small>
          </summary>
          <div className="list-scroll">
            <div className="rows" role="table">
              {closed.map((position) => {
                const realized = convert(
                  position.realizedTrades + position.dividends,
                  position.instrument.currency,
                );
                return (
                  <button
                    key={position.instrument.id}
                    type="button"
                    className="row"
                    role="row"
                    onClick={() => onOpenPosition(position.instrument.id)}
                  >
                    <div className="row-name" role="cell">
                      {position.instrument.name}
                      <small>{position.instrument.symbol}</small>
                    </div>
                    <div role="cell" />
                    <div className="row-value muted" role="cell">
                      {t("overview.colRealized")}
                    </div>
                    <div className={`row-value ${tone(realized) ?? ""}`} role="cell">
                      {money(realized, currency, { signed: true })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </details>
      )}
    </>
  );
}

/**
 * Splits "43.394,90 €" into "43.394" and ",90 €" so the hero can render the
 * decimals smaller. Falls back to the whole string for unexpected formats.
 */
function splitAmount(formatted: string): [string, string] {
  const match = /^(.*?\d)([.,]\d{2}(?:\s?\D+)?)$/.exec(formatted.trim());
  return match ? [match[1]!, match[2]!] : [formatted, ""];
}
