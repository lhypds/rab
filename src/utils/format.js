import { DAY_UNIT, inquiryUnitOf, priceNow, priceUnitOf } from "./rates.js";

export function formatCoords(latitude, longitude) {
  const lat = `${Math.abs(latitude).toFixed(5)}°${latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(longitude).toFixed(5)}°${longitude >= 0 ? "E" : "W"}`;
  return `${lat} ${lon}`;
}

export function formatUsername(username) {
  return `@${username}`;
}

export const CURRENCIES = ["JPY", "CNY", "USD", "EUR"];

// The currency a new item starts in: the one the language the form is being
// read in is most likely to be paid in — yen in Japanese, yuan in Chinese,
// dollars in English — and one select away from being any of the others.
const CURRENCY_BY_LANGUAGE = { ja: "JPY", zh: "CNY", en: "USD" };
export function defaultCurrency(language) {
  return CURRENCY_BY_LANGUAGE[String(language ?? "").toLowerCase().split("-")[0]] ?? "USD";
}

// The mark a currency is written with, on its own: ¥ for yen and for yuan, $,
// €. The code itself where the browser knows no mark for it.
export function currencySymbol(currency, locale) {
  try {
    const parts = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

// A price as its own currency writes it. Whole amounts lose the decimals — a
// tent at ¥1,500 a day is not ¥1,500.00 — and anything with cents keeps both.
export function formatPrice(amount, currency, locale) {
  const value = Number(amount);
  if (amount == null || amount === "" || !Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

// The piece of the clock an item is booked and priced in, as words: "30 min",
// "1 hour".
export function unitName(unit, t) {
  if (unit === DAY_UNIT) return t("item.unitDay");
  return unit === 60 ? t("item.unitHour") : t("item.unitMinutes", { count: unit });
}

// What an item costs, as one line: a day of it, or one stretch of its pricing unit —
// today's day and this time of it, where its price is not the same all the time.
export function priceLine(item, locale, t) {
  // A page (a store) has no price of its own: each item on it has its own.
  if (item.store) return "";
  // One that says no price is asked about, however it is booked.
  const now = priceNow(item);
  if (now == null) return t("item.priceOnRequest");
  const price = formatPrice(now, item.currency, locale);
  // Booked by asking, the price is for whatever its owner said it is for.
  if (item.mode === "inquiry" && inquiryUnitOf(item) !== DAY_UNIT) {
    return t("item.perHour", { price, unit: unitName(inquiryUnitOf(item), t) });
  }
  return item.mode === "time" ? t("item.perHour", { price, unit: unitName(priceUnitOf(item), t) }) : t("item.perDay", { price });
}

// A price written out in full and to the whole unit — ¥12,500, never ¥1.3万
// and never ¥12,500.50: what is said of a price when it is asked about.
export function wholePrice(amount, currency, locale) {
  const value = Number(amount);
  if (amount == null || amount === "" || !Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return String(Math.round(value));
  }
}

// The same price small enough for a pin or a calendar square: ¥1.5K.
export function compactPrice(amount, currency, locale) {
  const value = Number(amount);
  if (amount == null || amount === "" || !Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      notation: value >= 10000 ? "compact" : "standard",
      minimumFractionDigits: 0,
      maximumFractionDigits: value >= 10000 ? 1 : Number.isInteger(value) ? 0 : 2,
    }).format(value);
  } catch {
    return String(value);
  }
}

export function relativeTime(iso, locale, t) {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 60) return t("time.justNow");
  const units = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
  ];
  let chosen = units[0];
  for (const unit of units) {
    if (seconds >= unit[1]) chosen = unit;
  }
  if (seconds >= 604800) return new Date(time).toLocaleDateString(locale);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return formatter.format(-Math.floor(seconds / chosen[1]), chosen[0]);
}

export function formatDate(iso, locale) {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  return new Date(time).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

// A phone number as it is typed, kept and shown: its digits and nothing
// between them — a + at the front, where there is one, and no hyphens, spaces
// or brackets. Where a number's groups are differs from country to country,
// so none are marked.
export function barePhone(value) {
  const typed = String(value ?? "").trim();
  return (typed.startsWith("+") ? "+" : "") + typed.replace(/\D/g, "");
}
