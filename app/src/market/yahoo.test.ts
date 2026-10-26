import { describe, expect, it } from "vitest";
import { MarketDataError } from "./provider";
import {
  parseCorporateActions,
  parseHistory,
  parseProfile,
  parseQuote,
  parseSearch,
  parseUpcomingEvents,
  YahooFinanceProvider,
} from "./yahoo";

const chart = (
  meta: object,
  timestamp: number[] = [],
  close: (number | null)[] = [],
  events?: object,
) => ({
  chart: { result: [{ meta, timestamp, indicators: { quote: [{ close }] }, events }], error: null },
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

describe("parseCorporateActions", () => {
  it("reads dividends and splits as exchange dates, oldest first", () => {
    const json = chart({ symbol: "AAPL", currency: "USD", gmtoffset: -14400 }, [], [], {
      dividends: {
        "1731076200": { amount: 0.25, date: 1731076200 },
        "1723469400": { amount: 0.25, date: 1723469400 },
      },
      splits: { "1598880600": { date: 1598880600, numerator: 4, denominator: 1 } },
    });
    expect(parseCorporateActions(json)).toEqual({
      dividends: [
        { date: "2024-08-12", amount: 0.25 },
        { date: "2024-11-08", amount: 0.25 },
      ],
      splits: [{ date: "2020-08-31", ratioTo: 4, ratioFrom: 1 }],
    });
  });

  it("converts dividends in pence into pounds and copes with no events", () => {
    expect(parseCorporateActions(chart({ symbol: "VOD.L", currency: "GBp" }))).toEqual({
      dividends: [],
      splits: [],
    });
    const json = chart({ symbol: "VOD.L", currency: "GBp" }, [], [], {
      dividends: { x: { amount: 4.5, date: 1700000000 } },
    });
    expect(parseCorporateActions(json).dividends[0]!.amount).toBeCloseTo(0.045);
  });
});

const summary = (result: object) => ({ quoteSummary: { result: [result], error: null } });

describe("parseProfile", () => {
  it("maps sector and country to provider-independent codes", () => {
    const profile = parseProfile(
      summary({
        assetProfile: {
          sector: "Technology",
          industry: "Software—Application",
          country: "Germany",
        },
      }),
    );
    expect(profile).toEqual({
      sector: "technology",
      industry: "Software—Application",
      country: "DE",
      sectorWeights: null,
    });
  });

  it("reads sector weights of funds", () => {
    const profile = parseProfile(
      summary({
        topHoldings: {
          sectorWeightings: [
            { technology: { raw: 0.25, fmt: "25%" } },
            { financial_services: 0.15 },
            { realestate: { raw: 0 } },
          ],
        },
      }),
    );
    expect(profile.sectorWeights).toEqual({ technology: 0.25, financialServices: 0.15 });
    expect(profile.sector).toBeNull();
  });

  it("rejects an empty answer", () => {
    expect(() => parseProfile({ quoteSummary: { result: null } })).toThrow(MarketDataError);
  });
});

describe("parseUpcomingEvents", () => {
  const now = new Date("2026-10-26T10:00:00Z");
  const seconds = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;

  it("keeps future dates and flags an earnings window as estimated", () => {
    const events = parseUpcomingEvents(
      summary({
        calendarEvents: {
          exDividendDate: { raw: seconds("2026-11-10") },
          dividendDate: { raw: seconds("2026-11-13") },
          earnings: {
            earningsDate: [{ raw: seconds("2027-01-28") }, { raw: seconds("2027-02-02") }],
          },
        },
      }),
      now,
    );
    expect(events).toEqual({
      exDividendDate: "2026-11-10",
      dividendPaymentDate: "2026-11-13",
      earningsDate: "2027-01-28",
      earningsDateEstimated: true,
    });
  });

  it("drops dates in the past", () => {
    const events = parseUpcomingEvents(
      summary({
        calendarEvents: {
          exDividendDate: seconds("2026-05-14"),
          earnings: { earningsDate: [seconds("2026-10-30")] },
        },
      }),
      now,
    );
    expect(events.exDividendDate).toBeNull();
    expect(events.earningsDate).toBe("2026-10-30");
    expect(events.earningsDateEstimated).toBe(false);
  });
});

describe("YahooFinanceProvider capabilities", () => {
  it("offers profiles and dates only with a quote summary source", async () => {
    const plain = new YahooFinanceProvider(() => Promise.reject(new Error("unused")));
    expect(plain.getProfile).toBeUndefined();

    const requested: string[][] = [];
    const withSummary = new YahooFinanceProvider(
      () => Promise.reject(new Error("unused")),
      async (_symbol, modules) => {
        requested.push([...modules]);
        return summary({ assetProfile: { sector: "Energy", country: "Norway" } });
      },
    );
    await expect(withSummary.getProfile?.("EQNR")).resolves.toMatchObject({
      sector: "energy",
      country: "NO",
    });
    expect(requested).toEqual([["assetProfile", "topHoldings"]]);
  });

  it("wraps quote summary failures in MarketDataError", async () => {
    const provider = new YahooFinanceProvider(
      () => Promise.reject(new Error("unused")),
      () => Promise.reject(new Error("no session")),
    );
    await expect(provider.getUpcomingEvents?.("SAP.DE")).rejects.toBeInstanceOf(MarketDataError);
  });
});
