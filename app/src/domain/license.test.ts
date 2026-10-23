import { describe, expect, it } from "vitest";
import { entitlementFor, hasFeature, type License } from "./license";

const lifetime: License = {
  id: "1",
  licensee: "Erika Muster",
  plan: "lifetime",
  issuedAt: "2026-10-22",
  expiresAt: null,
};
const subscription: License = { ...lifetime, plan: "subscription", expiresAt: "2027-10-31" };

describe("entitlementFor", () => {
  it("is free without a license", () => {
    const entitlement = entitlementFor(null, "2026-10-22");
    expect(entitlement).toEqual({ edition: "free", status: "none" });
    expect(hasFeature(entitlement, "multiplePortfolios")).toBe(false);
  });

  it("unlocks pro forever with a lifetime license", () => {
    const entitlement = entitlementFor(lifetime, "2099-01-01");
    expect(entitlement.edition).toBe("pro");
    expect(hasFeature(entitlement, "multiplePortfolios")).toBe(true);
  });

  it("keeps a subscription active up to and including its last day", () => {
    expect(entitlementFor(subscription, "2027-10-31").edition).toBe("pro");
    expect(entitlementFor(subscription, "2027-11-01")).toEqual({
      edition: "free",
      status: "expired",
      license: subscription,
    });
  });

  it("treats a subscription without expiry date as expired", () => {
    expect(entitlementFor({ ...subscription, expiresAt: null }, "2026-10-22").edition).toBe("free");
  });
});
