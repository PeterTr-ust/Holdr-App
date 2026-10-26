/**
 * Detail screen of one instrument: key figures, profile and upcoming dates,
 * price chart, suggested dividends and splits, and all transactions with
 * options to add, edit and delete them.
 */
import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { BackIcon, PlusIcon } from "../components/icons";
import { Modal } from "../components/Modal";
import { tone } from "../components/tone";
import { TransactionForm } from "../components/TransactionForm";
import { useInstrumentSeries } from "../components/useSeries";
import { ValueChart } from "../components/ValueChart";
import { estimateNextExDate, type Suggestion } from "../domain/corporateActions";
import { OversellError } from "../domain/portfolio";
import type { Transaction, TransactionType } from "../domain/types";
import { useI18n } from "../i18n";
import type { HistoryRange } from "../market/provider";
import { useApp, type TransactionDraft } from "../state/AppState";
import { todayIso } from "../util/input";

interface PositionViewProps {
  instrumentId: number;
  onBack(): void;
}

type Editing =
  | { mode: "new"; type: TransactionType; draft?: TransactionDraft }
  | { mode: "edit"; transaction: Transaction };

/** A suggestion as a prefilled transaction; dividends start without taxes, the user adds them. */
function draftFor(suggestion: Suggestion): TransactionDraft {
  const common = { date: suggestion.event.date, fee: 0, tax: 0, note: null };
  return suggestion.kind === "DIVIDEND"
    ? { ...common, type: "DIVIDEND", amount: Math.round(suggestion.amount * 100) / 100 }
    : {
        ...common,
        type: "SPLIT",
        ratioTo: suggestion.event.ratioTo,
        ratioFrom: suggestion.event.ratioFrom,
      };
}

