import { describe, expect, it } from "vitest";
import { buildValueSeries } from "./history";
import { computePosition } from "./portfolio";
import type { Instrument, Quote, Transaction } from "./types";
import { computeStatistics, valuePortfolio, type Converter } from "./valuation";

const sap: Instrument = {
  id: 1,
  symbol: "SAP.DE",
  name: "SAP SE",
  currency: "EUR",
  exchange: "XETRA",
  kind: "EQUITY",
  createdAt: "",
};
const apple: Instrument = { ...sap, id: 2, symbol: "AAPL", name: "Apple Inc.", currency: "USD" };

const transactions: Transaction[] = [
  {
    id: 1,
    instrumentId: 1,
    type: "BUY",
    date: "2023-03-01",
    quantity: 10,
    price: 100,
    fee: 0,
    tax: 0,
    note: null,
    createdAt: "",
  },
  {
    id: 2,
    instrumentId: 1,
    type: "SELL",
    date: "2023-09-01",
    quantity: 5,
    price: 140,
    fee: 0,
    tax: 0,
    note: null,
    createdAt: "",
  },
  {
    id: 3,
    instrumentId: 2,
    type: "BUY",
    date: "2024-01-05",
    quantity: 10,
    price: 200,
    fee: 0,
    tax: 0,
    note: null,
    createdAt: "",
  },
  {
    id: 4,
    instrumentId: 2,
    type: "SELL",
    date: "2024-06-01",
    quantity: 2,
    price: 150,
    fee: 0,
    tax: 0,
    note: null,
    createdAt: "",
  },
  {
    id: 5,
    instrumentId: 2,
    type: "DIVIDEND",
    date: "2024-08-01",
    amount: 10,
    fee: 0,
    tax: 0,
    note: null,
    createdAt: "",
  },
];

// 1 USD = 0.5 EUR keeps the arithmetic obvious.
const toEur: Converter = (amount, from) =>
  from === "EUR" ? amount : from === "USD" ? amount * 0.5 : null;

const quotes = new Map<string, Quote>([
  ["SAP.DE", { symbol: "SAP.DE", price: 120, previousClose: 110, currency: "EUR", fetchedAt: "" }],
  ["AAPL", { symbol: "AAPL", price: 250, previousClose: 250, currency: "USD", fetchedAt: "" }],
]);

const positions = [computePosition(sap, transactions), computePosition(apple, transactions)];

describe("valuePortfolio", () => {
  it("converts holdings into the display currency and sums them", () => {
    const { totals, holdings } = valuePortfolio(positions, quotes, toEur);

    // SAP: 5 * 120 = 600 EUR; Apple: 8 * 250 USD = 1000 EUR
    expect(totals.marketValue).toBeCloseTo(1600);
    // SAP cost 500 EUR; Apple cost 8 * 200 USD = 800 EUR
    expect(totals.costBasis).toBeCloseTo(1300);
    expect(totals.unrealized).toBeCloseTo(300);
    expect(totals.dayChange).toBeCloseTo(50);
    expect(holdings[0]!.position.instrument.symbol).toBe("AAPL");
    expect(holdings[0]!.weight).toBeCloseTo(0.625);
  });

  it("marks positions without a quote as unpriced", () => {
    const { totals } = valuePortfolio(positions, new Map(), toEur);
    expect(totals.unpricedCount).toBe(2);
    expect(totals.marketValue).toBe(0);
  });
});

describe("computeStatistics", () => {
  it("separates realized gains, losses and dividends per year", () => {
    const valuation = valuePortfolio(positions, quotes, toEur);
    const stats = computeStatistics(positions, valuation, toEur);

    expect(stats.realizedGains).toBeCloseTo(200); // SAP: 5 * (140 - 100)
    expect(stats.realizedLosses).toBeCloseTo(-50); // Apple: 2 * (150 - 200) USD
    expect(stats.netRealized).toBeCloseTo(150);
    expect(stats.dividends).toBeCloseTo(5);
    expect(stats.taxes).toBe(0);
    expect(stats.totalResult).toBeCloseTo(150 + 5 + 300);
    expect(stats.byYear.map((y) => y.year)).toEqual([2024, 2023]);
    expect(stats.winningTrades).toBe(1);
    expect(stats.losingTrades).toBe(1);
  });
});

describe("computeStatistics with taxes", () => {
  it("subtracts taxes from the total result and reports them per year", () => {
    const taxed = transactions.map((t) => (t.id === 2 ? { ...t, tax: 52.75 } : t));
    const taxedPositions = [computePosition(sap, taxed), computePosition(apple, taxed)];
    const stats = computeStatistics(
      taxedPositions,
      valuePortfolio(taxedPositions, quotes, toEur),
      toEur,
    );

    expect(stats.realizedGains).toBeCloseTo(200); // still before tax
    expect(stats.taxes).toBeCloseTo(52.75);
    expect(stats.totalResult).toBeCloseTo(150 + 5 + 300 - 52.75);
    expect(stats.byYear.find((y) => y.year === 2023)?.taxes).toBeCloseTo(52.75);
    expect(stats.byInstrument.find((i) => i.position.instrument.id === 1)?.taxes).toBeCloseTo(
      52.75,
    );
  });
});

describe("buildValueSeries", () => {
  it("values held shares per day and carries prices forward", () => {
    const histories = new Map([
      [
        "SAP.DE",
        [
          { date: "2023-02-28", value: 90 },
          { date: "2023-03-01", value: 100 },
          { date: "2023-03-03", value: 110 },
        ],
      ],
      ["AAPL", [{ date: "2023-03-02", value: 1 }]],
    ]);
    const series = buildValueSeries(positions, histories, toEur);

    expect(series).toEqual([
      { date: "2023-03-01", value: 1000 },
      { date: "2023-03-02", value: 1000 },
      { date: "2023-03-03", value: 1100 },
    ]);
  });
});
