import { describe, expect, it } from "vitest";
import {
  computePosition,
  findOversell,
  OversellError,
  quantityAt,
  splitFactorAfter,
} from "./portfolio";
import type { Instrument, Transaction } from "./types";

const sap: Instrument = {
  id: 1,
  symbol: "SAP.DE",
  name: "SAP SE",
  currency: "EUR",
  exchange: "XETRA",
  kind: "EQUITY",
  createdAt: "2024-01-01T00:00:00Z",
};

let nextId = 1;
function buy(date: string, quantity: number, price: number, fee = 0): Transaction {
  return {
    id: nextId++,
    instrumentId: 1,
    type: "BUY",
    date,
    quantity,
    price,
    fee,
    tax: 0,
    note: null,
    createdAt: "",
  };
}
function sell(date: string, quantity: number, price: number, fee = 0, tax = 0): Transaction {
  return {
    id: nextId++,
    instrumentId: 1,
    type: "SELL",
    date,
    quantity,
    price,
    fee,
    tax,
    note: null,
    createdAt: "",
  };
}
function dividend(date: string, amount: number, fee = 0, tax = 0): Transaction {
  return {
    id: nextId++,
    instrumentId: 1,
    type: "DIVIDEND",
    date,
    amount,
    fee,
    tax,
    note: null,
    createdAt: "",
  };
}

function split(date: string, ratioTo: number, ratioFrom = 1): Transaction {
  return {
    id: nextId++,
    instrumentId: 1,
    type: "SPLIT",
    date,
    ratioTo,
    ratioFrom,
    fee: 0,
    tax: 0,
    note: null,
    createdAt: "",
  };
}

describe("computePosition", () => {
  it("sums buys into quantity and cost basis including fees", () => {
    const position = computePosition(sap, [
      buy("2024-01-10", 10, 100, 5),
      buy("2024-02-10", 10, 120, 5),
    ]);

    expect(position.quantity).toBe(20);
    expect(position.costBasis).toBeCloseTo(2210);
    expect(position.averageCost).toBeCloseTo(110.5);
    expect(position.realizedTrades).toBe(0);
    expect(position.fees).toBe(10);
  });

  it("realizes gains with FIFO, consuming the oldest lot first", () => {
    const position = computePosition(sap, [
      buy("2024-01-10", 10, 100),
      buy("2024-02-10", 10, 150),
      sell("2024-03-10", 15, 160, 10),
    ]);

    // 10 @ 100 + 5 @ 150 = 1750 cost; proceeds 15 * 160 - 10 = 2390
    expect(position.realizedTrades).toBeCloseTo(640);
    expect(position.quantity).toBe(5);
    expect(position.costBasis).toBeCloseTo(750);
    expect(position.openLots).toHaveLength(1);
  });

  it("records a realized loss as a negative event", () => {
    const position = computePosition(sap, [
      buy("2024-01-10", 10, 100, 10),
      sell("2024-03-10", 10, 80, 10),
    ]);

    expect(position.realizedTrades).toBeCloseTo(-220);
    expect(position.quantity).toBe(0);
    expect(position.averageCost).toBeNull();
  });

  it("applies same-day buys before sells regardless of entry order", () => {
    const sellFirst = sell("2024-05-01", 5, 110);
    const buyLater = buy("2024-05-01", 5, 100);

    const position = computePosition(sap, [sellFirst, buyLater]);
    expect(position.realizedTrades).toBeCloseTo(50);
  });

  it("counts dividends net of withholding tax", () => {
    const position = computePosition(sap, [
      buy("2024-01-10", 10, 100),
      dividend("2024-05-15", 22, 5.8),
    ]);

    expect(position.dividends).toBeCloseTo(16.2);
    expect(position.realizedTrades).toBe(0);
  });

  it("keeps taxes apart from the pre-tax result", () => {
    const position = computePosition(sap, [
      buy("2024-01-10", 10, 100, 5),
      sell("2024-03-10", 10, 150, 5, 120.5),
      dividend("2024-05-15", 30, 0, 7.91),
    ]);

    // Proceeds 1500 - 5 fee, cost 1005 → 490 before tax
    expect(position.realizedTrades).toBeCloseTo(490);
    expect(position.dividends).toBeCloseTo(30);
    expect(position.taxes).toBeCloseTo(128.41);
    expect(position.fees).toBe(10);
    expect(position.events.map((e) => e.tax)).toEqual([120.5, 7.91]);
  });

  it("supports fractional shares", () => {
    const position = computePosition(sap, [
      buy("2024-01-10", 0.333333, 150),
      buy("2024-02-10", 0.666667, 150),
      sell("2024-03-10", 1, 160),
    ]);
    expect(position.quantity).toBeCloseTo(0);
    expect(position.realizedTrades).toBeCloseTo(10);
  });

  it("throws when selling more shares than held", () => {
    expect(() =>
      computePosition(sap, [buy("2024-01-10", 5, 100), sell("2024-01-11", 6, 100)]),
    ).toThrow(OversellError);
  });
});

