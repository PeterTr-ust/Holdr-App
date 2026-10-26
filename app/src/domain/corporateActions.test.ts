import { describe, expect, it } from "vitest";
import {
  estimateNextExDate,
  findSuggestions,
  suggestionKey,
  type CorporateActions,
} from "./corporateActions";
import type { Instrument, Transaction } from "./types";

const apple: Instrument = {
  id: 1,
  symbol: "AAPL",
  name: "Apple Inc.",
  currency: "USD",
  exchange: "NASDAQ",
  kind: "EQUITY",
  createdAt: "",
};

let nextId = 1;
const base = { instrumentId: 1, fee: 0, tax: 0, note: null, createdAt: "" };
const buy = (date: string, quantity: number): Transaction => ({
  ...base,
  id: nextId++,
  type: "BUY",
  date,
  quantity,
  price: 100,
});
const sell = (date: string, quantity: number): Transaction => ({
  ...base,
  id: nextId++,
  type: "SELL",
  date,
  quantity,
  price: 100,
});
const dividend = (date: string, amount: number): Transaction => ({
  ...base,
  id: nextId++,
  type: "DIVIDEND",
  date,
  amount,
});
const split = (date: string, ratioTo: number): Transaction => ({
  ...base,
  id: nextId++,
  type: "SPLIT",
  date,
  ratioTo,
  ratioFrom: 1,
});

const quarterly: CorporateActions = {
  dividends: [
    { date: "2024-02-09", amount: 0.24 },
    { date: "2024-05-10", amount: 0.25 },
    { date: "2024-08-12", amount: 0.25 },
    { date: "2024-11-08", amount: 0.25 },
  ],
  splits: [],
};

const none = new Set<string>();

describe("findSuggestions", () => {
  it("suggests dividends for shares held before the ex-date", () => {
    const suggestions = findSuggestions(apple, [buy("2024-05-01", 10)], quarterly, none);
    expect(suggestions.map((s) => s.event.date)).toEqual([
      "2024-11-08",
      "2024-08-12",
      "2024-05-10",
    ]);
    const first = suggestions.at(-1)!;
    expect(first.kind).toBe("DIVIDEND");
    expect(first.kind === "DIVIDEND" && first.amount).toBeCloseTo(2.5);
  });

  it("ignores ex-dates on which the shares were just bought or already sold", () => {
    const txs = [buy("2024-05-10", 10), sell("2024-08-11", 10)];
    expect(findSuggestions(apple, txs, quarterly, none)).toEqual([]);
  });

  it("matches recorded dividends paid some days after the ex-date", () => {
    const txs = [buy("2024-01-01", 10), dividend("2024-02-15", 2.4), dividend("2024-08-20", 2.5)];
    const dates = findSuggestions(apple, txs, quarterly, none).map((s) => s.event.date);
    expect(dates).toEqual(["2024-11-08", "2024-05-10"]);
  });

  it("matches each recorded dividend to the closest earlier event only", () => {
    const monthly: CorporateActions = {
      dividends: ["2024-01-15", "2024-02-15", "2024-03-15"].map((date) => ({ date, amount: 1 })),
      splits: [],
    };
    // January was not recorded; February and March were, a few days after the ex-date.
    const txs = [buy("2024-01-01", 1), dividend("2024-02-20", 1), dividend("2024-03-20", 1)];
    const dates = findSuggestions(apple, txs, monthly, none).map((s) => s.event.date);
    expect(dates).toEqual(["2024-01-15"]);
  });

  it("leaves out dismissed suggestions", () => {
    const dismissed = new Set([
      suggestionKey("AAPL", "DIVIDEND", "2024-08-12"),
      suggestionKey("AAPL", "DIVIDEND", "2024-11-08"),
    ]);
    const dates = findSuggestions(apple, [buy("2024-05-01", 10)], quarterly, dismissed).map(
      (s) => s.event.date,
    );
    expect(dates).toEqual(["2024-05-10"]);
  });

  it("suggests unrecorded splits and undoes the split adjustment of earlier dividends", () => {
    const actions: CorporateActions = {
      // The provider reports dividends adjusted for the later 4-for-1 split.
      dividends: [{ date: "2020-05-08", amount: 0.205 }],
      splits: [{ date: "2020-08-31", ratioTo: 4, ratioFrom: 1 }],
    };
    const suggestions = findSuggestions(apple, [buy("2020-01-02", 10)], actions, none);
    const [splitSuggestion, dividendSuggestion] = suggestions;
    expect(splitSuggestion).toMatchObject({ kind: "SPLIT", sharesBefore: 10, sharesAfter: 40 });
    expect(dividendSuggestion?.kind === "DIVIDEND" && dividendSuggestion.amount).toBeCloseTo(8.2);
  });

  it("does not suggest a split that is already recorded", () => {
    const actions: CorporateActions = {
      dividends: [],
      splits: [{ date: "2020-08-31", ratioTo: 4, ratioFrom: 1 }],
    };
    const txs = [buy("2020-01-02", 10), split("2020-09-01", 4)];
    expect(findSuggestions(apple, txs, actions, none)).toEqual([]);
  });
});

describe("estimateNextExDate", () => {
  it("adds the usual interval to the last ex-date", () => {
    expect(estimateNextExDate(quarterly.dividends, "2024-12-01")).toBe("2025-02-07");
  });

  it("gives up when the estimate is already overdue", () => {
    expect(estimateNextExDate(quarterly.dividends, "2025-03-01")).toBeNull();
  });

  it("needs at least two payments with a regular interval", () => {
    expect(estimateNextExDate([{ date: "2024-05-01", amount: 1 }], "2024-06-01")).toBeNull();
    const irregular = [
      { date: "2020-05-01", amount: 1 },
      { date: "2024-05-01", amount: 1 },
    ];
    expect(estimateNextExDate(irregular, "2024-06-01")).toBeNull();
  });
});
