/**
 * Backup file format: a self-contained JSON snapshot of all instruments,
 * transactions, watchlist entries and settings. Cached quotes are not included; they are
 * fetched again after an import.
 *
 * Imports are validated completely before anything is written, so a broken
 * or foreign file can never leave the database half replaced.
 */
import { computePosition, OversellError } from "./portfolio";
import {
  DISPLAY_CURRENCIES,
  type Instrument,
  type Settings,
  type Transaction,
  type TransactionType,
  type WatchlistItem,
} from "./types";

export const BACKUP_FORMAT = "holdr-backup";
/**
 * Version 2 added the watchlist, version 3 separate taxes. Older files are
 * still accepted: a missing watchlist is empty, missing taxes are 0.
 */
export const BACKUP_VERSION = 3;

/** The data a backup restores. */
export interface BackupData {
  instruments: Instrument[];
  transactions: Transaction[];
  watchlist: WatchlistItem[];
  settings: Settings;
}

export interface BackupFile extends BackupData {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
}

/** Why a file cannot be imported; mapped to a translated message in the UI. */
export type BackupErrorCode = "notJson" | "notBackup" | "newerVersion" | "invalid" | "inconsistent";

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    detail: string,
  ) {
    super(detail);
    this.name = "BackupError";
  }
}

export function createBackup(data: BackupData, appVersion: string, now = new Date()): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    appVersion,
    instruments: data.instruments,
    transactions: data.transactions,
    watchlist: data.watchlist,
    settings: data.settings,
  };
}

