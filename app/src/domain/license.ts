/**
 * Plans and feature gating.
 *
 * Holdr Free contains the base features. Premium features are unlocked by a
 * license key: a one-time purchase ("lifetime") or a subscription, whose key
 * carries an expiry date and is replaced by a new key on renewal. The key's
 * signature is verified by the desktop shell; this module only applies the
 * rules on top of a verified license.
 *
 * ⚠️ No paid edition may be sold while Yahoo Finance is the market data source:
 * Yahoo's terms do not permit commercial use.
 */

/** Contents of a verified license key. */
export interface License {
  id: string;
  licensee: string;
  plan: "lifetime" | "subscription";
  /** ISO date (YYYY-MM-DD). */
  issuedAt: string;
  /** Last valid day (YYYY-MM-DD) for subscriptions, null for lifetime licenses. */
  expiresAt: string | null;
}

export type Edition = "free" | "pro";

export type Entitlement =
  | { edition: "free"; status: "none" }
  | { edition: "free"; status: "expired"; license: License }
  | { edition: "pro"; status: "active"; license: License };

/**
 * Premium features and the edition they require. Base features (one
 * portfolio, positions, statistics, watchlist, backup) are always free and
 * therefore not listed. Add new paid features here and wrap their UI in
 * <ProGate feature="...">.
 */
export const PREMIUM_FEATURES = {
  /** More than one portfolio (the free edition has exactly one). */
  multiplePortfolios: "pro",
} as const satisfies Record<string, Edition>;

export type PremiumFeature = keyof typeof PREMIUM_FEATURES;

/** Evaluates a verified license on the given day (YYYY-MM-DD, local time). */
export function entitlementFor(license: License | null, today: string): Entitlement {
  if (!license) return { edition: "free", status: "none" };
  if (license.plan === "subscription" && (!license.expiresAt || license.expiresAt < today)) {
    return { edition: "free", status: "expired", license };
  }
  return { edition: "pro", status: "active", license };
}

const EDITION_RANK: Record<Edition, number> = { free: 0, pro: 1 };

export function hasFeature(entitlement: Entitlement, feature: PremiumFeature): boolean {
  const required: Edition = PREMIUM_FEATURES[feature];
  return EDITION_RANK[entitlement.edition] >= EDITION_RANK[required];
}

/** Reasons a key can be rejected, as reported by the verifier. */
export type LicenseErrorCode = "notConfigured" | "malformed" | "invalidSignature";

export class LicenseError extends Error {
  constructor(readonly code: LicenseErrorCode) {
    super(`License key rejected: ${code}`);
    this.name = "LicenseError";
  }
}

export function toLicenseErrorCode(value: unknown): LicenseErrorCode {
  return value === "notConfigured" || value === "invalidSignature" ? value : "malformed";
}
