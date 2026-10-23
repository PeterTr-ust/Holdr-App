import { describe, expect, it } from "vitest";
import { MarketDataError } from "./provider";
import { parseHistory, parseQuote, parseSearch, YahooFinanceProvider } from "./yahoo";

const chart = (meta: object, timestamp: number[] = [], close: (number | null)[] = []) => ({
  chart: { result: [{ meta, timestamp, indicators: { quote: [{ close }] } }], error: null },
});

describe("parseQuote", () => {
  it("reads price, previous close and descriptive data", () => {
    const quote = parseQuote(
      chart({
        symbol: "SAP.DE",
        currency: "EUR",
        regularMarketPrice: 241.1,
        chartPreviousClose: 238.9,
        longName: "SAP SE",
        fullExchangeName: "XETRA",
      }),
      new Date("2026-10-22T10:00:00Z"),
    );

    expect(quote).toEqual({
      symbol: "SAP.DE",
      price: 241.1,
      previousClose: 238.9,
      currency: "EUR",
      fetchedAt: "2026-10-22T10:00:00.000Z",
      name: "SAP SE",
      exchange: "XETRA",
    });
  });

  it("converts prices quoted in pence into pounds", () => {
    const quote = parseQuote(
      chart({
        symbol: "VOD.L",
        currency: "GBp",
        regularMarketPrice: 7000,
        chartPreviousClose: 6900,
      }),
      new Date(),
    );
    expect(quote.currency).toBe("GBP");
    expect(quote.price).toBeCloseTo(70);
    expect(quote.previousClose).toBeCloseTo(69);
  });

  it("rejects unknown symbols", () => {
    expect(() =>
      parseQuote({ chart: { result: null, error: { code: "Not Found" } } }, new Date()),
    ).toThrow(MarketDataError);
  });
});

describe("parseHistory", () => {
  it("maps timestamps to local exchange dates and skips gaps", () => {
    // Three days at 07:00 UTC, exchange offset +2h; the middle day has no close.
    const series = parseHistory(
      chart(
        { symbol: "SAP.DE", currency: "EUR", gmtoffset: 7200 },
        [1792479600, 1792566000, 1792652400],
        [240, null, 241.5],
      ),
    );
    expect(series).toEqual([
      { date: "2026-10-20", value: 240 },
      { date: "2026-10-22", value: 241.5 },
    ]);
  });
});

describe("parseSearch", () => {
  it("keeps tradable instrument types only", () => {
    const results = parseSearch({
      quotes: [
        { symbol: "SAP.DE", longname: "SAP SE", exchDisp: "XETRA", quoteType: "EQUITY" },
        { symbol: "ES=F", shortname: "E-Mini", quoteType: "FUTURE" },
        { symbol: "EUNL.DE", shortname: "iShares Core MSCI World", quoteType: "ETF" },
      ],
    });
    expect(results.map((r) => r.symbol)).toEqual(["SAP.DE", "EUNL.DE"]);
    expect(results[1]!.name).toBe("iShares Core MSCI World");
  });
});

describe("YahooFinanceProvider", () => {
  it("returns 1 for identical currencies without a request", async () => {
    const provider = new YahooFinanceProvider(() => Promise.reject(new Error("no network")));
    await expect(provider.getExchangeRate("EUR", "EUR")).resolves.toBe(1);
  });

  it("wraps network failures in MarketDataError", async () => {
    const provider = new YahooFinanceProvider(() => Promise.reject(new Error("offline")));
    await expect(provider.getQuote("SAP.DE")).rejects.toBeInstanceOf(MarketDataError);
  });

  it("requests the currency pair symbol for exchange rates", async () => {
    const urls: string[] = [];
    const provider = new YahooFinanceProvider(async (url) => {
      urls.push(url);
      return new Response(
        JSON.stringify(chart({ symbol: "USDEUR=X", currency: "EUR", regularMarketPrice: 0.92 })),
      );
    });
    await expect(provider.getExchangeRate("USD", "EUR")).resolves.toBe(0.92);
    expect(urls[0]).toContain("USDEUR%3DX");
  });
});
