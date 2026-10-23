/**
 * Shows the notices of all bundled third-party software, generated at build
 * time by scripts/licenses.mjs into public/third-party-licenses.txt.
 */
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { Modal } from "./Modal";

export function LicensesDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}third-party-licenses.txt`)
      .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
      .then(
        (content) => !cancelled && setText(content),
        () => !cancelled && setFailed(true),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Modal title={t("licenses.title")} onClose={onClose}>
      <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
        {t("licenses.intro")}
      </p>
      {failed ? (
        <p className="form-error">{t("licenses.error")}</p>
      ) : (
        <pre className="licenses">{text ?? t("chart.loading")}</pre>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
    </Modal>
  );
}
