/**
 * Composition root: picks the storage and market data implementations for
 * the environment the UI runs in.
 *
 * - Inside the desktop shell (Tauri): SQLite + live Yahoo Finance data.
 *   HTTP goes through the Rust side, which is not subject to browser CORS;
 *   the quote summary uses a dedicated command with its own cookie session.
 * - In a plain browser (`npm run dev`): in-memory storage with sample data
 *   and made-up prices, so the UI can be developed without the shell.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PortfolioRepository } from "../data/repository";
import type { MarketDataProvider } from "../market/provider";
import type { BackupFiles } from "./files";
import type { LicenseVerifier } from "./license";

export interface Services {
  repository: PortfolioRepository;
  market: MarketDataProvider;
  /** Save/open dialogs for backup files. */
  backupFiles: BackupFiles;
  verifyLicense: LicenseVerifier;
  /** True when running with sample data and fake prices. */
  isPreview: boolean;
}

export async function createServices(): Promise<Services> {
  if (isTauri()) {
    const [sqlite, yahoo, http, files, license] = await Promise.all([
      import("../data/sqliteRepository"),
      import("../market/yahoo"),
      import("@tauri-apps/plugin-http"),
      import("./files"),
      import("./license"),
    ]);
    return {
      repository: await sqlite.SqliteRepository.open(),
      market: new yahoo.YahooFinanceProvider(http.fetch, async (symbol, modules) =>
        JSON.parse(await invoke<string>("yahoo_quote_summary", { symbol, modules })),
      ),
      backupFiles: await files.createDesktopBackupFiles(),
      verifyLicense: await license.createDesktopLicenseVerifier(),
      isPreview: false,
    };
  }

  const [memory, demo, preview, files, license] = await Promise.all([
    import("../data/memoryRepository"),
    import("../market/demo"),
    import("./previewData"),
    import("./files"),
    import("./license"),
  ]);
  const repository = new memory.MemoryRepository();
  await preview.seedPreviewData(repository);
  return {
    repository,
    market: new demo.DemoMarketDataProvider(),
    backupFiles: files.createBrowserBackupFiles(),
    verifyLicense: license.previewLicenseVerifier,
    isPreview: true,
  };
}
