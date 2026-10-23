/**
 * Watchlist: instruments the user follows without owning them, with price,
 * today's change and the change since they were added.
 */
import { useState } from "react";
import { InstrumentSearch, PickedInstrument } from "../components/InstrumentSearch";
import { Modal } from "../components/Modal";
import { tone } from "../components/tone";
import { useInstrumentSeries } from "../components/useSeries";
import { ValueChart } from "../components/ValueChart";
import type { InstrumentSearchResult, WatchlistItem } from "../domain/types";
import { useI18n } from "../i18n";
import type { HistoryRange } from "../market/provider";
import { useApp } from "../state/AppState";

interface WatchlistViewProps {
  /** Opens the purchase dialog for a watched instrument. */
  onBuy(result: InstrumentSearchResult): void;
}

export function WatchlistView({ onBuy }: WatchlistViewProps) {
  const { t, money, percent, date } = useI18n();
  const { watchlist, quotes, positions } = useApp();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<WatchlistItem | null>(null);
  const owned = new Set(positions.filter((p) => p.quantity > 0).map((p) => p.instrument.symbol));
  const sorted = [...watchlist].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="toolbar">
        <h1 className="section-title" style={{ margin: 0, fontSize: "1.6rem" }}>
          {t("watch.title")} <small>{watchlist.length}</small>
        </h1>
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={() => setAdding(true)}>
          + {t("watch.add")}
        </button>
      </div>

      {watchlist.length === 0 ? (
        <section className="empty">
          <h2>{t("watch.emptyTitle")}</h2>
          <p>{t("watch.emptyText")}</p>
          <button type="button" className="btn btn-accent" onClick={() => setAdding(true)}>
            {t("watch.addTitle")}
          </button>
        </section>
      ) : (
        <div className="list-scroll">
          <div className="rows" role="table">
            <div className="row head" role="row">
              <div role="columnheader">{t("overview.colPosition")}</div>
              <div role="columnheader">{t("watch.colPrice")}</div>
              <div role="columnheader">{t("watch.colToday")}</div>
              <div role="columnheader">{t("watch.colSince")}</div>
            </div>
            {sorted.map((item) => {
              const quote = quotes.get(item.symbol);
              const today = quote?.previousClose
                ? (quote.price - quote.previousClose) / quote.previousClose
                : null;
              const since =
                quote && item.addedPrice ? (quote.price - item.addedPrice) / item.addedPrice : null;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="row"
                  role="row"
                  onClick={() => setSelected(item)}
                >
                  <div className="row-name" role="cell">
                    {item.name}
                    <small>
                      {[item.symbol, item.exchange].filter(Boolean).join(" · ")}
                      {owned.has(item.symbol) && (
                        <span className="chip owned">{t("watch.owned")}</span>
                      )}
                    </small>
                  </div>
                  <div className="row-value" role="cell">
                    {money(quote?.price ?? null, item.currency)}
                  </div>
                  <div className={`row-value ${tone(today) ?? ""}`} role="cell">
                    {percent(today, { signed: true })}
                  </div>
                  <div className={`row-value ${tone(since) ?? ""}`} role="cell">
                    {percent(since, { signed: true })}
                    <small>{t("watch.since", { date: date(item.addedAt.slice(0, 10)) })}</small>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {adding && <AddToWatchlistDialog onClose={() => setAdding(false)} />}
      {selected && (
        <WatchItemDialog
          item={selected}
          onClose={() => setSelected(null)}
          onBuy={() => {
            setSelected(null);
            onBuy(selected);
          }}
        />
      )}
    </>
  );
}

function AddToWatchlistDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const { lookupQuote, addToWatchlist } = useApp();
  const [picked, setPicked] = useState<InstrumentSearchResult | null>(null);
  const [failed, setFailed] = useState(false);

  const pick = async (result: InstrumentSearchResult) => {
    setPicked(result);
    setFailed(false);
    try {
      await addToWatchlist(result, await lookupQuote(result.symbol));
      onClose();
    } catch {
      setFailed(true);
    }
  };

  return (
    <Modal title={t("watch.addTitle")} onClose={onClose}>
      {picked === null ? (
        <InstrumentSearch onPick={(result) => void pick(result)} />
      ) : (
        <>
          <PickedInstrument result={picked} onChange={() => setPicked(null)} />
          {failed ? (
            <p className="form-error">{t("watch.addError")}</p>
          ) : (
            <p className="muted">{t("watch.adding")}</p>
          )}
        </>
      )}
    </Modal>
  );
}

interface WatchItemDialogProps {
  item: WatchlistItem;
  onClose(): void;
  onBuy(): void;
}

function WatchItemDialog({ item, onClose, onBuy }: WatchItemDialogProps) {
  const { t, money } = useI18n();
  const { quotes, removeFromWatchlist } = useApp();
  const [range, setRange] = useState<HistoryRange>("1y");
  const { series, status } = useInstrumentSeries(item.symbol, range);
  const quote = quotes.get(item.symbol);

  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="hero-sub">
        <span className="muted">{[item.symbol, item.exchange].filter(Boolean).join(" · ")}</span>
        <span>{money(quote?.price ?? null, item.currency)}</span>
      </div>
      <ValueChart
        series={series}
        status={status}
        currency={item.currency}
        range={range}
        onRangeChange={setRange}
      />
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-text btn-text-danger"
          style={{ marginRight: "auto" }}
          onClick={() => void removeFromWatchlist(item).then(onClose)}
        >
          {t("watch.remove")}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          {t("common.close")}
        </button>
        <button type="button" className="btn btn-accent" onClick={onBuy}>
          {t("watch.buy")}
        </button>
      </div>
    </Modal>
  );
}
