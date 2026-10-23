import { useState } from "react";
import { useI18n } from "../i18n";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm(): Promise<void>;
  onClose(): void;
}

/** Asks before a destructive action; shows the error if the action fails. */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>
        {text}
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
