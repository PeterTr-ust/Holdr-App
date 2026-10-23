/**
 * Detail screen of one instrument: key figures, price chart and all
 * transactions with options to add, edit and delete them.
 */
import { useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { BackIcon, PlusIcon } from "../components/icons";
import { Modal } from "../components/Modal";
import { tone } from "../components/tone";
import { TransactionForm } from "../components/TransactionForm";
import { useInstrumentSeries } from "../components/useSeries";
import { ValueChart } from "../components/ValueChart";
import { OversellError } from "../domain/portfolio";
import type { Transaction, TransactionType } from "../domain/types";
import { useI18n } from "../i18n";
import type { HistoryRange } from "../market/provider";
import { useApp } from "../state/AppState";

interface PositionViewProps {
  instrumentId: number;
  onBack(): void;
}

type Editing = { mode: "new"; type: TransactionType } | { mode: "edit"; transaction: Transaction };

export function PositionView({ instrumentId, onBack }: PositionViewProps) {
  const i18n = useI18n();
  const { t, money, percent, quantity, date } = i18n;
  const app = useApp();
  const { settings, valuation, positions, convert } = app;
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

  // Amount paid for a purchase, or received for a sale or dividend.
  const transactionTotal = (tx: Transaction) =>
    tx.type === "DIVIDEND"
      ? tx.amount - tx.fee - tx.tax
      : tx.type === "BUY"
        ? tx.quantity * tx.price + tx.fee
        : tx.quantity * tx.price - tx.fee - tx.tax;

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

      <ValueChart
        series={series}
        status={status}
        currency={instrument.currency}
        range={range}
        onRangeChange={setRange}
      />

      <section className="section">
        <div className="toolbar">
          <h2 className="section-title" style={{ margin: 0 }}>
            {t("position.transactions")} <small>{transactions.length}</small>
          </h2>
          <span className="spacer" />
          {(["BUY", "SELL", "DIVIDEND"] as const).map((type) => (
            <button
              key={type}
              type="button"
              className="btn btn-quiet"
              disabled={type === "SELL" && !holding}
              onClick={() => setEditing({ mode: "new", type })}
            >
              <PlusIcon />
              {t(
                type === "BUY"
                  ? "position.addBuy"
                  : type === "SELL"
                    ? "position.addSell"
                    : "position.addDividend",
              )}
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
                  <span>{tx.type === "DIVIDEND" ? "" : quantity(tx.quantity)}</span>
                  <span>{tx.type === "DIVIDEND" ? "" : money(tx.price, instrument.currency)}</span>
                  <span>{money(transactionTotal(tx), instrument.currency)}</span>
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
            initial={editing.mode === "edit" ? editing.transaction : undefined}
            initialType={editing.mode === "new" ? editing.type : undefined}
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

interface FactProps {
  label: string;
  value: string;
  tone?: string;
}

function Fact({ label, value, tone: valueTone }: FactProps) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={valueTone}>{value}</dd>
    </div>
  );
}
