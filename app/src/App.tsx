/**
 * Startup: creates services, loads stored data and then renders the shell.
 */
import { useEffect, useState } from "react";
import { createI18n, I18nProvider } from "./i18n";
import { createServices, type Services } from "./platform/services";
import { AppStateProvider, defaultSettings, loadInitialData, useApp } from "./state/AppState";
import { Shell } from "./Shell";

type Startup =
  | { status: "loading" }
  | { status: "ready"; services: Services; initial: Awaited<ReturnType<typeof loadInitialData>> }
  | { status: "error"; message: string };

/** Creates services and loads stored data; never rejects. */
async function boot(): Promise<Startup> {
  try {
    const services = await createServices();
    const initial = await loadInitialData(services);
    return { status: "ready", services, initial };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export function App() {
  const [startup, setStartup] = useState<Startup>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    boot().then((result) => !cancelled && setStartup(result));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (startup.status !== "ready") {
    // Settings are not loaded yet, so fall back to the system language.
    const { t } = createI18n(defaultSettings().language);
    return (
      <div className="splash">
        <div className="logo">
          holdr<span>.</span>
        </div>
        {startup.status === "error" && (
          <>
            <p className="form-error">
              {t("error.startup")} {startup.message}
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setStartup({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
            >
              {t("error.retry")}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <AppStateProvider services={startup.services} initial={startup.initial}>
      <LocalizedShell />
    </AppStateProvider>
  );
}

function LocalizedShell() {
  const { settings } = useApp();
  useEffect(() => {
    document.documentElement.lang = settings.language;
  }, [settings.language]);
  return (
    <I18nProvider language={settings.language}>
      <Shell />
    </I18nProvider>
  );
}
