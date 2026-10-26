/**
 * SQLite-backed repository for the desktop app.
 *
 * The database file lives in the operating system's app data directory and
 * its schema is created by the migrations in `src-tauri/src/lib.rs`.
 */
import Database from "@tauri-apps/plugin-sql";
import type { BackupData } from "../domain/backup";
import type {
  Instrument,
  NewInstrument,
  NewTransaction,
  NewWatchlistItem,
  Quote,
  Settings,
  Transaction,
  TransactionType,
  WatchlistItem,
} from "../domain/types";
import type { MarketCacheEntry, PortfolioRepository } from "./repository";

/** Must match the connection string used for migrations on the Rust side. */
export const DATABASE_URL = "sqlite:holdr.db";

/** Keys of the settings table that belong to the user's preferences (and backups). */
const SETTING_KEYS: readonly (keyof Settings)[] = ["language", "displayCurrency"];
const LICENSE_KEY = "licenseKey";

interface InstrumentRow {
  id: number;
  symbol: string;
  name: string;
  currency: string;
  exchange: string | null;
  kind: string | null;
  created_at: string;
}

interface TransactionRow {
  id: number;
  instrument_id: number;
  type: TransactionType;
  trade_date: string;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  split_to: number | null;
  split_from: number | null;
  fee: number;
  tax: number;
  note: string | null;
  created_at: string;
}

interface WatchlistRow {
  id: number;
  symbol: string;
  name: string;
  currency: string;
  exchange: string | null;
  kind: string | null;
  added_at: string;
  added_price: number | null;
}

interface QuoteRow {
  symbol: string;
  price: number;
  previous_close: number | null;
  currency: string;
  fetched_at: string;
}

export class SqliteRepository implements PortfolioRepository {
  private constructor(private readonly db: Database) {}

  static async open(): Promise<SqliteRepository> {
    return new SqliteRepository(await Database.load(DATABASE_URL));
  }

  async listInstruments(): Promise<Instrument[]> {
    const rows = await this.db.select<InstrumentRow[]>("SELECT * FROM instruments ORDER BY name");
    return rows.map(toInstrument);
  }

  async upsertInstrument(input: NewInstrument): Promise<Instrument> {
    await this.db.execute(
      `INSERT INTO instruments (symbol, name, currency, exchange, kind, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(symbol) DO NOTHING`,
      [input.symbol, input.name, input.currency, input.exchange, input.kind, now()],
    );
    const rows = await this.db.select<InstrumentRow[]>(
      "SELECT * FROM instruments WHERE symbol = $1",
      [input.symbol],
    );
    return toInstrument(rows[0]!);
  }

  async deleteInstrument(id: number): Promise<void> {
    // Deleted explicitly instead of relying on ON DELETE CASCADE, because
    // SQLite's foreign key enforcement is a per-connection setting.
    await this.db.execute("DELETE FROM transactions WHERE instrument_id = $1", [id]);
    await this.db.execute("DELETE FROM instruments WHERE id = $1", [id]);
  }

  async listTransactions(): Promise<Transaction[]> {
    const rows = await this.db.select<TransactionRow[]>(
      "SELECT * FROM transactions ORDER BY trade_date, id",
    );
    return rows.map(toTransaction);
  }

