import { describe, expect, it } from "vitest";
import type { Quote } from "../domain/types";
import { createConverter, requiredRateSymbols } from "./currency";

const rate = (symbol: string, price: number): [string, Quote] => [
  symbol,
  { symbol, price, previousClose: null, currency: "EUR", fetchedAt: "" },
];

describe("currency conversion", () => {
  it("lists one rate symbol per foreign currency", () => {
    expect(requiredRateSymbols(["USD", "EUR", "USD", "GBP"], "EUR")).toEqual([
      "USDEUR=X",
      "GBPEUR=X",
    ]);
  });

  it("converts with cached rate quotes and returns null for unknown currencies", () => {
    const convert = createConverter("EUR", new Map([rate("USDEUR=X", 0.9)]));
    expect(convert(100, "EUR")).toBe(100);
    expect(convert(100, "USD")).toBeCloseTo(90);
    expect(convert(100, "CHF")).toBeNull();
  });
});
