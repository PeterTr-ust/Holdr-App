/**
 * Statistics: realized gains and losses, dividends, fees and unrealized
 * results, in total, per year and per position.
 */
import { tone } from "../components/tone";
import { useI18n } from "../i18n";
import { useApp } from "../state/AppState";

interface StatisticsViewProps {
  onOpenPosition(instrumentId: number): void;
}

export function StatisticsView({ onOpenPosition }: StatisticsViewProps) {
  const { t, money, percent } = useI18n();
  const { statistics: stats, settings } = useApp();
  const currency = settings.displayCurrency;
  const signed = (value: number | null) => money(value, currency, { signed: true });
  const trades = stats.winningTrades + stats.losingTrades;

  return (
    <>
      <section className="hero">
        <span className="eyebrow">{t("stats.totalResult")}</span>
        <div className={`hero-value ${tone(stats.totalResult) ?? ""}`}>
          {signed(stats.totalResult)}
        </div>
        <span className="muted">{t("stats.totalResultHint")}</span>
      </section>

      <section className="stat-grid" aria-label={t("stats.title")}>
        <Stat
          label={t("stats.realizedGains")}
          value={signed(stats.realizedGains)}
          tone={tone(stats.realizedGains)}
        />
        <Stat
          label={t("stats.realizedLosses")}
          value={signed(stats.realizedLosses)}
          tone={tone(stats.realizedLosses)}
        />
        <Stat
          label={t("stats.netRealized")}
          value={signed(stats.netRealized)}
          tone={tone(stats.netRealized)}
        />
        <Stat
          label={t("stats.dividends")}
          value={signed(stats.dividends)}
          tone={tone(stats.dividends)}
        />
        <Stat
          label={t("stats.unrealized")}
          value={signed(stats.unrealized)}
          tone={tone(stats.unrealized)}
        />
        <Stat label={t("stats.fees")} value={money(stats.fees, currency)} />
        <Stat label={t("stats.taxes")} value={money(stats.taxes, currency)} />
        <Stat
          label={t("stats.winRate")}
          value={trades > 0 ? percent(stats.winningTrades / trades) : t("common.notAvailable")}
          hint={
            trades > 0
              ? t("stats.winRateDetail", { wins: stats.winningTrades, total: trades })
              : undefined
          }
        />
      </section>

      {stats.byYear.length === 0 ? (
        <p className="muted">{t("stats.empty")}</p>
      ) : (
        <section className="section">
          <h2 className="section-title">{t("stats.byYear")}</h2>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">{t("stats.year")}</th>
                  <th scope="col">{t("stats.colGains")}</th>
                  <th scope="col">{t("stats.colLosses")}</th>
                  <th scope="col">{t("stats.colDividends")}</th>
                  <th scope="col">{t("stats.colFees")}</th>
                  <th scope="col">{t("stats.colTaxes")}</th>
                  <th scope="col">{t("stats.colNet")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.byYear.map((year) => {
                  const net =
                    year.realizedGains + year.realizedLosses + year.dividends - year.taxes;
                  return (
                    <tr key={year.year}>
                      <td>{year.year}</td>
                      <td className={tone(year.realizedGains)}>{signed(year.realizedGains)}</td>
                      <td className={tone(year.realizedLosses)}>{signed(year.realizedLosses)}</td>
                      <td>{money(year.dividends, currency)}</td>
                      <td>{money(year.fees, currency)}</td>
                      <td>{money(year.taxes, currency)}</td>
                      <td className={tone(net)}>{signed(net)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {stats.byInstrument.length > 0 && (
        <section className="section">
          <h2 className="section-title">{t("stats.byPosition")}</h2>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">{t("overview.colPosition")}</th>
                  <th scope="col">{t("stats.colRealized")}</th>
                  <th scope="col">{t("stats.colDividends")}</th>
                  <th scope="col">{t("stats.colTaxes")}</th>
                  <th scope="col">{t("stats.colUnrealized")}</th>
                  <th scope="col">{t("stats.colTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.byInstrument.map((entry) => (
                  <tr
                    key={entry.position.instrument.id}
                    onClick={() => onOpenPosition(entry.position.instrument.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{entry.position.instrument.name}</td>
                    <td className={tone(entry.realizedTrades)}>{signed(entry.realizedTrades)}</td>
                    <td>{money(entry.dividends, currency)}</td>
                    <td>{money(entry.taxes, currency)}</td>
                    <td className={tone(entry.unrealized)}>{signed(entry.unrealized)}</td>
                    <td className={tone(entry.total)}>{signed(entry.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="note">{t("stats.note")}</p>
    </>
  );
}

function Stat({
  label,
  value,
  tone: valueTone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <strong className={valueTone}>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}
