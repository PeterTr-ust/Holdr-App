/**
 * Application state: loads data at startup, keeps quotes fresh and exposes
 * all mutations. Derived values (positions, valuation, statistics) are
 * recomputed from the raw records whenever they change.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { backupFileName, createBackup, parseBackup, type BackupFile } from "../domain/backup";
import {
  findSuggestions,
  type CorporateActions,
  type Suggestion,
} from "../domain/corporateActions";
import { entitlementFor, type Entitlement, type License } from "../domain/license";
import { computePosition, OversellError, type PositionSummary } from "../domain/portfolio";
import type { InstrumentProfile, UpcomingEvents } from "../domain/profile";
import type {
  Instrument,
  InstrumentSearchResult,
  NewTransaction,
  Quote,
  SeriesPoint,
  Settings,
  Transaction,
  WatchlistItem,
} from "../domain/types";
import {
  computeStatistics,
  valuePortfolio,
  type Converter,
  type PortfolioValuation,
  type Statistics,
} from "../domain/valuation";
import type { MarketCacheEntry } from "../data/repository";
import { createConverter, requiredRateSymbols } from "../market/currency";
import type { HistoryRange, QuoteDetails } from "../market/provider";
import type { Services } from "../platform/services";
import { todayIso } from "../util/input";

/** How often quotes are refreshed while the app is open. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** How long fetched market details stay valid, per kind of data. */
const MAX_AGE_MS = { actions: DAY_MS, events: DAY_MS, profile: 30 * DAY_MS } as const;
/** Pause before a failed market detail request is tried again. */
const RETRY_AFTER_MS = HOUR_MS;

type DetailKind = keyof typeof MAX_AGE_MS;
/** Cached corporate actions remember from which date on they were requested. */
type CachedActions = CorporateActions & { since: string };

const cacheKey = (kind: DetailKind, symbol: string) => `${kind}|${symbol}`;

/** Which optional data the market data provider offers. */
export interface MarketCapabilities {
  corporateActions: boolean;
  profiles: boolean;
  upcomingEvents: boolean;
}

export interface QuoteStatus {
  refreshing: boolean;
  /** True if the last refresh could not load at least one quote. */
  failed: boolean;
  lastUpdated: string | null;
}

/** A transaction as entered in a form, before it belongs to an instrument. */
export type TransactionDraft = DistributiveOmit<NewTransaction, "instrumentId">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface AppState {
  isPreview: boolean;
  settings: Settings;
  updateSettings(changes: Partial<Settings>): Promise<void>;

  instruments: Instrument[];
  positions: PositionSummary[];
  /** Instruments whose stored transactions are inconsistent (oversold). */
  integrityIssues: Instrument[];
  valuation: PortfolioValuation;
  statistics: Statistics;
  convert: Converter;

  watchlist: WatchlistItem[];
  /** Latest known quote per symbol (positions, watchlist and exchange rates). */
  quotes: ReadonlyMap<string, Quote>;
  addToWatchlist(result: InstrumentSearchResult, quote: QuoteDetails): Promise<WatchlistItem>;
  removeFromWatchlist(item: WatchlistItem): Promise<void>;

  capabilities: MarketCapabilities;
  /** Sector and country per symbol, as far as loaded. */
  profiles: ReadonlyMap<string, InstrumentProfile>;
  upcomingEvents: ReadonlyMap<string, UpcomingEvents>;
  corporateActions: ReadonlyMap<string, CorporateActions>;
  /** Dividends and splits of held shares that are not recorded yet, newest first. */
  suggestions: Suggestion[];
  dismissSuggestion(suggestion: Suggestion): Promise<void>;

  /** Free or Pro, derived from the activated license. */
  entitlement: Entitlement;
  /** Verifies and stores a license key. @throws LicenseError if it is invalid. */
  activateLicense(key: string): Promise<void>;
  removeLicense(): Promise<void>;

  quoteStatus: QuoteStatus;
  refreshQuotes(): Promise<void>;
  getHistory(symbol: string, range: HistoryRange): Promise<SeriesPoint[]>;
  searchInstruments(query: string): Promise<InstrumentSearchResult[]>;
  lookupQuote(symbol: string): Promise<QuoteDetails>;

  addPosition(
    result: InstrumentSearchResult,
    quote: QuoteDetails,
    draft: TransactionDraft,
  ): Promise<Instrument>;
  /** Creates or updates a transaction. @throws OversellError if it would oversell. */
  saveTransaction(transaction: NewTransaction | Transaction): Promise<void>;
  /** @throws OversellError if removing it would make a later sale invalid. */
  deleteTransaction(transaction: Transaction): Promise<void>;
  deleteInstrument(instrument: Instrument): Promise<void>;

  /** Saves all data to a file chosen by the user. Returns false if cancelled. */
  exportBackup(): Promise<boolean>;
  /**
   * Lets the user pick a backup file and validates it without changing anything.
   * Returns null if cancelled. @throws BackupError if the file cannot be used.
   */
  readBackup(): Promise<BackupFile | null>;
  /** Replaces all current data with the given, already validated backup. */
  restoreBackup(backup: BackupFile): Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside <AppStateProvider>.");
  return context;
}

