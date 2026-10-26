/**
 * Descriptive data about instruments (sector, country, upcoming dates) and
 * the diversification of the portfolio derived from it.
 *
 * Sectors and countries are stored as provider-independent codes, so a
 * different market data provider only has to map its own labels to them.
 */
import type { HoldingView } from "./valuation";

/** The eleven sectors used by most data providers (Morningstar/GICS style). */
export const SECTORS = [
  "basicMaterials",
  "communicationServices",
  "consumerCyclical",
  "consumerDefensive",
  "energy",
  "financialServices",
  "healthcare",
  "industrials",
  "realEstate",
  "technology",
  "utilities",
] as const;
export type Sector = (typeof SECTORS)[number];

export interface InstrumentProfile {
  sector: Sector | null;
  /** Provider's industry label, e.g. "Software—Application"; shown as is. */
  industry: string | null;
  /** ISO 3166 country code of the company's headquarters, e.g. "DE". */
  country: string | null;
  /** For funds: share of each sector, between 0 and 1. */
  sectorWeights: Partial<Record<Sector, number>> | null;
}

/** Next known dates of an instrument. All dates are ISO (YYYY-MM-DD) or null. */
export interface UpcomingEvents {
  exDividendDate: string | null;
  dividendPaymentDate: string | null;
  earningsDate: string | null;
  /** True if the earnings date is the provider's estimate, not confirmed by the company. */
  earningsDateEstimated: boolean;
}

/** A sector, an ISO country code, "funds" (not broken down) or "unknown". */
export type AllocationKey = string;

export interface AllocationSlice {
  key: AllocationKey;
  /** Market value in display currency. */
  value: number;
  /** Share of the total, between 0 and 1. */
  share: number;
}

export interface Allocation {
  bySector: AllocationSlice[];
  byCountry: AllocationSlice[];
  /** Market value that has a profile; less than the total while profiles are loading. */
  coveredValue: number;
  totalValue: number;
}

const FUND_KINDS = new Set(["ETF", "MUTUALFUND"]);

/**
 * Splits the current market value by sector and by country. Funds are spread
 * over their sector weights when the provider reports them; for countries
 * they form a group of their own, as their holdings span many countries.
 */
export function computeAllocation(
  holdings: readonly HoldingView[],
  profiles: ReadonlyMap<string, InstrumentProfile>,
): Allocation {
  const sectors = new Map<AllocationKey, number>();
  const countries = new Map<AllocationKey, number>();
  const add = (map: Map<AllocationKey, number>, key: AllocationKey, value: number) =>
    map.set(key, (map.get(key) ?? 0) + value);
  let totalValue = 0;
  let coveredValue = 0;

  for (const holding of holdings) {
    const value = holding.marketValue;
    if (value === null || value <= 0) continue;
    totalValue += value;
    const { instrument } = holding.position;
    const profile = profiles.get(instrument.symbol);
    if (profile) coveredValue += value;
    const isFund = FUND_KINDS.has(instrument.kind ?? "");

    const weights = profile?.sectorWeights ? normalizedWeights(profile.sectorWeights) : null;
    if (weights) {
      for (const [sector, weight] of weights) add(sectors, sector, value * weight);
    } else {
      add(sectors, profile?.sector ?? (isFund ? "funds" : "unknown"), value);
    }
    add(countries, isFund ? "funds" : (profile?.country ?? "unknown"), value);
  }

  return {
    bySector: toSlices(sectors, totalValue),
    byCountry: toSlices(countries, totalValue),
    coveredValue,
    totalValue,
  };
}

/** Weights scaled to add up to 1; funds often report a few percent of cash or "other". */
function normalizedWeights(weights: Partial<Record<Sector, number>>): [Sector, number][] | null {
  const entries = Object.entries(weights).filter(([, w]) => w !== undefined && w > 0) as [
    Sector,
    number,
  ][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  return total > 0 ? entries.map(([sector, w]) => [sector, w / total]) : null;
}

/** Largest first; the catch-all groups go last. */
function toSlices(values: Map<AllocationKey, number>, total: number): AllocationSlice[] {
  const rank = (key: AllocationKey) => (key === "unknown" ? 2 : key === "funds" ? 1 : 0);
  return [...values.entries()]
    .map(([key, value]) => ({ key, value, share: total > 0 ? value / total : 0 }))
    .sort((a, b) => rank(a.key) - rank(b.key) || b.value - a.value);
}

// ---------------------------------------------------------------------------
// Label normalization, shared by providers
// ---------------------------------------------------------------------------

const SECTOR_BY_COMPACT_LABEL = new Map<string, Sector>([
  ...SECTORS.map((sector) => [sector.toLowerCase(), sector] as [string, Sector]),
  ["materials", "basicMaterials"],
  ["communication", "communicationServices"],
  ["telecommunications", "communicationServices"],
  ["consumerdiscretionary", "consumerCyclical"],
  ["consumerstaples", "consumerDefensive"],
  ["financials", "financialServices"],
  ["financial", "financialServices"],
  ["informationtechnology", "technology"],
  ["health", "healthcare"],
]);

/**
 * Maps a provider's sector label to a sector, ignoring case, spaces and
 * punctuation: "Financial Services", "financial_services" and
 * "FINANCIAL SERVICES" all become "financialServices".
 */
export function sectorFromLabel(label: string | null | undefined): Sector | null {
  if (!label) return null;
  return SECTOR_BY_COMPACT_LABEL.get(label.toLowerCase().replace(/[^a-z]/g, "")) ?? null;
}

/** Names some providers use that differ from the Unicode CLDR English names. */
const COUNTRY_ALIASES: Record<string, string> = {
  "hong kong": "HK",
  macau: "MO",
  "united states of america": "US",
  usa: "US",
  "south korea": "KR",
  "korea, republic of": "KR",
  russia: "RU",
  "czech republic": "CZ",
  turkey: "TR",
  curacao: "CW",
};

let countryCodesByName: Map<string, string> | null = null;

/** Maps an English country name (e.g. "Germany") to its ISO code ("DE"), or null. */
export function countryCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(needle)) return needle.toUpperCase();
  if (needle in COUNTRY_ALIASES) return COUNTRY_ALIASES[needle]!;
  countryCodesByName ??= buildCountryIndex();
  return countryCodesByName.get(needle) ?? null;
}

function buildCountryIndex(): Map<string, string> {
  const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  const index = new Map<string, string>();
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const first of letters) {
    for (const second of letters) {
      const code = first + second;
      const name = names.of(code);
      if (name) index.set(name.toLowerCase(), code);
    }
  }
  return index;
}
