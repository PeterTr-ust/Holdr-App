/**
 * Backup export and import inside the settings dialog. An import is shown as
 * a confirmation step first, because it replaces all current data.
 */
import { useState } from "react";
import { BackupError, type BackupFile } from "../domain/backup";
import { useI18n } from "../i18n";
import { useApp } from "../state/AppState";

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "confirm"; backup: BackupFile }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function BackupSection() {
  const { t, dateTime } = useI18n();
  const app = useApp();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const busy = status.kind === "working";
  const transactionCount = app.positions.reduce((n, p) => n + p.transactions.length, 0);

  const exportBackup = async () => {
    setStatus({ kind: "working" });
    try {
      const saved = await app.exportBackup();
      setStatus(saved ? { kind: "success", message: t("backup.exported") } : { kind: "idle" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("backup.exportFailed", { message: messageOf(error) }),
      });
    }
  };

  const chooseBackup = async () => {
    setStatus({ kind: "working" });
    try {
      const backup = await app.readBackup();
      setStatus(backup ? { kind: "confirm", backup } : { kind: "idle" });
    } catch (error) {
      if (error instanceof BackupError) {
        console.warn("Backup rejected:", error.message);
        setStatus({ kind: "error", message: t(`backup.error.${error.code}`) });
      } else {
        setStatus({
          kind: "error",
          message: t("backup.readFailed", { message: messageOf(error) }),
        });
      }
    }
  };

  const restore = async (backup: BackupFile) => {
    setStatus({ kind: "working" });
    try {
      await app.restoreBackup(backup);
      setStatus({ kind: "success", message: t("backup.restored") });
    } catch (error) {
      setStatus({
        kind: "error",
        message: t("backup.restoreFailed", { message: messageOf(error) }),
      });
    }
  };

  return (
    <div className="field">
      <span className="label">{t("backup.title")}</span>
      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        {t("backup.hint")}
      </p>

      {status.kind === "confirm" ? (
        <div className="confirm-box" role="alert">
          <p>
            {t("backup.confirmText", {
              positions: app.instruments.length,
              transactions: transactionCount,
              date: status.backup.exportedAt
                ? dateTime(status.backup.exportedAt)
                : t("backup.unknownDate"),
              backupPositions: status.backup.instruments.length,
              backupTransactions: status.backup.transactions.length,
            })}
          </p>
          <div className="toolbar">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setStatus({ kind: "idle" })}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void restore(status.backup)}
            >
              {t("backup.confirm")}
            </button>
          </div>
        </div>
      ) : (
        <div className="toolbar">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => void exportBackup()}
          >
            {t("backup.export")}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => void chooseBackup()}
          >
            {t("backup.import")}
          </button>
        </div>
      )}

      <p className="backup-status" aria-live="polite">
        {busy && <span className="muted">{t("backup.working")}</span>}
        {status.kind === "success" && <span className="pos">{status.message}</span>}
        {status.kind === "error" && <span className="neg">{status.message}</span>}
      </p>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
