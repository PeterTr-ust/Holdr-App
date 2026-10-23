/**
 * Renders its children only if the current edition includes the feature;
 * otherwise explains that the feature is part of Holdr Pro.
 *
 *   <ProGate feature="multiplePortfolios">…premium UI…</ProGate>
 */
import type { ReactNode } from "react";
import { hasFeature, type PremiumFeature } from "../domain/license";
import { useI18n } from "../i18n";
import { useApp } from "../state/AppState";

export function ProGate({ feature, children }: { feature: PremiumFeature; children: ReactNode }) {
  const allowed = useFeature(feature);
  const { t } = useI18n();
  if (allowed) return <>{children}</>;
  return (
    <div className="pro-gate" role="note">
      <strong>{t("pro.gateTitle")}</strong>
      <p>{t("pro.gateText")}</p>
    </div>
  );
}

/** Whether the current edition includes the feature, e.g. to hide a menu entry. */
export function useFeature(feature: PremiumFeature): boolean {
  return hasFeature(useApp().entitlement, feature);
}
