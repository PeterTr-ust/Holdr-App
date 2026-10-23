import { DISPLAY_CURRENCIES } from "../domain/types";
import { useState } from "react";
import { useI18n } from "../i18n";
import { useApp } from "../state/AppState";
import { BackupSection } from "./BackupSection";
import { LicenseSection } from "./LicenseSection";
import { LicensesDialog } from "./LicensesDialog";
import { Modal } from "./Modal";

const LANGUAGES = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
] as const;

/** Language and currency preferences, backups and privacy information. */
export function SettingsDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const { settings, updateSettings } = useApp();
  const [showLicenses, setShowLicenses] = useState(false);

  return (
    <Modal title={t("settings.title")} onClose={onClose}>
      <div className="field">
        <span className="label">{t("settings.language")}</span>
        <div className="segmented" role="group" aria-label={t("settings.language")}>
          {LANGUAGES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              lang={value}
              aria-pressed={settings.language === value}
              onClick={() => void updateSettings({ language: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">{t("settings.currency")}</span>
        <div className="segmented" role="group" aria-label={t("settings.currency")}>
          {DISPLAY_CURRENCIES.map((currency) => (
            <button
              key={currency}
              type="button"
              aria-pressed={settings.displayCurrency === currency}
              onClick={() => void updateSettings({ displayCurrency: currency })}
            >
              {currency === "EUR" ? "€ Euro" : "$ US-Dollar"}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: "0.82rem" }}>
          {t("settings.currencyHint")}
        </span>
      </div>

      <BackupSection />

      <LicenseSection />

      <div className="field">
        <span className="label">{t("settings.privacyTitle")}</span>
        <p style={{ margin: 0, fontSize: "0.9rem" }}>{t("settings.privacy")}</p>
        <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
          {t("settings.licenseNotice")}
        </p>
      </div>

      <div className="modal-actions">
        <span
          className="muted num"
          style={{ marginRight: "auto", fontSize: "0.8rem", alignSelf: "center" }}
        >
          {t("settings.version", { version: __APP_VERSION__ })} ·{" "}
          <button type="button" className="link-btn" onClick={() => setShowLicenses(true)}>
            {t("licenses.open")}
          </button>
        </span>
        <button type="button" className="btn" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
      {showLicenses && <LicensesDialog onClose={() => setShowLicenses(false)} />}
    </Modal>
  );
}