export function defaultSettings(): Settings {
  const german = typeof navigator !== "undefined" && navigator.language.startsWith("de");
  return { language: german ? "de" : "en", displayCurrency: "EUR" };
}

interface InitialData {
  settings: Settings;
  instruments: Instrument[];
  transactions: Transaction[];
  watchlist: WatchlistItem[];
  quotes: Quote[];
  marketCache: MarketCacheEntry[];
  dismissedSuggestions: string[];
  /** Verified license, or null if none is stored or the stored key is invalid. */
  license: License | null;
}

/** Loads everything needed for the first render. */
export async function loadInitialData(services: Services): Promise<InitialData> {
  const { repository } = services;
  const [
    storedSettings,
    instruments,
    transactions,
    watchlist,
    quotes,
    marketCache,
    dismissedSuggestions,
  ] = await Promise.all([
    repository.loadSettings(),
    repository.listInstruments(),
    repository.listTransactions(),
    repository.listWatchlist(),
    repository.listCachedQuotes(),
    repository.listMarketCache(),
    repository.listDismissedSuggestions(),
  ]);
  const licenseKey = await repository.loadLicenseKey();
  // A stored key that no longer verifies (e.g. after a key change) counts as no license.
  const license = licenseKey ? await services.verifyLicense(licenseKey).catch(() => null) : null;
  return {
    settings: { ...defaultSettings(), ...storedSettings },
    instruments,
    transactions,
    watchlist,
    quotes,
    marketCache,
    dismissedSuggestions,
    license,
  };
}