  async createTransaction(input: NewTransaction): Promise<Transaction> {
    const createdAt = now();
    const columns = toColumns(input);
    const result = await this.db.execute(
      `INSERT INTO transactions
         (instrument_id, type, trade_date, quantity, price, amount, split_to, split_from, fee, tax,
          note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        input.instrumentId,
        input.type,
        input.date,
        ...columns,
        input.fee,
        input.tax,
        input.note,
        createdAt,
      ],
    );
    if (result.lastInsertId === undefined) throw new Error("Transaction could not be saved.");
    return { ...input, id: result.lastInsertId, createdAt } as Transaction;
  }

  async updateTransaction(transaction: Transaction): Promise<void> {
    await this.db.execute(
      `UPDATE transactions
       SET type = $1, trade_date = $2, quantity = $3, price = $4, amount = $5, split_to = $6,
           split_from = $7, fee = $8, tax = $9, note = $10
       WHERE id = $11`,
      [
        transaction.type,
        transaction.date,
        ...toColumns(transaction),
        transaction.fee,
        transaction.tax,
        transaction.note,
        transaction.id,
      ],
    );
  }

  async deleteTransaction(id: number): Promise<void> {
    await this.db.execute("DELETE FROM transactions WHERE id = $1", [id]);
  }

  async listWatchlist(): Promise<WatchlistItem[]> {
    const rows = await this.db.select<WatchlistRow[]>("SELECT * FROM watchlist ORDER BY name");
    return rows.map(toWatchlistItem);
  }

  async addToWatchlist(input: NewWatchlistItem): Promise<WatchlistItem> {
    await this.db.execute(
      `INSERT INTO watchlist (symbol, name, currency, exchange, kind, added_at, added_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(symbol) DO NOTHING`,
      [
        input.symbol,
        input.name,
        input.currency,
        input.exchange,
        input.kind,
        now(),
        input.addedPrice,
      ],
    );
    const rows = await this.db.select<WatchlistRow[]>("SELECT * FROM watchlist WHERE symbol = $1", [
      input.symbol,
    ]);
    return toWatchlistItem(rows[0]!);
  }

  async removeFromWatchlist(id: number): Promise<void> {
    await this.db.execute("DELETE FROM watchlist WHERE id = $1", [id]);
  }

  async listCachedQuotes(): Promise<Quote[]> {
    const rows = await this.db.select<QuoteRow[]>("SELECT * FROM quotes");
    return rows.map((row) => ({
      symbol: row.symbol,
      price: row.price,
      previousClose: row.previous_close,
      currency: row.currency,
      fetchedAt: row.fetched_at,
    }));
  }

  async saveQuotes(quotes: readonly Quote[]): Promise<void> {
    for (const quote of quotes) {
      await this.db.execute(
        `INSERT INTO quotes (symbol, price, previous_close, currency, fetched_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(symbol) DO UPDATE SET
           price = excluded.price,
           previous_close = excluded.previous_close,
           currency = excluded.currency,
           fetched_at = excluded.fetched_at`,
        [quote.symbol, quote.price, quote.previousClose, quote.currency, quote.fetchedAt],
      );
    }
  }

  async listMarketCache(): Promise<MarketCacheEntry[]> {
    const rows = await this.db.select<{ key: string; value: string; fetched_at: string }[]>(
      "SELECT * FROM market_cache",
    );
    return rows.flatMap((row) => {
      try {
        return [
          { key: row.key, value: JSON.parse(row.value) as unknown, fetchedAt: row.fetched_at },
        ];
      } catch {
        return []; // A corrupt entry is simply fetched again.
      }
    });
  }

  async saveMarketCache(entry: MarketCacheEntry): Promise<void> {
    await this.db.execute(
      `INSERT INTO market_cache (key, value, fetched_at) VALUES ($1, $2, $3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
      [entry.key, JSON.stringify(entry.value), entry.fetchedAt],
    );
  }

  async listDismissedSuggestions(): Promise<string[]> {
    const rows = await this.db.select<{ key: string }[]>("SELECT key FROM dismissed_suggestions");
    return rows.map((row) => row.key);
  }

  async dismissSuggestion(key: string): Promise<void> {
    await this.db.execute(
      "INSERT INTO dismissed_suggestions (key, dismissed_at) VALUES ($1, $2) ON CONFLICT(key) DO NOTHING",
      [key, now()],
    );
  }

  async loadSettings(): Promise<Partial<Settings>> {
    const rows = await this.db.select<{ key: string; value: string }[]>(
      "SELECT key, value FROM settings",
    );
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      if (!(SETTING_KEYS as readonly string[]).includes(row.key)) continue;
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        // Ignore corrupt values; defaults are used instead.
      }
    }
    return settings as Partial<Settings>;
  }

  async saveSettings(settings: Settings): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.db.execute(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, JSON.stringify(value)],
      );
    }
  }

  async loadLicenseKey(): Promise<string | null> {
    const rows = await this.db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = $1",
      [LICENSE_KEY],
    );
    return rows[0]?.value ?? null;
  }

  async saveLicenseKey(key: string | null): Promise<void> {
    if (key === null) {
      await this.db.execute("DELETE FROM settings WHERE key = $1", [LICENSE_KEY]);
      return;
    }
    await this.db.execute(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [LICENSE_KEY, key],
    );
  }

  async replaceAll(data: BackupData): Promise<void> {
    // The SQL plugin runs statements on a connection pool, so a database
    // transaction cannot span several calls. Instead the current state is
    // kept and written back if any step of the replacement fails.
    const previous: BackupData = {
      instruments: await this.listInstruments(),
      transactions: await this.listTransactions(),
      watchlist: await this.listWatchlist(),
      dismissedSuggestions: await this.listDismissedSuggestions(),
      settings: { ...(await this.loadSettings()) } as BackupData["settings"],
    };
    try {
      await this.writeAll(data);
    } catch (error) {
      await this.writeAll(previous);
      throw error;
    }
  }

  private async writeAll(data: BackupData): Promise<void> {
    await this.db.execute("DELETE FROM transactions");
    await this.db.execute("DELETE FROM instruments");
    await this.db.execute("DELETE FROM watchlist");
    await this.db.execute("DELETE FROM quotes");
    await this.db.execute("DELETE FROM dismissed_suggestions");
    // The license key is not part of a backup and survives a restore.
    await this.db.execute("DELETE FROM settings WHERE key <> $1", [LICENSE_KEY]);

    for (const i of data.instruments) {
      await this.db.execute(
        `INSERT INTO instruments (id, symbol, name, currency, exchange, kind, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [i.id, i.symbol, i.name, i.currency, i.exchange, i.kind, i.createdAt || now()],
      );
    }
    for (const tx of data.transactions) {
      await this.db.execute(
        `INSERT INTO transactions
           (id, instrument_id, type, trade_date, quantity, price, amount, split_to, split_from,
            fee, tax, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          tx.id,
          tx.instrumentId,
          tx.type,
          tx.date,
          ...toColumns(tx),
          tx.fee,
          tx.tax,
          tx.note,
          tx.createdAt || now(),
        ],
      );
    }
    for (const w of data.watchlist) {
      await this.db.execute(
        `INSERT INTO watchlist (id, symbol, name, currency, exchange, kind, added_at, added_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [w.id, w.symbol, w.name, w.currency, w.exchange, w.kind, w.addedAt || now(), w.addedPrice],
      );
    }
    for (const key of data.dismissedSuggestions) await this.dismissSuggestion(key);
    if (data.settings.language && data.settings.displayCurrency) {
      await this.saveSettings(data.settings);
    }
  }
}

function toInstrument(row: InstrumentRow): Instrument {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    currency: row.currency,
    exchange: row.exchange,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

function toWatchlistItem(row: WatchlistRow): WatchlistItem {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    currency: row.currency,
    exchange: row.exchange,
    kind: row.kind,
    addedAt: row.added_at,
    addedPrice: row.added_price,
  };
}

function toTransaction(row: TransactionRow): Transaction {
  const base = {
    id: row.id,
    instrumentId: row.instrument_id,
    date: row.trade_date,
    fee: row.fee,
    tax: row.tax ?? 0,
    note: row.note,
    createdAt: row.created_at,
  };
  if (row.type === "DIVIDEND") {
    return { ...base, type: "DIVIDEND", amount: row.amount ?? 0 };
  }
  if (row.type === "SPLIT") {
    return { ...base, type: "SPLIT", ratioTo: row.split_to ?? 1, ratioFrom: row.split_from ?? 1 };
  }
  return { ...base, type: row.type, quantity: row.quantity ?? 0, price: row.price ?? 0 };
}

type TypeColumns = [number | null, number | null, number | null, number | null, number | null];

/** Maps the type-specific fields to the (quantity, price, amount, split_to, split_from) columns. */
function toColumns(tx: NewTransaction): TypeColumns {
  switch (tx.type) {
    case "DIVIDEND":
      return [null, null, tx.amount, null, null];
    case "SPLIT":
      return [null, null, null, tx.ratioTo, tx.ratioFrom];
    default:
      return [tx.quantity, tx.price, null, null, null];
  }
}

function now(): string {
  return new Date().toISOString();
}