/** Suggested file name, e.g. "holdr-backup-2026-10-22.json". */
export function backupFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `holdr-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/**
 * Parses and validates the contents of a backup file.
 *
 * @throws BackupError describing the first problem found.
 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("notJson", "The file is not valid JSON.");
  }

  const file = asRecord(raw, "notBackup", "file");
  if (file.format !== BACKUP_FORMAT) {
    throw new BackupError("notBackup", "The file is not a Holdr backup.");
  }
  if (typeof file.version !== "number" || file.version > BACKUP_VERSION) {
    throw new BackupError("newerVersion", `Unsupported backup version ${String(file.version)}.`);
  }

  const instruments = asArray(file.instruments, "instruments").map(parseInstrument);
  const transactions = asArray(file.transactions, "transactions").map(parseTransaction);
  const watchlist =
    file.watchlist === undefined && file.version < 2
      ? []
      : asArray(file.watchlist, "watchlist").map(parseWatchlistItem);
  const settings = parseSettings(file.settings);

  assertUnique(
    watchlist.map((w) => w.symbol),
    "watchlist symbol",
  );

  assertUnique(
    instruments.map((i) => i.id),
    "instrument id",
  );
  assertUnique(
    instruments.map((i) => i.symbol),
    "instrument symbol",
  );
  assertUnique(
    transactions.map((t) => t.id),
    "transaction id",
  );

  const instrumentIds = new Set(instruments.map((i) => i.id));
  for (const tx of transactions) {
    if (!instrumentIds.has(tx.instrumentId)) {
      invalid(`Transaction ${tx.id} refers to unknown instrument ${tx.instrumentId}.`);
    }
  }

  for (const instrument of instruments) {
    try {
      computePosition(instrument, transactions);
    } catch (error) {
      if (error instanceof OversellError) {
        throw new BackupError("inconsistent", `${instrument.symbol}: ${error.message}`);
      }
      throw error;
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: file.version,
    exportedAt: typeof file.exportedAt === "string" ? file.exportedAt : "",
    appVersion: typeof file.appVersion === "string" ? file.appVersion : "",
    instruments,
    transactions,
    watchlist,
    settings,
  };
}

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

const TRANSACTION_TYPES: readonly TransactionType[] = ["BUY", "SELL", "DIVIDEND"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseInstrument(value: unknown, index: number): Instrument {
  const where = `instruments[${index}]`;
  const r = asRecord(value, "invalid", where);
  return {
    id: integer(r.id, `${where}.id`),
    symbol: text(r.symbol, `${where}.symbol`),
    name: text(r.name, `${where}.name`),
    currency: currencyCode(r.currency, `${where}.currency`),
    exchange: optionalText(r.exchange, `${where}.exchange`),
    kind: optionalText(r.kind, `${where}.kind`),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };
}

function parseTransaction(value: unknown, index: number): Transaction {
  const where = `transactions[${index}]`;
  const r = asRecord(value, "invalid", where);
  const type = r.type as TransactionType;
  if (!TRANSACTION_TYPES.includes(type)) invalid(`${where}.type is not BUY, SELL or DIVIDEND.`);

  const base = {
    id: integer(r.id, `${where}.id`),
    instrumentId: integer(r.instrumentId, `${where}.instrumentId`),
    date: isoDate(r.date, `${where}.date`),
    fee: number(r.fee, `${where}.fee`, { min: 0 }),
    tax: r.tax === undefined ? 0 : number(r.tax, `${where}.tax`, { min: 0 }),
    note: optionalText(r.note, `${where}.note`),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
  };

  if (type === "BUY" && base.tax !== 0) invalid(`${where}.tax must be 0 for a purchase.`);
  if (type === "DIVIDEND") {
    return { ...base, type, amount: number(r.amount, `${where}.amount`, { min: 0 }) };
  }
  return {
    ...base,
    type,
    quantity: number(r.quantity, `${where}.quantity`, { min: 0, exclusive: true }),
    price: number(r.price, `${where}.price`, { min: 0 }),
  };
}

function parseWatchlistItem(value: unknown, index: number): WatchlistItem {
  const where = `watchlist[${index}]`;
  const r = asRecord(value, "invalid", where);
  return {
    id: integer(r.id, `${where}.id`),
    symbol: text(r.symbol, `${where}.symbol`),
    name: text(r.name, `${where}.name`),
    currency: currencyCode(r.currency, `${where}.currency`),
    exchange: optionalText(r.exchange, `${where}.exchange`),
    kind: optionalText(r.kind, `${where}.kind`),
    addedAt: typeof r.addedAt === "string" ? r.addedAt : "",
    addedPrice:
      r.addedPrice === null || r.addedPrice === undefined
        ? null
        : number(r.addedPrice, `${where}.addedPrice`, { min: 0 }),
  };
}

function parseSettings(value: unknown): Settings {
  const r = asRecord(value, "invalid", "settings");
  if (r.language !== "de" && r.language !== "en") invalid("settings.language is invalid.");
  if (!DISPLAY_CURRENCIES.includes(r.displayCurrency as Settings["displayCurrency"])) {
    invalid("settings.displayCurrency is invalid.");
  }
  return {
    language: r.language,
    displayCurrency: r.displayCurrency as Settings["displayCurrency"],
  };
}

function invalid(detail: string): never {
  throw new BackupError("invalid", detail);
}

function asRecord(value: unknown, code: BackupErrorCode, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BackupError(code, `${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${where} must be a list.`);
  return value;
}

function integer(value: unknown, where: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    invalid(`${where} must be a positive whole number.`);
  }
  return value as number;
}

function number(
  value: unknown,
  where: string,
  { min, exclusive = false }: { min: number; exclusive?: boolean },
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${where} must be a number.`);
  if (exclusive ? value <= min : value < min) invalid(`${where} is out of range.`);
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") invalid(`${where} must be a text.`);
  return value;
}

function optionalText(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") invalid(`${where} must be a text.`);
  return value;
}

function currencyCode(value: unknown, where: string): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    invalid(`${where} must be a currency code like EUR.`);
  }
  return value;
}

function isoDate(value: unknown, where: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    invalid(`${where} must be a date like 2026-01-31.`);
  }
  return value;
}

function assertUnique(values: readonly (string | number)[], what: string): void {
  const seen = new Set<string | number>();
  for (const value of values) {
    if (seen.has(value)) invalid(`Duplicate ${what}: ${value}.`);
    seen.add(value);
  }
}
