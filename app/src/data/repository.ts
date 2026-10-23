/**
 * Persistence boundary of the app. The UI only talks to this interface, so
 * the storage backend (SQLite on the desktop, memory in tests) is replaceable.
 */
import type { BackupData } from "../domain/backup";
import type {
  Instrument,
  NewInstrument,
  NewTransaction,
  NewWatchlistItem,
  Quote,
  Settings,
  Transaction,
  WatchlistItem,
} from "../domain/types";

export interface PortfolioRepository {
  listInstruments(): Promise<Instrument[]>;
  /** Creates the instrument, or returns the existing one with the same symbol. */
  upsertInstrument(input: NewInstrument): Promise<Instrument>;
  /** Deletes the instrument together with all of its transactions. */
  deleteInstrument(id: number): Promise<void>;

  listTransactions(): Promise<Transaction[]>;
  createTransaction(input: NewTransaction): Promise<Transaction>;
  updateTransaction(transaction: Transaction): Promise<void>;
  deleteTransaction(id: number): Promise<void>;

  listWatchlist(): Promise<WatchlistItem[]>;
  /** Adds the instrument, or returns the existing entry with the same symbol. */
  addToWatchlist(input: NewWatchlistItem): Promise<WatchlistItem>;
  removeFromWatchlist(id: number): Promise<void>;

  /** Last known quotes, so the app shows values while offline. */
  listCachedQuotes(): Promise<Quote[]>;
  saveQuotes(quotes: readonly Quote[]): Promise<void>;

  loadSettings(): Promise<Partial<Settings>>;
  saveSettings(settings: Settings): Promise<void>;

  /** The entered license key; kept separate from settings and never part of a backup. */
  loadLicenseKey(): Promise<string | null>;
  saveLicenseKey(key: string | null): Promise<void>;

  /**
   * Replaces all instruments, transactions, watchlist entries and settings with the given data,
   * keeping their ids. Cached quotes are cleared.
   */
  replaceAll(data: BackupData): Promise<void>;
}