describe("findOversell", () => {
  it("detects a sell that becomes invalid after removing an earlier buy", () => {
    const transactions = [sell("2024-03-01", 5, 100)];
    expect(findOversell(sap, transactions)?.available).toBe(0);
  });

  it("returns null for consistent histories", () => {
    expect(findOversell(sap, [buy("2024-01-01", 5, 1), sell("2024-02-01", 5, 2)])).toBeNull();
  });
});

describe("quantityAt", () => {
  it("returns holdings at the end of a given day", () => {
    const txs = [buy("2024-01-10", 10, 100), sell("2024-02-10", 4, 100)];
    expect(quantityAt(txs, "2024-01-09")).toBe(0);
    expect(quantityAt(txs, "2024-01-10")).toBe(10);
    expect(quantityAt(txs, "2024-03-01")).toBe(6);
  });
});

describe("splits", () => {
  it("multiplies held shares and divides their cost, keeping the cost basis", () => {
    const position = computePosition(sap, [buy("2024-01-10", 10, 400, 8), split("2024-06-10", 4)]);
    expect(position.quantity).toBe(40);
    expect(position.costBasis).toBeCloseTo(4008);
    expect(position.averageCost).toBeCloseTo(100.2);
  });

  it("realizes later sales against the split-adjusted cost", () => {
    const position = computePosition(sap, [
      buy("2024-01-10", 10, 400),
      split("2024-06-10", 4),
      sell("2024-07-01", 20, 120),
    ]);
    expect(position.realizedTrades).toBeCloseTo(20 * 120 - 20 * 100);
    expect(position.quantity).toBe(20);
  });

  it("applies a split before trades on the same day", () => {
    const position = computePosition(sap, [
      sell("2024-06-10", 30, 100),
      buy("2024-01-10", 10, 400),
      split("2024-06-10", 4),
    ]);
    expect(position.quantity).toBe(10);
  });

  it("handles reverse splits", () => {
    const position = computePosition(sap, [buy("2024-01-10", 100, 2), split("2024-06-10", 1, 10)]);
    expect(position.quantity).toBeCloseTo(10);
    expect(position.averageCost).toBeCloseTo(20);
  });

  it("are reflected in quantityAt and splitFactorAfter", () => {
    const txs = [buy("2024-01-10", 10, 400), split("2024-06-10", 4), buy("2024-07-01", 5, 100)];
    expect(quantityAt(txs, "2024-06-09")).toBe(10);
    expect(quantityAt(txs, "2024-06-10")).toBe(40);
    expect(quantityAt(txs, "2024-07-01")).toBe(45);
    expect(splitFactorAfter(txs, "2024-06-09")).toBe(4);
    expect(splitFactorAfter(txs, "2024-06-10")).toBe(1);
  });
});
