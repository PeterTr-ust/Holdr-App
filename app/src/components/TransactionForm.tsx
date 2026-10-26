/**
 * Form for entering or editing a buy, sell, dividend or split transaction.
 */
import { useId, useState, type FormEvent } from "react";
import { OversellError } from "../domain/portfolio";
import type { CurrencyCode, TransactionType } from "../domain/types";
import { useI18n, type MessageKey } from "../i18n";
import type { TransactionDraft } from "../state/AppState";
import { formatDecimalInput, parseDecimal, todayIso } from "../util/input";

/** Types offered by default; splits are entered separately. */
const TYPES: TransactionType[] = ["BUY", "SELL", "DIVIDEND"];

interface TransactionFormProps {
  currency: CurrencyCode;
  /** Existing transaction when editing, or prefilled values, e.g. from a suggestion. */
  initial?: TransactionDraft;
  initialType?: TransactionType;
  /** Suggested price per share, e.g. the current quote. */
  suggestedPrice?: number | null;
  /** Restricts the selectable types, e.g. only BUY for a new position. Splits default to SPLIT only. */
  types?: TransactionType[];
  submitLabel: string;
  onSubmit(draft: TransactionDraft): Promise<void>;
  onCancel(): void;
}

type Field = "date" | "quantity" | "price" | "amount" | "fee" | "tax" | "ratioTo" | "ratioFrom";
type Errors = Partial<Record<Field, MessageKey>>;

