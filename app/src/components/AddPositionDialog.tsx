/**
 * Two-step dialog: find an instrument, then enter the first purchase.
 * Can start at the second step, e.g. when buying a watchlist entry.
 */
import { useEffect, useState } from "react";
import type { Instrument, InstrumentSearchResult } from "../domain/types";
import { useI18n } from "../i18n";
import type { QuoteDetails } from "../market/provider";
import { useApp } from "../state/AppState";
import { InstrumentSearch, PickedInstrument } from "./InstrumentSearch";
import { Modal } from "./Modal";
import { TransactionForm } from "./TransactionForm";

type Selection =
  | { status: "loading"; result: InstrumentSearchResult }
  | { status: "ready"; result: InstrumentSearchResult; quote: QuoteDetails }
  | { status: "error"; result: InstrumentSearchResult };

interface AddPositionDialogProps {
  /** Preselected instrument; skips the search step. */
  initial?: InstrumentSearchResult;
  onClose(): void;
  onAdded(instrument: Instrument): void;
}

export function AddPositionDialog({ initial, onClose, onAdded }: AddPositionDialogProps) {
  const { t } = useI18n();
  const { lookupQuote, addPosition } = useApp();
  const [selection, setSelection] = useState<Selection | null>(
    initial ? { status: "loading", result: initial } : null,
  );

  // Load the current quote whenever an instrument has been chosen.
  const pending = selection?.status === "loading" ? selection.result : null;
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    lookupQuote(pending.symbol).then(
      (quote) => !cancelled && setSelection({ status: "ready", result: pending, quote }),
      () => !cancelled && setSelection({ status: "error", result: pending }),
    );
    return () => {
      cancelled = true;
    };
  }, [pending, lookupQuote]);

  return (
    <Modal title={t("add.title")} onClose={onClose}>
      {selection === null ? (
        <InstrumentSearch onPick={(result) => setSelection({ status: "loading", result })} />
      ) : (
        <>
          <PickedInstrument
            result={selection.result}
            onChange={initial ? undefined : () => setSelection(null)}
          />
          {selection.status === "loading" && <p className="muted">{t("add.loadingQuote")}</p>}
          {selection.status === "error" && <p className="form-error">{t("add.quoteError")}</p>}
          {selection.status === "ready" && (
            <TransactionForm
              currency={selection.quote.currency}
              suggestedPrice={selection.quote.price}
              types={["BUY"]}
              submitLabel={t("add.submit")}
              onCancel={onClose}
              onSubmit={async (draft) => {
                const instrument = await addPosition(selection.result, selection.quote, draft);
                onAdded(instrument);
              }}
            />
          )}
        </>
      )}
    </Modal>
  );
}
