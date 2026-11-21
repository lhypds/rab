// A day is a calendar date and nothing more: "2026-11-19", no clock and no
// zone. Everything here does its arithmetic at UTC midnight, which is only a
// way of counting — the strings that go in and come out are plain dates.

const DAY_MS = 86_400_000;

const pad = (number) => String(number).padStart(2, "0");

export function toDay(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Today where the reader is sitting.
export function today() {
  return toDay(new Date());
}

function utc(day) {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDays(day, count) {
  return new Date(utc(day) + count * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(start, end) {
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

export function countDays(start, end) {
  return Math.round((utc(end) - utc(start)) / DAY_MS) + 1;
}

// "2026-11" for any day in it, and the month either side of one.
export const monthOf = (day) => day.slice(0, 7);

export function addMonths(month, count) {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}

// The squares of one month's page: six weeks of seven, Sunday first, with null
// where a square belongs to the month before or after.
export function monthGrid(month) {
  const [year, index] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, index - 1, 1));
  const length = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const cells = Array.from({ length: 42 }, () => null);
  for (let date = 1; date <= length; date++) {
    cells[first.getUTCDay() + date - 1] = `${month}-${pad(date)}`;
  }
  // A month that fits in five weeks does not need the sixth row drawn.
  return cells.slice(35).some(Boolean) ? cells : cells.slice(0, 35);
}

export function formatDay(day, locale, options = { month: "short", day: "numeric" }) {
  return new Date(utc(day)).toLocaleDateString(locale, { ...options, timeZone: "UTC" });
}

export function formatRange(start, end, locale) {
  const sameYear = start.slice(0, 4) === today().slice(0, 4) && end.slice(0, 4) === start.slice(0, 4);
  const options = sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" };
  if (start === end) return formatDay(start, locale, options);
  return `${formatDay(start, locale, options)} – ${formatDay(end, locale, options)}`;
}

export function formatMonth(month, locale) {
  return formatDay(`${month}-01`, locale, { year: "numeric", month: "long" });
}

// The seven column headings, Sunday first, in the reader's language.
export function weekdayNames(locale) {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, index) =>
    formatDay(`2023-01-0${index + 1}`, locale, { weekday: "narrow" }),
  );
}