export function PositionView({ instrumentId, onBack }: PositionViewProps) {
  const i18n = useI18n();
  const { t, money, percent, quantity, date } = i18n;
  const app = useApp();
  const { settings, valuation, positions, convert, capabilities } = app;
  const [range, setRange] = useState<HistoryRange>("1y");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [deletingPosition, setDeletingPosition] = useState(false);

  const position = positions.find((p) => p.instrument.id === instrumentId);
  const instrument = position?.instrument ?? app.instruments.find((i) => i.id === instrumentId);
  const { series, status } = useInstrumentSeries(instrument?.symbol ?? "", range);

  if (!instrument) return null;

  const holding = valuation.holdings.find((h) => h.position.instrument.id === instrumentId);
  const currency = settings.displayCurrency;
  const transactions = position ? [...position.transactions].reverse() : [];
  const realized = position ? convert(position.realizedTrades, instrument.currency) : null;
  const dividends = position ? convert(position.dividends, instrument.currency) : null;
  const quote = holding?.quote;

  const profile = app.profiles.get(instrument.symbol);
  const upcoming = app.upcomingEvents.get(instrument.symbol);
  const actions = app.corporateActions.get(instrument.symbol);
  const suggestions = app.suggestions.filter((s) => s.instrument.id === instrumentId);
  const estimatedExDate = actions ? estimateNextExDate(actions.dividends, todayIso()) : null;

  // Amount paid for a purchase, or received for a sale or dividend; none for a split.
  const transactionTotal = (tx: Transaction) => {
    switch (tx.type) {
      case "DIVIDEND":
        return tx.amount - tx.fee - tx.tax;
      case "BUY":
        return tx.quantity * tx.price + tx.fee;
      case "SELL":
        return tx.quantity * tx.price - tx.fee - tx.tax;
      case "SPLIT":
        return null;
    }
  };

  return (
    <>
      <div>
        <button type="button" className="btn btn-text" onClick={onBack}>
          <BackIcon /> {t("common.back")}
        </button>
      </div>

      <header className="detail-head">
        <span className="eyebrow">
          {[instrument.symbol, instrument.exchange, instrument.currency]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <h1>{instrument.name}</h1>
        <div className="hero-sub">
          {holding ? (
            <>
              <span>{money(holding.marketValue, currency)}</span>
              <span className={tone(holding.unrealized)}>
                {money(holding.unrealized, currency, { signed: true })} (
                {percent(holding.unrealizedRatio, { signed: true })})
              </span>
            </>
          ) : (
            <span className="muted">{t("position.closed")}</span>
          )}
        </div>
      </header>

      <dl className="facts">
        <Fact label={t("position.shares")} value={quantity(position?.quantity ?? 0)} />
        <Fact
          label={t("position.averageCost")}
          value={money(position?.averageCost ?? null, instrument.currency)}
        />
        <Fact
          label={t("position.price")}
          value={money(quote?.price ?? null, instrument.currency)}
        />
        <Fact
          label={t("position.today")}
          value={percent(holding?.dayChangeRatio ?? null, { signed: true })}
          tone={tone(holding?.dayChangeRatio)}
        />
        <Fact label={t("position.costBasis")} value={money(holding?.costBasis ?? null, currency)} />
        <Fact
          label={t("position.realized")}
          value={money(realized, currency, { signed: true })}
          tone={tone(realized)}
        />
        <Fact label={t("position.dividends")} value={money(dividends, currency)} />
        <Fact
          label={t("position.fees")}
          value={money(position ? convert(position.fees, instrument.currency) : null, currency)}
        />
        <Fact
          label={t("position.taxes")}
          value={money(position ? convert(position.taxes, instrument.currency) : null, currency)}
        />
      </dl>

      {(capabilities.profiles || (capabilities.upcomingEvents && holding)) && (
        <section className="section" aria-label={t("position.profileTitle")}>
          <dl className="facts">
            {capabilities.profiles && (
              <>
                <Fact
                  label={t("position.sector")}
                  value={
                    profile?.sector
                      ? t(`sector.${profile.sector}`)
                      : profile?.sectorWeights
                        ? t("position.sectorFund")
                        : t("common.notAvailable")
                  }
                  hint={profile?.industry ?? undefined}
                />
                <Fact
                  label={t("position.country")}
                  value={
                    profile?.country ? i18n.country(profile.country) : t("common.notAvailable")
                  }
                />
              </>
            )}
            {capabilities.upcomingEvents && holding && (
              <>
                <Fact
                  label={t("position.nextExDate")}
                  value={
                    upcoming?.exDividendDate
                      ? date(upcoming.exDividendDate)
                      : estimatedExDate
                        ? t("position.estimated", { date: date(estimatedExDate) })
                        : t("common.notAvailable")
                  }
                  hint={
                    !upcoming?.exDividendDate && estimatedExDate
                      ? t("position.estimatedHint")
                      : undefined
                  }
                />
                <Fact
                  label={t("position.nextPayment")}
                  value={
                    upcoming?.dividendPaymentDate
                      ? date(upcoming.dividendPaymentDate)
                      : t("common.notAvailable")
                  }
                />
                <Fact
                  label={t("position.nextEarnings")}
                  value={
                    upcoming?.earningsDate ? date(upcoming.earningsDate) : t("common.notAvailable")
                  }
                  hint={
                    upcoming?.earningsDateEstimated ? t("position.earningsEstimated") : undefined
                  }
                />
              </>
            )}
          </dl>
        </section>
      )}

      <ValueChart
        series={series}
        status={status}
        currency={instrument.currency}
        range={range}
        onRangeChange={setRange}
      />

      {suggestions.length > 0 && (
        <section className="section">
          <h2 className="section-title">
            {t("suggest.title")} <small>{suggestions.length}</small>
          </h2>
          <p className="muted section-intro">{t("suggest.intro")}</p>
          <div className="rows">
            {suggestions.map((suggestion) => (
              <div key={suggestion.key} className="suggestion">
                <span>
                  <span className={`chip ${suggestion.kind}`}>{t(`tx.${suggestion.kind}`)}</span>
                </span>
                <span className="suggestion-text">
                  {suggestion.kind === "DIVIDEND"
                    ? t("suggest.dividend", {
                        date: date(suggestion.event.date),
                        shares: quantity(suggestion.shares),
                        amount: money(suggestion.amount, instrument.currency),
                      })
                    : t("suggest.split", {
                        date: date(suggestion.event.date),
                        ratio: t("tx.splitRatio", {
                          to: quantity(suggestion.event.ratioTo),
                          from: quantity(suggestion.event.ratioFrom),
                        }),
                        before: quantity(suggestion.sharesBefore),
                        after: quantity(suggestion.sharesAfter),
                      })}
                </span>
                <span className="tx-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        mode: "new",
                        type: suggestion.kind,
                        draft: draftFor(suggestion),
                      })
                    }
                  >
                    {t("suggest.accept")}
                  </button>
                  <button type="button" onClick={() => void app.dismissSuggestion(suggestion)}>
                    {t("suggest.dismiss")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="toolbar">
          <h2 className="section-title" style={{ margin: 0 }}>
            {t("position.transactions")} <small>{transactions.length}</small>
          </h2>
          <span className="spacer" />
          {(["BUY", "SELL", "DIVIDEND", "SPLIT"] as const).map((type) => (
            <button
              key={type}
              type="button"
              className="btn btn-quiet"
              disabled={(type === "SELL" || type === "SPLIT") && !holding}
              onClick={() => setEditing({ mode: "new", type })}
            >
              <PlusIcon />
              {t(ADD_LABELS[type])}
            </button>
          ))}
        </div>

        {transactions.length === 0 ? (
          <p className="muted">{t("position.noTransactions")}</p>
        ) : (
          <div className="list-scroll">
            <div className="rows">
              <div className="tx-row head">
                <span>{t("tx.date")}</span>
                <span>{t("tx.type")}</span>
                <span>{t("tx.quantity")}</span>
                <span>{t("tx.price", { currency: instrument.currency })}</span>
                <span>{t("tx.total")}</span>
                <span />
              </div>
              {transactions.map((tx) => (
                <div key={tx.id} className="tx-row" title={tx.note ?? undefined}>
                  <span>{date(tx.date)}</span>
                  <span>
                    <span className={`chip ${tx.type}`}>{t(`tx.${tx.type}`)}</span>
                  </span>
                  <span>
                    {tx.type === "SPLIT"
                      ? t("tx.splitRatio", {
                          to: quantity(tx.ratioTo),
                          from: quantity(tx.ratioFrom),
                        })
                      : tx.type === "DIVIDEND"
                        ? ""
                        : quantity(tx.quantity)}
                  </span>
                  <span>
                    {tx.type === "BUY" || tx.type === "SELL"
                      ? money(tx.price, instrument.currency)
                      : ""}
                  </span>
                  <span>
                    {tx.type === "SPLIT" ? "" : money(transactionTotal(tx), instrument.currency)}
                  </span>
                  <span className="tx-actions">
                    <button
                      type="button"
                      onClick={() => setEditing({ mode: "edit", transaction: tx })}
                    >
                      {t("common.edit")}
                    </button>
                    <button type="button" onClick={() => setDeletingTx(tx)}>
                      {t("common.delete")}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div>
        <button
          type="button"
          className="btn btn-text btn-text-danger"
          onClick={() => setDeletingPosition(true)}
        >
          {t("position.delete")}
        </button>
      </div>

      {editing && (
        <Modal
          title={t(editing.mode === "new" ? "tx.new" : "tx.edit", { name: instrument.name })}
          onClose={() => setEditing(null)}
        >
          <TransactionForm
            currency={instrument.currency}
            initial={editing.mode === "edit" ? editing.transaction : editing.draft}
            initialType={editing.mode === "new" ? editing.type : undefined}
            types={editing.mode === "new" && editing.draft ? [editing.type] : undefined}
            suggestedPrice={quote?.price ?? null}
            submitLabel={t("common.save")}
            onCancel={() => setEditing(null)}
            onSubmit={async (draft) => {
              if (editing.mode === "edit") {
                const { id, createdAt } = editing.transaction;
                await app.saveTransaction({ ...draft, id, createdAt, instrumentId } as Transaction);
              } else {
                await app.saveTransaction({ ...draft, instrumentId });
              }
              setEditing(null);
            }}
          />
        </Modal>
      )}

      {deletingTx && (
        <ConfirmDialog
          title={t("tx.deleteTitle")}
          text={t("tx.deleteText", {
            type: t(`tx.${deletingTx.type}`),
            date: date(deletingTx.date),
          })}
          confirmLabel={t("common.delete")}
          onClose={() => setDeletingTx(null)}
          onConfirm={async () => {
            try {
              await app.deleteTransaction(deletingTx);
            } catch (error) {
              if (error instanceof OversellError) {
                throw new Error(
                  t("tx.errorOversell", {
                    date: date(error.transaction.date),
                    available: quantity(error.available),
                  }),
                  { cause: error },
                );
              }
              throw error;
            }
          }}
        />
      )}

      {deletingPosition && (
        <ConfirmDialog
          title={t("position.deleteTitle", { name: instrument.name })}
          text={t("position.deleteText", { count: position?.transactions.length ?? 0 })}
          confirmLabel={t("common.delete")}
          onClose={() => setDeletingPosition(false)}
          onConfirm={async () => {
            await app.deleteInstrument(instrument);
            onBack();
          }}
        />
      )}
    </>
  );
}

const ADD_LABELS = {
  BUY: "position.addBuy",
  SELL: "position.addSell",
  DIVIDEND: "position.addDividend",
  SPLIT: "position.addSplit",
} as const;

interface FactProps {
  label: string;
  value: string;
  tone?: string;
  /** Small text below the value. */
  hint?: string;
}

function Fact({ label, value, tone: valueTone, hint }: FactProps) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={valueTone}>{value}</dd>
      {hint && <small className="fact-hint">{hint}</small>}
    </div>
  );
}
