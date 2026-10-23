/**
 * Shows the current edition and lets the user activate or remove a license key.
 */
import { useId, useState, type FormEvent } from "react";
import { LicenseError } from "../domain/license";
import { useI18n } from "../i18n";
import { useApp } from "../state/AppState";

export function LicenseSection() {
  const { t, date } = useI18n();
  const { entitlement, activateLicense, removeLicense } = useApp();
  const inputId = useId();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "pos" | "neg"; text: string } | null>(null);

  const status = (() => {
    switch (entitlement.status) {
      case "none":
        return t("pro.free");
      case "expired":
        return t("pro.expired", { date: date(entitlement.license.expiresAt ?? "") });
      case "active":
        return entitlement.license.plan === "lifetime"
          ? t("pro.lifetime", { licensee: entitlement.license.licensee })
          : t("pro.subscription", {
              licensee: entitlement.license.licensee,
              date: date(entitlement.license.expiresAt ?? ""),
            });
    }
  })();

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await activateLicense(key);
      setKey("");
      setMessage({ tone: "pos", text: t("pro.activated") });
    } catch (error) {
      const code = error instanceof LicenseError ? error.code : "malformed";
      setMessage({ tone: "neg", text: t(`pro.error.${code}`) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <span className="label">{t("pro.title")}</span>
      <p style={{ margin: 0, fontSize: "0.9rem" }}>{status}</p>

      {entitlement.edition === "pro" ? (
        <div className="toolbar">
          <button
            type="button"
            className="btn btn-text btn-text-danger"
            onClick={() => {
              setMessage(null);
              void removeLicense();
            }}
          >
            {t("pro.remove")}
          </button>
        </div>
      ) : (
        <form className="license-form" onSubmit={activate}>
          <label htmlFor={inputId} className="visually-hidden">
            {t("pro.keyLabel")}
          </label>
          <input
            id={inputId}
            value={key}
            autoComplete="off"
            spellCheck={false}
            placeholder={t("pro.keyPlaceholder")}
            onChange={(event) => setKey(event.target.value)}
          />
          <button type="submit" className="btn btn-quiet" disabled={busy || !key.trim()}>
            {t("pro.activate")}
          </button>
        </form>
      )}

      {message && (
        <p className={`backup-status ${message.tone}`} aria-live="polite">
          {message.text}
        </p>
      )}
    </div>
  );
}