export function AppStateProvider({
  services,
  initial,
  children,
}: {
  services: Services;
  initial: InitialData;
  children: ReactNode;
}) {
  const { repository, market } = services;
  const [settings, setSettings] = useState(initial.settings);
  const [instruments, setInstruments] = useState(initial.instruments);
  const [transactions, setTransactions] = useState(initial.transactions);
  const [watchlist, setWatchlist] = useState(initial.watchlist);
  const [license, setLicense] = useState(initial.license);
  // Evaluated per render, so an expiring subscription is noticed without a restart.
  const entitlement = entitlementFor(license, todayIso());
  const [quotes, setQuotes] = useState(
    () => new Map(initial.quotes.map((quote) => [quote.symbol, quote])),
  );
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>(() => ({
    refreshing: false,
    failed: false,
    lastUpdated: latestFetch(initial.quotes),
  }));
  const historyCache = useRef(new Map<string, Promise<SeriesPoint[]>>());
  const [marketCache, setMarketCache] = useState(
    () => new Map(initial.marketCache.map((entry) => [entry.key, entry])),
  );
  const [dismissed, setDismissed] = useState(() => new Set(initial.dismissedSuggestions));
  // Failed detail requests per cache key, so they are not repeated on every refresh.
  const failedDetails = useRef(new Map<string, number>());
  const syncingDetails = useRef(false);
  // Latest syncMarketDetails, so refreshes and effects can call it without depending on it.
  const syncRef = useRef<() => Promise<void>>(async () => {});
  // Incremented when all data is replaced, so quotes are fetched again.
  const [dataGeneration, setDataGeneration] = useState(0);

  // --- Derived state ------------------------------------------------------

  const { positions, integrityIssues } = useMemo(() => {
    const positions: PositionSummary[] = [];
    const integrityIssues: Instrument[] = [];
    for (const instrument of instruments) {
      try {
        positions.push(computePosition(instrument, transactions));
      } catch (error) {
        if (!(error instanceof OversellError)) throw error;
        integrityIssues.push(instrument);
      }
    }
    return { positions, integrityIssues };
  }, [instruments, transactions]);

  const convert = useMemo(
    () => createConverter(settings.displayCurrency, quotes),
    [settings.displayCurrency, quotes],
  );
  const valuation = useMemo(
    () => valuePortfolio(positions, quotes, convert),
    [positions, quotes, convert],
  );
  const statistics = useMemo(
    () => computeStatistics(positions, valuation, convert),
    [positions, valuation, convert],
  );

  const capabilities: MarketCapabilities = {
    corporateActions: Boolean(market.getCorporateActions),
    profiles: Boolean(market.getProfile),
    upcomingEvents: Boolean(market.getUpcomingEvents),
  };

  const { profiles, upcomingEvents, corporateActions } = useMemo(() => {
    const byKind = <T,>(kind: DetailKind) => {
      const map = new Map<string, T>();
      for (const entry of marketCache.values()) {
        const [entryKind, symbol] = entry.key.split("|", 2);
        if (entryKind === kind && symbol) map.set(symbol, entry.value as T);
      }
      return map;
    };
    return {
      profiles: byKind<InstrumentProfile>("profile"),
      upcomingEvents: byKind<UpcomingEvents>("events"),
      corporateActions: byKind<CorporateActions>("actions"),
    };
  }, [marketCache]);

  const suggestions = useMemo(
    () =>
      positions
        .flatMap((position) => {
          const actions = corporateActions.get(position.instrument.symbol);
          return actions
            ? findSuggestions(position.instrument, position.transactions, actions, dismissed)
            : [];
        })
        .sort((a, b) => b.event.date.localeCompare(a.event.date)),
    [positions, corporateActions, dismissed],
  );

  // --- Quotes -------------------------------------------------------------

  const refreshQuotes = useCallback(async () => {
    const held = positions.filter((p) => p.quantity > 0).map((p) => p.instrument.symbol);
    const watched = watchlist.map((w) => w.symbol);
    const rates = requiredRateSymbols(
      [...instruments, ...watchlist].map((i) => i.currency),
      settings.displayCurrency,
    );
    const symbols = [...new Set([...held, ...watched, ...rates])];
    if (symbols.length === 0) return;

    setQuoteStatus((status) => ({ ...status, refreshing: true }));
    const results = await Promise.allSettled(symbols.map((symbol) => market.getQuote(symbol)));
    const fresh = results.flatMap((r) => (r.status === "fulfilled" ? [toQuote(r.value)] : []));

    if (fresh.length > 0) {
      await repository.saveQuotes(fresh);
      setQuotes((previous) => {
        const next = new Map(previous);
        for (const quote of fresh) next.set(quote.symbol, quote);
        return next;
      });
    }
    setQuoteStatus((status) => ({
      refreshing: false,
      failed: fresh.length < symbols.length,
      lastUpdated: latestFetch(fresh) ?? status.lastUpdated,
    }));
    // Picks up details that became outdated while the app was open.
    void syncRef.current();
  }, [positions, instruments, watchlist, settings.displayCurrency, market, repository]);

  // Refresh on startup, when relevant inputs change and periodically.
  const refreshRef = useRef(refreshQuotes);
  useEffect(() => {
    refreshRef.current = refreshQuotes;
  });
  const refreshKey = [
    dataGeneration,
    settings.displayCurrency,
    ...instruments.map((i) => i.symbol),
    ...watchlist.map((w) => w.symbol),
  ].join("|");
  useEffect(() => {
    void refreshRef.current();
  }, [refreshKey]);
  useEffect(() => {
    const timer = window.setInterval(() => void refreshRef.current(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  /**
   * Loads dividends and splits, profiles and upcoming dates that are missing
   * or outdated, one request at a time to go easy on the provider.
   */
  const syncMarketDetails = useCallback(async () => {
    if (syncingDetails.current) return;
    syncingDetails.current = true;
    const now = Date.now();
    const needsUpdate = (key: string, maxAge: number, usable = (_value: unknown) => true) => {
      if (now - (failedDetails.current.get(key) ?? 0) < RETRY_AFTER_MS) return false;
      const entry = marketCache.get(key);
      return !entry || now - Date.parse(entry.fetchedAt) > maxAge || !usable(entry.value);
    };

    const tasks: { key: string; load(): Promise<unknown> }[] = [];
    for (const position of positions) {
      const { symbol } = position.instrument;
      const since = position.transactions[0]?.date;
      const { getCorporateActions, getProfile, getUpcomingEvents } = market;
      if (getCorporateActions && since) {
        const key = cacheKey("actions", symbol);
        const coversSince = (value: unknown) => (value as CachedActions).since <= since;
        if (needsUpdate(key, MAX_AGE_MS.actions, coversSince)) {
          tasks.push({
            key,
            load: async () => ({
              since,
              ...(await getCorporateActions.call(market, symbol, since)),
            }),
          });
        }
      }
      if (position.quantity <= 0) continue;
      if (getProfile && needsUpdate(cacheKey("profile", symbol), MAX_AGE_MS.profile)) {
        tasks.push({
          key: cacheKey("profile", symbol),
          load: () => getProfile.call(market, symbol),
        });
      }
      if (getUpcomingEvents && needsUpdate(cacheKey("events", symbol), MAX_AGE_MS.events)) {
        tasks.push({
          key: cacheKey("events", symbol),
          load: () => getUpcomingEvents.call(market, symbol),
        });
      }
    }

    try {
      for (const task of tasks) {
        try {
          const entry = {
            key: task.key,
            value: await task.load(),
            fetchedAt: new Date().toISOString(),
          };
          await repository.saveMarketCache(entry);
          failedDetails.current.delete(task.key);
          setMarketCache((previous) => new Map(previous).set(entry.key, entry));
        } catch {
          // Keep any older entry and try again later.
          failedDetails.current.set(task.key, Date.now());
        }
      }
    } finally {
      syncingDetails.current = false;
    }
  }, [positions, marketCache, market, repository]);

  useEffect(() => {
    syncRef.current = syncMarketDetails;
  });
  const detailsKey = [
    dataGeneration,
    ...positions.map((p) => `${p.instrument.symbol}:${p.transactions[0]?.date}:${p.quantity > 0}`),
  ].join("|");
  useEffect(() => {
    void syncRef.current();
  }, [detailsKey]);

  const getHistory = useCallback(
    (symbol: string, range: HistoryRange) => {
      const key = `${symbol}|${range}`;
      let request = historyCache.current.get(key);
      if (!request) {
        request = market.getHistory(symbol, range);
        historyCache.current.set(key, request);
        // Failed requests must not stay cached, so a later attempt can succeed.
        request.catch(() => historyCache.current.delete(key));
      }
      return request;
    },
    [market],
  );

  // --- Mutations ----------------------------------------------------------

  const updateSettings = useCallback(
    async (changes: Partial<Settings>) => {
      const next = { ...settings, ...changes };
      setSettings(next);
      await repository.saveSettings(next);
    },
    [settings, repository],
  );

  const saveTransaction = useCallback(
    async (transaction: NewTransaction | Transaction) => {
      const instrument = instruments.find((i) => i.id === transaction.instrumentId);
      if (!instrument) throw new Error(`Unknown instrument ${transaction.instrumentId}.`);

      if ("id" in transaction) {
        assertConsistent(
          instrument,
          transactions.map((t) => (t.id === transaction.id ? transaction : t)),
        );
        await repository.updateTransaction(transaction);
        setTransactions((list) => list.map((t) => (t.id === transaction.id ? transaction : t)));
      } else {
        const candidate = {
          ...transaction,
          id: Number.MAX_SAFE_INTEGER,
          createdAt: "",
        } as Transaction;
        assertConsistent(instrument, [...transactions, candidate]);
        const created = await repository.createTransaction(transaction);
        setTransactions((list) => [...list, created]);
      }
    },
    [instruments, transactions, repository],
  );

  const addPosition = useCallback(
    async (result: InstrumentSearchResult, quote: QuoteDetails, draft: TransactionDraft) => {
      const instrument = await repository.upsertInstrument({
        symbol: result.symbol,
        name: result.name || quote.name || result.symbol,
        currency: quote.currency,
        exchange: result.exchange ?? quote.exchange,
        kind: result.kind,
      });
      const transaction = { ...draft, instrumentId: instrument.id } as NewTransaction;
      const existing = transactions.filter((t) => t.instrumentId === instrument.id);
      assertConsistent(instrument, [
        ...existing,
        { ...transaction, id: Number.MAX_SAFE_INTEGER, createdAt: "" } as Transaction,
      ]);

      const created = await repository.createTransaction(transaction);
      await repository.saveQuotes([toQuote(quote)]);
      setInstruments((list) =>
        list.some((i) => i.id === instrument.id) ? list : [...list, instrument],
      );
      setTransactions((list) => [...list, created]);
      setQuotes((previous) => new Map(previous).set(quote.symbol, toQuote(quote)));
      return instrument;
    },
    [transactions, repository],
  );

  const deleteTransaction = useCallback(
    async (transaction: Transaction) => {
      const instrument = instruments.find((i) => i.id === transaction.instrumentId);
      if (instrument) {
        assertConsistent(
          instrument,
          transactions.filter((t) => t.id !== transaction.id),
        );
      }
      await repository.deleteTransaction(transaction.id);
      setTransactions((list) => list.filter((t) => t.id !== transaction.id));
    },
    [instruments, transactions, repository],
  );

  const deleteInstrument = useCallback(
    async (instrument: Instrument) => {
      await repository.deleteInstrument(instrument.id);
      setInstruments((list) => list.filter((i) => i.id !== instrument.id));
      setTransactions((list) => list.filter((t) => t.instrumentId !== instrument.id));
    },
    [repository],
  );

  const exportBackup = useCallback(async () => {
    const backup = createBackup(
      { instruments, transactions, watchlist, dismissedSuggestions: [...dismissed], settings },
      __APP_VERSION__,
    );
    return services.backupFiles.save(backupFileName(), JSON.stringify(backup, null, 2));
  }, [instruments, transactions, watchlist, dismissed, settings, services.backupFiles]);

  const readBackup = useCallback(async () => {
    const text = await services.backupFiles.open();
    return text === null ? null : parseBackup(text);
  }, [services.backupFiles]);

  const restoreBackup = useCallback(
    async (backup: BackupFile) => {
      await repository.replaceAll(backup);
      historyCache.current.clear();
      setInstruments(backup.instruments);
      setTransactions(backup.transactions);
      setWatchlist(backup.watchlist);
      setDismissed(new Set(backup.dismissedSuggestions));
      setSettings(backup.settings);
      setQuotes(new Map());
      setQuoteStatus({ refreshing: false, failed: false, lastUpdated: null });
      setDataGeneration((n) => n + 1);
    },
    [repository],
  );

  const addToWatchlist = useCallback(
    async (result: InstrumentSearchResult, quote: QuoteDetails) => {
      const item = await repository.addToWatchlist({
        symbol: result.symbol,
        name: result.name || quote.name || result.symbol,
        currency: quote.currency,
        exchange: result.exchange ?? quote.exchange,
        kind: result.kind,
        addedPrice: quote.price,
      });
      await repository.saveQuotes([toQuote(quote)]);
      setWatchlist((list) => (list.some((w) => w.id === item.id) ? list : [...list, item]));
      setQuotes((previous) => new Map(previous).set(quote.symbol, toQuote(quote)));
      return item;
    },
    [repository],
  );

  const removeFromWatchlist = useCallback(
    async (item: WatchlistItem) => {
      await repository.removeFromWatchlist(item.id);
      setWatchlist((list) => list.filter((w) => w.id !== item.id));
    },
    [repository],
  );

  const dismissSuggestion = useCallback(
    async (suggestion: Suggestion) => {
      await repository.dismissSuggestion(suggestion.key);
      setDismissed((previous) => new Set(previous).add(suggestion.key));
    },
    [repository],
  );

  const activateLicense = useCallback(
    async (key: string) => {
      const verified = await services.verifyLicense(key.trim());
      await repository.saveLicenseKey(key.trim());
      setLicense(verified);
    },
    [services, repository],
  );

  const removeLicense = useCallback(async () => {
    await repository.saveLicenseKey(null);
    setLicense(null);
  }, [repository]);

  // Stable identities, so effects depending on them do not restart on every render.
  const searchInstruments = useCallback((query: string) => market.search(query), [market]);
  const lookupQuote = useCallback((symbol: string) => market.getQuote(symbol), [market]);

  const value: AppState = {
    isPreview: services.isPreview,
    settings,
    updateSettings,
    instruments,
    positions,
    integrityIssues,
    valuation,
    statistics,
    convert,
    watchlist,
    quotes,
    addToWatchlist,
    removeFromWatchlist,
    capabilities,
    profiles,
    upcomingEvents,
    corporateActions,
    suggestions,
    dismissSuggestion,
    entitlement,
    activateLicense,
    removeLicense,
    quoteStatus,
    refreshQuotes,
    getHistory,
    searchInstruments,
    lookupQuote,
    addPosition,
    saveTransaction,
    deleteTransaction,
    deleteInstrument,
    exportBackup,
    readBackup,
    restoreBackup,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** @throws OversellError if the instrument's transactions would sell more than held. */
function assertConsistent(instrument: Instrument, transactions: readonly Transaction[]): void {
  computePosition(instrument, transactions);
}

function toQuote(details: QuoteDetails): Quote {
  const { symbol, price, previousClose, currency, fetchedAt } = details;
  return { symbol, price, previousClose, currency, fetchedAt };
}

function latestFetch(quotes: readonly Quote[]): string | null {
  return (
    quotes
      .map((q) => q.fetchedAt)
      .sort()
      .at(-1) ?? null
  );
}
