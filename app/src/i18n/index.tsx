/**
 * Minimal internationalization: typed message keys, placeholder
 * interpolation and locale-aware number/date formatting.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CurrencyCode, Settings } from "../domain/types";
import { de } from "./de";
import { en } from "./en";

export type Language = Settings["language"];
export type MessageKey = keyof typeof de;
export type Messages = Record<MessageKey, string>;

const MESSAGES: Record<Language, Messages> = { de, en };
const LOCALES: Record<Language, string> = { de: "de-DE", en: "en-US" };

export interface I18n {
  language: Language;
  t(key: MessageKey, params?: Record<string, string | number>): string;
  /** Formats an amount of money, e.g. "1.234,56 €". `signed` adds an explicit "+". */
  money(amount: number | null, currency: CurrencyCode, options?: { signed?: boolean }): string;
  /** Formats a ratio as percent, e.g. 0.123 → "12,30 %". */
  percent(ratio: number | null, options?: { signed?: boolean }): string;
  /** Formats a share count; fractional shares keep up to six decimals. */
  quantity(value: number): string;
  /** Formats an ISO date (YYYY-MM-DD) for display. */
  date(isoDate: string): string;
  /** Formats an ISO timestamp as time of day, or date and time if not today. */
  timestamp(iso: string): string;
  /** Formats an ISO timestamp as full date and time. */
  dateTime(iso: string): string;
  /** Name of a country from its ISO code, e.g. "DE" → "Deutschland". */
  country(code: string): string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const value = useMemo(() => createI18n(language), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside <I18nProvider>.");
  return context;
}

export function createI18n(language: Language): I18n {
  const messages = MESSAGES[language];
  const locale = LOCALES[language];
  const moneyFormats = new Map<string, Intl.NumberFormat>();
  const percentFormat = new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const quantityFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const timeFormat = new Intl.DateTimeFormat(locale, { timeStyle: "short" });
  const dateTimeFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  });
  const regionNames = new Intl.DisplayNames([locale], { type: "region" });

  const moneyFormat = (currency: CurrencyCode): Intl.NumberFormat => {
    let format = moneyFormats.get(currency);
    if (!format) {
      format = new Intl.NumberFormat(locale, { style: "currency", currency });
      moneyFormats.set(currency, format);
    }
    return format;
  };

  const withSign = (value: number, text: string, signed?: boolean) =>
    signed && value > 0 ? `+${text}` : text;

  return {
    language,
    t(key, params) {
      const template = messages[key];
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      );
    },
    money(amount, currency, options) {
      if (amount === null || !Number.isFinite(amount)) return messages["common.notAvailable"];
      return withSign(amount, moneyFormat(currency).format(amount), options?.signed);
    },
    percent(ratio, options) {
      if (ratio === null || !Number.isFinite(ratio)) return messages["common.notAvailable"];
      return withSign(ratio, percentFormat.format(ratio), options?.signed);
    },
    quantity: (value) => quantityFormat.format(value),
    date: (isoDate) => dateFormat.format(new Date(`${isoDate}T00:00:00Z`)),
    timestamp(iso) {
      const date = new Date(iso);
      const isToday = date.toDateString() === new Date().toDateString();
      return (isToday ? timeFormat : dateTimeFormat).format(date);
    },
    dateTime: (iso) => dateTimeFormat.format(new Date(iso)),
    country: (code) => regionNames.of(code) ?? code,
  };
}