export function TransactionForm({
  currency,
  initial,
  initialType = "BUY",
  suggestedPrice,
  types = (initial?.type ?? initialType) === "SPLIT" ? ["SPLIT"] : TYPES,
  submitLabel,
  onSubmit,
  onCancel,
}: TransactionFormProps) {
  const { t, money, language, quantity: formatQuantity, date: formatDate } = useI18n();
  const id = useId();
  const toInput = (value: number | undefined | null) =>
    value === undefined || value === null ? "" : formatDecimalInput(value, language);

  const [type, setType] = useState<TransactionType>(initial?.type ?? initialType);
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const trade = initial?.type === "BUY" || initial?.type === "SELL" ? initial : undefined;
  const split = initial?.type === "SPLIT" ? initial : undefined;
  const [quantity, setQuantity] = useState(toInput(trade?.quantity));
  const [price, setPrice] = useState(toInput(trade ? trade.price : suggestedPrice));
  const [ratioTo, setRatioTo] = useState(toInput(split?.ratioTo));
  const [ratioFrom, setRatioFrom] = useState(toInput(split?.ratioFrom ?? 1));
  const [amount, setAmount] = useState(
    toInput(initial?.type === "DIVIDEND" ? initial.amount : undefined),
  );
  const [fee, setFee] = useState(toInput(initial?.fee ?? 0));
  const [tax, setTax] = useState(toInput(initial?.tax ?? 0));
  const [note, setNote] = useState(initial?.note ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isTrade = type === "BUY" || type === "SELL";
  const isSplit = type === "SPLIT";
  // Purchases have no taxes, their costs are fees; splits have neither.
  const hasTax = type === "SELL" || type === "DIVIDEND";
  const values = {
    quantity: parseDecimal(quantity),
    price: parseDecimal(price),
    amount: parseDecimal(amount),
    ratioTo: parseDecimal(ratioTo),
    ratioFrom: parseDecimal(ratioFrom),
    fee: isSplit ? 0 : (parseDecimal(fee) ?? 0),
    tax: hasTax ? (parseDecimal(tax) ?? 0) : 0,
  };
  // What leaves the account for a purchase, or arrives for a sale or dividend.
  const gross = isTrade
    ? values.quantity !== null && values.price !== null
      ? values.quantity * values.price
      : null
    : values.amount;
  const total =
    gross === null ? null : type === "BUY" ? gross + values.fee : gross - values.fee - values.tax;

  const validate = (): Errors => {
    const result: Errors = {};
    if (!date) result.date = "tx.errorRequired";
    else if (date > todayIso()) result.date = "tx.errorFuture";
    const positive = (field: Field, input: string, value: number | null) => {
      if (!(value! > 0)) result[field] = input ? "tx.errorPositive" : "tx.errorRequired";
    };
    if (isTrade) {
      positive("quantity", quantity, values.quantity);
      positive("price", price, values.price);
    } else if (isSplit) {
      positive("ratioTo", ratioTo, values.ratioTo);
      positive("ratioFrom", ratioFrom, values.ratioFrom);
    } else {
      positive("amount", amount, values.amount);
    }
    if (!isSplit && (parseDecimal(fee || "0") === null || values.fee < 0)) {
      result.fee = "tx.errorNotNegative";
    }
    if (hasTax && (parseDecimal(tax || "0") === null || values.tax < 0)) {
      result.tax = "tx.errorNotNegative";
    }
    return result;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    const common = { date, fee: values.fee, tax: values.tax, note: note.trim() || null };
    const draft: TransactionDraft = isTrade
      ? { ...common, type, quantity: values.quantity!, price: values.price! }
      : isSplit
        ? { ...common, type: "SPLIT", ratioTo: values.ratioTo!, ratioFrom: values.ratioFrom! }
        : { ...common, type: "DIVIDEND", amount: values.amount! };

    setBusy(true);
    try {
      await onSubmit(draft);
    } catch (error) {
      if (error instanceof OversellError) {
        setFormError(
          t("tx.errorOversell", {
            date: formatDate(error.transaction.date),
            available: formatQuantity(error.available),
          }),
        );
      } else {
        setFormError(
          t("tx.errorSave", { message: error instanceof Error ? error.message : String(error) }),
        );
      }
      setBusy(false);
    }
  };

  const field = (
    name: Field,
    label: string,
    value: string,
    onChange: (v: string) => void,
    hint?: string,
  ) => (
    <div className="field">
      <label htmlFor={`${id}-${name}`}>{label}</label>
      <input
        id={`${id}-${name}`}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${id}-${name}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {errors[name] ? (
        <span className="error" id={`${id}-${name}-error`}>
          {t(errors[name])}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  );

  return (
    <form className="form" onSubmit={submit} noValidate>
      {types.length > 1 && (
        <div className="field">
          <span className="label">{t("tx.type")}</span>
          <div className="segmented" role="group" aria-label={t("tx.type")}>
            {types.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === type}
                onClick={() => setType(option)}
              >
                {t(`tx.${option}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="form-row">
        <div className="field">
          <label htmlFor={`${id}-date`}>{t("tx.date")}</label>
          <input
            id={`${id}-date`}
            type="date"
            value={date}
            max={todayIso()}
            aria-invalid={errors.date ? true : undefined}
            onChange={(event) => setDate(event.target.value)}
          />
          {errors.date && <span className="error">{t(errors.date)}</span>}
        </div>
        {isTrade
          ? field("quantity", t("tx.quantity"), quantity, setQuantity)
          : !isSplit && field("amount", t("tx.amount", { currency }), amount, setAmount)}
      </div>

      {isSplit ? (
        <div className="form-row">
          {field("ratioFrom", t("tx.ratioFrom"), ratioFrom, setRatioFrom)}
          {field("ratioTo", t("tx.ratioTo"), ratioTo, setRatioTo, t("tx.ratioHint"))}
        </div>
      ) : (
        <div className="form-row">
          {isTrade && field("price", t("tx.price", { currency }), price, setPrice)}
          {field("fee", t("tx.fee", { currency }), fee, setFee)}
          {type === "DIVIDEND" &&
            field("tax", t("tx.tax", { currency }), tax, setTax, t("tx.taxHintDividend"))}
        </div>
      )}

      {type === "SELL" && (
        <div className="form-row">
          {field("tax", t("tx.tax", { currency }), tax, setTax, t("tx.taxHintSell"))}
        </div>
      )}

      <div className="field">
        <label htmlFor={`${id}-note`}>{t("tx.note")}</label>
        <input
          id={`${id}-note`}
          value={note}
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {isSplit ? (
        <div className="form-total">
          <span>{t("tx.ratio")}</span>
          <span>
            {values.ratioFrom! > 0 && values.ratioTo! > 0
              ? `${formatQuantity(values.ratioFrom!)} → ${formatQuantity(values.ratioTo!)}`
              : t("common.notAvailable")}
          </span>
        </div>
      ) : (
        <div className="form-total">
          <span>{t("tx.total")}</span>
          <span>{money(total, currency)}</span>
        </div>
      )}

      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="btn btn-accent" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
