/**
 * Frame of the app: top bar, notices and the active view.
 */
import { useState } from "react";
import { AddPositionDialog } from "./components/AddPositionDialog";
import { PlusIcon, RefreshIcon, SettingsIcon } from "./components/icons";
import { SettingsDialog } from "./components/SettingsDialog";
import type { InstrumentSearchResult } from "./domain/types";
import { useI18n } from "./i18n";
import { useApp } from "./state/AppState";
import { Overview } from "./views/Overview";
import { PositionView } from "./views/PositionView";
import { StatisticsView } from "./views/StatisticsView";
import { WatchlistView } from "./views/WatchlistView";

type View =
  { name: "overview" | "watchlist" | "statistics" } | { name: "position"; instrumentId: number };
type Dialog = { name: "add"; initial?: InstrumentSearchResult } | { name: "settings" } | null;

/** Top-level tabs; the position detail belongs to the overview tab. */
const TABS = [
  { view: "overview", label: "nav.overview" },
  { view: "watchlist", label: "nav.watchlist" },
  { view: "statistics", label: "nav.statistics" },
] as const;

export function Shell() {
  const { t, timestamp } = useI18n();
  const app = useApp();
  const [view, setView] = useState<View>({ name: "overview" });
  const [dialog, setDialog] = useState<Dialog>(null);
  const openPosition = (instrumentId: number) => {
    setView({ name: "position", instrumentId });
    window.scrollTo({ top: 0 });
  };
  const { refreshing, failed, lastUpdated } = app.quoteStatus;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="logo">
          holdr<span>.</span>
        </div>
        <nav className="tabs" aria-label="Holdr">
          {TABS.map((tab) => {
            const active = (view.name === "position" ? "overview" : view.name) === tab.view;
            return (
              <button
                key={tab.view}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => setView({ name: tab.view })}
              >
                {t(tab.label)}
              </button>
            );
          })}
        </nav>
        <div className="topbar-actions">
          {lastUpdated && (
            <span className="updated" aria-live="polite">
              {refreshing
                ? t("header.refreshing")
                : t("header.updatedAt", { time: timestamp(lastUpdated) })}
            </span>
          )}
          <button
            type="button"
            className={`icon-btn ${refreshing ? "spinning" : ""}`}
            title={t("header.refresh")}
            aria-label={t("header.refresh")}
            disabled={refreshing}
            onClick={() => void app.refreshQuotes()}
          >
            <RefreshIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t("nav.settings")}
            aria-label={t("nav.settings")}
            onClick={() => setDialog({ name: "settings" })}
          >
            <SettingsIcon />
          </button>
          <button
            type="button"
            className="btn"
            aria-label={t("header.addLabel")}
            onClick={() => setDialog({ name: "add" })}
          >
            <PlusIcon /> {t("header.add")}
          </button>
        </div>
      </header>

      {app.isPreview && <div className="banner">{t("banner.preview")}</div>}
      {failed && !refreshing && <div className="banner">{t("banner.quotesFailed")}</div>}
      {app.valuation.totals.unpricedCount > 0 && !refreshing && (
        <div className="banner">
          {t("banner.unpriced", { count: app.valuation.totals.unpricedCount })}
        </div>
      )}
      {app.integrityIssues.map((instrument) => (
        <div key={instrument.id} className="banner">
          {t("banner.integrity", { name: instrument.name })}
        </div>
      ))}

      <main style={{ display: "grid", gap: 28 }}>
        {view.name === "overview" && (
          <Overview onOpenPosition={openPosition} onAdd={() => setDialog({ name: "add" })} />
        )}
        {view.name === "watchlist" && (
          <WatchlistView onBuy={(initial) => setDialog({ name: "add", initial })} />
        )}
        {view.name === "statistics" && <StatisticsView onOpenPosition={openPosition} />}
        {view.name === "position" && (
          <PositionView
            key={view.instrumentId}
            instrumentId={view.instrumentId}
            onBack={() => setView({ name: "overview" })}
          />
        )}
      </main>

      {dialog?.name === "add" && (
        <AddPositionDialog
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          onAdded={(instrument) => {
            setDialog(null);
            openPosition(instrument.id);
          }}
        />
      )}
      {dialog?.name === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
