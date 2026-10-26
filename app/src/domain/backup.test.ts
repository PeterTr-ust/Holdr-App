import { describe, expect, it } from "vitest";
import { backupFileName, BackupError, createBackup, parseBackup, type BackupData } from "./backup";

const data: BackupData = {
  instruments: [
    {
      id: 3,
      symbol: "SAP.DE",
      name: "SAP SE",
      currency: "EUR",
      exchange: "XETRA",
      kind: "EQUITY",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  transactions: [
    {
      id: 7,
      instrumentId: 3,
      type: "BUY",
      date: "2026-01-02",
      quantity: 10,
      price: 200,
      fee: 1,
      tax: 0,
      note: "Erster Kauf",
      createdAt: "",
    },
    {
      id: 8,
      instrumentId: 3,
      type: "DIVIDEND",
      date: "2026-05-20",
      amount: 23.5,
      fee: 0,
      tax: 6.2,
      note: null,
      createdAt: "",
    },
    {
      id: 9,
      instrumentId: 3,
      type: "SPLIT",
      date: "2026-06-01",
      ratioTo: 2,
      ratioFrom: 1,
      fee: 0,
      tax: 0,
      note: null,
      createdAt: "",
    },
  ],
  watchlist: [
    {
      id: 12,
      symbol: "AAPL",
      name: "Apple Inc.",
      currency: "USD",
      exchange: "NASDAQ",
      kind: "EQUITY",
      addedAt: "2026-03-01T10:00:00.000Z",
      addedPrice: 210.5,
    },
  ],
  dismissedSuggestions: ["SAP.DE|DIVIDEND|2026-05-15"],
  settings: { language: "de", displayCurrency: "EUR" },
};

const serialize = (value: unknown) => JSON.stringify(value);
const codeOf = (text: string) => {
  try {
    parseBackup(text);
  } catch (error) {
    return error instanceof BackupError ? error.code : "other";
  }
  return null;
};

describe("backup round trip", () => {
  it("restores exactly what was exported", () => {
    const file = createBackup(data, "0.1.0", new Date("2026-10-22T12:00:00Z"));
    const parsed = parseBackup(serialize(file));

    expect(parsed.instruments).toEqual(data.instruments);
    expect(parsed.transactions).toEqual(data.transactions);
    expect(parsed.watchlist).toEqual(data.watchlist);
    expect(parsed.dismissedSuggestions).toEqual(data.dismissedSuggestions);
    expect(parsed.settings).toEqual(data.settings);
    expect(parsed.exportedAt).toBe("2026-10-22T12:00:00.000Z");
  });

  it("suggests a dated file name", () => {
    expect(backupFileName(new Date(2026, 9, 5))).toBe("holdr-backup-2026-10-05.json");
  });
});

describe("parseBackup compatibility", () => {
  it("accepts version 3 files, which had no dismissed suggestions", () => {
    const legacy: Record<string, unknown> = { ...createBackup(data, "0.1.0"), version: 3 };
    delete legacy.dismissedSuggestions;
    expect(parseBackup(JSON.stringify(legacy)).dismissedSuggestions).toEqual([]);
  });

  it("accepts version 2 files, which had no separate taxes", () => {
    const legacy = createBackup(data, "0.1.0") as unknown as Record<string, unknown>;
    const transactions = (legacy.transactions as Record<string, unknown>[]).map((t) => {
      const copy = { ...t };
      delete copy.tax;
      return copy;
    });
    const parsed = parseBackup(JSON.stringify({ ...legacy, version: 2, transactions }));
    expect(parsed.transactions.every((t) => t.tax === 0)).toBe(true);
  });

  it("accepts version 1 files, which had no watchlist", () => {
    const legacy: Record<string, unknown> = { ...createBackup(data, "0.1.0"), version: 1 };
    delete legacy.watchlist;
    const parsed = parseBackup(JSON.stringify(legacy));
    expect(parsed.watchlist).toEqual([]);
    expect(parsed.transactions).toHaveLength(3);
  });
});

describe("parseBackup rejects", () => {
  const valid = createBackup(data, "0.1.0");

  it("files that are not JSON", () => {
    expect(codeOf("not json")).toBe("notJson");
  });

  it("JSON that is not a Holdr backup", () => {
    expect(codeOf(serialize({ hello: "world" }))).toBe("notBackup");
    expect(codeOf(serialize([1, 2]))).toBe("notBackup");
  });

  it("backups from a newer app version", () => {
    expect(codeOf(serialize({ ...valid, version: 99 }))).toBe("newerVersion");
  });

  it("transactions pointing to unknown instruments", () => {
    const broken = { ...valid, transactions: [{ ...data.transactions[0], instrumentId: 42 }] };
    expect(codeOf(serialize(broken))).toBe("invalid");
  });

  it("negative or missing numbers", () => {
    const negative = { ...valid, transactions: [{ ...data.transactions[0], quantity: -1 }] };
    const missing = { ...valid, transactions: [{ ...data.transactions[0], price: "12" }] };
    expect(codeOf(serialize(negative))).toBe("invalid");
    expect(codeOf(serialize(missing))).toBe("invalid");
  });

  it("malformed dates and currencies", () => {
    const date = { ...valid, transactions: [{ ...data.transactions[0], date: "02.01.2026" }] };
    const currency = { ...valid, instruments: [{ ...data.instruments[0], currency: "euro" }] };
    expect(codeOf(serialize(date))).toBe("invalid");
    expect(codeOf(serialize(currency))).toBe("invalid");
  });

  it("duplicate ids", () => {
    const duplicate = { ...valid, transactions: [data.transactions[0], data.transactions[0]] };
    expect(codeOf(serialize(duplicate))).toBe("invalid");
  });

  it("sales of more shares than held", () => {
    const oversold = {
      ...valid,
      transactions: [
        ...data.transactions,
        // 10 shares, doubled by the split.
        { ...data.transactions[0], id: 10, type: "SELL", date: "2026-06-02", quantity: 21 },
      ],
    };
    expect(codeOf(serialize(oversold))).toBe("inconsistent");
  });

  it("splits with a missing ratio or with fees", () => {
    const split = data.transactions[2]!;
    const noRatio = { ...valid, transactions: [data.transactions[0], { ...split, ratioTo: 0 }] };
    const withFee = { ...valid, transactions: [data.transactions[0], { ...split, fee: 1 }] };
    expect(codeOf(serialize(noRatio))).toBe("invalid");
    expect(codeOf(serialize(withFee))).toBe("invalid");
  });
});
