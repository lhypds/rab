export function formatCoords(latitude, longitude) {
  const lat = `${Math.abs(latitude).toFixed(5)}°${latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(longitude).toFixed(5)}°${longitude >= 0 ? "E" : "W"}`;
  return `${lat} ${lon}`;
}

export function formatUsername(username) {
  return `@${username}`;
}

export const CURRENCIES = ["JPY", "CNY", "USD", "EUR"];

// The currency a new item starts in: yen, whatever language the form is being
// read in, and one select away from being any of the others.
export function defaultCurrency() {
  return "JPY";
}

// A price as its own currency writes it. Whole amounts lose the decimals — a
// tent at ¥1,500 a day is not ¥1,500.00 — and anything with cents keeps both.
export function formatPrice(amount, currency, locale) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
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

// What an item costs, as one line: a day of it, or an hour.
export function priceLine(item, locale, t) {
  const price = formatPrice(item.price, item.currency, locale);
  return item.mode === "time" ? t("item.perHour", { price }) : t("item.perDay", { price });
}

// The same price small enough for a pin or a calendar square: ¥1.5K.
export function compactPrice(amount, currency, locale) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
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
