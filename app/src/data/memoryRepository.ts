/**
 * In-memory repository used for the browser preview and for tests.
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
import type { MarketCacheEntry, PortfolioRepository } from "./repository";

export class MemoryRepository implements PortfolioRepository {
  private instruments: Instrument[] = [];
  private transactions: Transaction[] = [];
  private watchlist: WatchlistItem[] = [];
  private quotes = new Map<string, Quote>();
  private marketCache = new Map<string, MarketCacheEntry>();
  private dismissed = new Set<string>();
  private settings: Partial<Settings> = {};
  private licenseKey: string | null = null;
  private nextId = 1;

  async listInstruments(): Promise<Instrument[]> {
    return [...this.instruments];
  }

  async upsertInstrument(input: NewInstrument): Promise<Instrument> {
    const existing = this.instruments.find((i) => i.symbol === input.symbol);
    if (existing) return existing;
    const instrument: Instrument = {
      ...input,
      id: this.nextId++,
      createdAt: new Date().toISOString(),
    };
    this.instruments.push(instrument);
    return instrument;
  }

  async deleteInstrument(id: number): Promise<void> {
    this.instruments = this.instruments.filter((i) => i.id !== id);
    this.transactions = this.transactions.filter((t) => t.instrumentId !== id);
  }

  async listTransactions(): Promise<Transaction[]> {
    return [...this.transactions];
  }

  async createTransaction(input: NewTransaction): Promise<Transaction> {
    const transaction = {
      ...input,
      id: this.nextId++,
      createdAt: new Date().toISOString(),
    } as Transaction;
    this.transactions.push(transaction);
    return transaction;
  }

  async updateTransaction(transaction: Transaction): Promise<void> {
    this.transactions = this.transactions.map((t) => (t.id === transaction.id ? transaction : t));
  }

  async deleteTransaction(id: number): Promise<void> {
    this.transactions = this.transactions.filter((t) => t.id !== id);
  }

  async listWatchlist(): Promise<WatchlistItem[]> {
    return [...this.watchlist];
  }

  async addToWatchlist(input: NewWatchlistItem): Promise<WatchlistItem> {
    const existing = this.watchlist.find((w) => w.symbol === input.symbol);
    if (existing) return existing;
    const item: WatchlistItem = { ...input, id: this.nextId++, addedAt: new Date().toISOString() };
    this.watchlist.push(item);
    return item;
  }

  async removeFromWatchlist(id: number): Promise<void> {
    this.watchlist = this.watchlist.filter((w) => w.id !== id);
  }

  async listCachedQuotes(): Promise<Quote[]> {
    return [...this.quotes.values()];
  }

  async saveQuotes(quotes: readonly Quote[]): Promise<void> {
    for (const quote of quotes) this.quotes.set(quote.symbol, quote);
  }

  async listMarketCache(): Promise<MarketCacheEntry[]> {
    return [...this.marketCache.values()];
  }

  async saveMarketCache(entry: MarketCacheEntry): Promise<void> {
    this.marketCache.set(entry.key, entry);
  }

  async listDismissedSuggestions(): Promise<string[]> {
    return [...this.dismissed];
  }

  async dismissSuggestion(key: string): Promise<void> {
    this.dismissed.add(key);
  }

  async loadSettings(): Promise<Partial<Settings>> {
    return { ...this.settings };
  }

  async saveSettings(settings: Settings): Promise<void> {
    this.settings = { ...settings };
  }

  async loadLicenseKey(): Promise<string | null> {
    return this.licenseKey;
  }

  async saveLicenseKey(key: string | null): Promise<void> {
    this.licenseKey = key;
  }

  async replaceAll(data: BackupData): Promise<void> {
    this.instruments = [...data.instruments];
    this.transactions = [...data.transactions];
    this.watchlist = [...data.watchlist];
    this.settings = { ...data.settings };
    this.dismissed = new Set(data.dismissedSuggestions);
    this.quotes.clear();
    const ids = [
      ...data.instruments.map((i) => i.id),
      ...data.transactions.map((t) => t.id),
      ...data.watchlist.map((w) => w.id),
    ];
    this.nextId = Math.max(0, ...ids) + 1;
  }
}
