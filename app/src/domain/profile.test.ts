import { describe, expect, it } from "vitest";
import { computePosition } from "./portfolio";
import {
  computeAllocation,
  countryCodeFromName,
  sectorFromLabel,
  type InstrumentProfile,
} from "./profile";
import type { Instrument } from "./types";
import type { HoldingView } from "./valuation";

describe("sectorFromLabel", () => {
  it("accepts the spellings of different providers", () => {
    expect(sectorFromLabel("Financial Services")).toBe("financialServices");
    expect(sectorFromLabel("financial_services")).toBe("financialServices");
    expect(sectorFromLabel("REAL ESTATE")).toBe("realEstate");
    expect(sectorFromLabel("realestate")).toBe("realEstate");
    expect(sectorFromLabel("Information Technology")).toBe("technology");
    expect(sectorFromLabel("Something else")).toBeNull();
    expect(sectorFromLabel(null)).toBeNull();
  });
});

describe("countryCodeFromName", () => {
  it("maps English country names to ISO codes", () => {
    expect(countryCodeFromName("Germany")).toBe("DE");
    expect(countryCodeFromName("United States")).toBe("US");
    expect(countryCodeFromName("Hong Kong")).toBe("HK");
    expect(countryCodeFromName("Ireland")).toBe("IE");
    expect(countryCodeFromName("at")).toBe("AT");
    expect(countryCodeFromName("Atlantis")).toBeNull();
  });
});

describe("computeAllocation", () => {
  const instrument = (id: number, symbol: string, kind: string): Instrument => ({
    id,
    symbol,
    name: symbol,
    currency: "EUR",
    exchange: null,
    kind,
    createdAt: "",
  });
  const holding = (inst: Instrument, marketValue: number) =>
    ({ position: computePosition(inst, []), marketValue }) as unknown as HoldingView;

  const sap = instrument(1, "SAP.DE", "EQUITY");
  const siemens = instrument(2, "SIE.DE", "EQUITY");
  const world = instrument(3, "EUNL.DE", "ETF");
  const unknown = instrument(4, "XYZ", "EQUITY");
  const profiles = new Map<string, InstrumentProfile>([
    ["SAP.DE", { sector: "technology", industry: null, country: "DE", sectorWeights: null }],
    ["SIE.DE", { sector: "industrials", industry: null, country: "DE", sectorWeights: null }],
    [
      "EUNL.DE",
      {
        sector: null,
        industry: null,
        country: null,
        // Adds up to 0.9; the rest is cash.
        sectorWeights: { technology: 0.45, healthcare: 0.45 },
      },
    ],
  ]);

  it("spreads funds over their sector weights and groups unknown values last", () => {
    const allocation = computeAllocation(
      [holding(sap, 300), holding(siemens, 100), holding(world, 400), holding(unknown, 200)],
      profiles,
    );
    expect(allocation.totalValue).toBe(1000);
    expect(allocation.coveredValue).toBe(800);
    expect(allocation.bySector.map((s) => [s.key, s.value])).toEqual([
      ["technology", 500],
      ["healthcare", 200],
      ["industrials", 100],
      ["unknown", 200],
    ]);
    expect(allocation.byCountry.map((s) => [s.key, s.share])).toEqual([
      ["DE", 0.4],
      ["funds", 0.4],
      ["unknown", 0.2],
    ]);
  });

  it("skips holdings without a value", () => {
    const allocation = computeAllocation([holding(sap, 0)], profiles);
    expect(allocation.totalValue).toBe(0);
    expect(allocation.bySector).toEqual([]);
  });
});
