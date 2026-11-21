// How an item is priced, as a short list of rules its owner writes.
//
// An item is booked one of two ways. By the date: the first rule is what a day
// costs, and every rule after it is what some days cost instead — "weekends
// are 2000". Or by the date and the time: the owner says which hours of which
// days it can be had (see parseHours), the first rule is what an hour costs,
// and every rule after it is what some hours cost instead — "after 18:00 is
// 1500", "Saturdays are 2000". The clock is cut in half hours, which is the
// smallest piece that can be asked for and the piece a price is worked out by.
//
// A day is a plain date and a time is "HH:MM"; both compare correctly as text.

export const MODES = new Set(["day", "time"]);
export const STEP = 30; // minutes in one piece of the clock
const RULES_MAX = 24;
const DATES_MAX = 366;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// A time on the half hour, midnight at the end of the day included.
const TIME_RE = /^([01]\d|2[0-3]):[03]0$|^24:00$/;
const HOURS_MAX = 48;

function readPrice(value, max) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) return null;
  return Math.round(number * 100) / 100;
}

// The days of the week a rule is for, Sunday as 0 — or null where it is for
// all of them, which is also what all seven ticked comes to.
function readWeekdays(value) {
  if (!Array.isArray(value)) return null;
  const days = [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  return days.length === 0 || days.length === 7 ? null : days;
}

// The particular dates a rule is for — "the 24th and the 31st" — or null where
// it names none. Kept as plain dates, in order.
function readDates(value) {
  if (!Array.isArray(value)) return null;
  const dates = [...new Set(value.filter((day) => typeof day === "string" && DAY_RE.test(day)))].sort();
  return dates.length === 0 ? null : dates.slice(0, DATES_MAX);
}

// The rules as sent, checked and tidied — or a sentence about what is wrong.
export function parseRates(mode, value, priceMax) {
  if (!MODES.has(mode)) return { error: "Unknown pricing mode" };
  if (!Array.isArray(value) || value.length === 0) return { error: "Add at least one price" };
  if (value.length > RULES_MAX) return { error: `At most ${RULES_MAX} price rules` };
  const rates = [];
  for (const [index, entry] of value.entries()) {
    const price = readPrice(entry?.price, priceMax);
    if (price === null) return { error: "Every price rule needs a price" };
    // The first rule of a by-the-day item is the price of an ordinary day, so
    // it is for every day whatever it was sent saying.
    const base = index === 0;
    const days = base ? null : readWeekdays(entry?.days);
    const dates = base ? null : readDates(entry?.dates);
    const rate = dates ? { price, days, dates } : { price, days };
    // By the hour, a rule may also be for a stretch of the clock only.
    if (mode === "time" && !base && (entry?.start || entry?.end)) {
      const start = String(entry?.start ?? "");
      const end = String(entry?.end ?? "");
      if (!TIME_RE.test(start) || !TIME_RE.test(end) || start >= end) {
        return { error: "A price rule's hours need a start before their end" };
      }
      rate.start = start;
      rate.end = end;
    }
    if (!base && !days && !dates && !rate.start) return { error: "Pick the days or the hours a special price is for" };
    rates.push(rate);
  }
  return { rates };
}

// The hours an item booked by the time can be had, as sent: a list of
// stretches of the clock, each for every day or for some days of the week.
export function parseHours(value) {
  if (!Array.isArray(value) || value.length === 0) return { error: "Say which hours it can be booked", code: "HOURS_REQUIRED" };
  if (value.length > HOURS_MAX) return { error: `At most ${HOURS_MAX} stretches of hours` };
  const hours = [];
  for (const entry of value) {
    const start = String(entry?.start ?? "");
    const end = String(entry?.end ?? "");
    if (!TIME_RE.test(start) || !TIME_RE.test(end) || start >= end) {
      return { error: "Hours need a start before their end" };
    }
    hours.push({ start, end, days: readWeekdays(entry?.days) });
  }
  hours.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return { hours };
}

// The one figure an item is listed under: an ordinary day, or an ordinary hour.
export function listPrice(mode, rates) {
  return rates[0].price;
}

function weekday(day) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

// Whether a rule is for a day: one that names neither days of the week nor
// dates is for every day; otherwise it is for the dates it lists and the days
// of the week it ticks.
function applies(rate, day) {
  if (!rate.days && !rate.dates?.length) return true;
  return Boolean(rate.dates?.includes(day)) || Boolean(rate.days?.includes(weekday(day)));
}

// What one day of a by-the-day item costs: the last rule that is for that day
// of the week, the first being for all of them.
export function dayPrice(item, day) {
  let price = item.price;
  for (const rate of item.rates) {
    if (applies(rate, day)) price = rate.price;
  }
  return price;
}

const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const clock = (total) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

// The hours one day has, where the item is booked by the time: the stretches
// that are for that day of the week, joined where they touch, earliest first.
export function hoursOn(item, day) {
  const on = (item.hours ?? [])
    .filter((range) => !range.days || range.days.includes(weekday(day)))
    .map(({ start, end }) => ({ start, end }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const joined = [];
  for (const range of on) {
    const last = joined[joined.length - 1];
    if (last && range.start <= last.end) last.end = range.end > last.end ? range.end : last.end;
    else joined.push({ ...range });
  }
  return joined;
}

// What an hour costs at one time of one day: the last rule that is for that
// day and, where it names hours, for that time.
export function hourPrice(item, day, time) {
  let price = item.price;
  for (const rate of item.rates) {
    if (applies(rate, day) && (!rate.start || (time >= rate.start && time < rate.end))) price = rate.price;
  }
  return price;
}

// What a stretch of one day comes to, half an hour at a time — or null where
// it is not on the half hours or not wholly inside the hours the day has.
export function timeQuote(item, day, start, end) {
  if (!TIME_RE.test(String(start)) || !TIME_RE.test(String(end)) || start >= end) return null;
  if (!hoursOn(item, day).some((range) => start >= range.start && end <= range.end)) return null;
  let total = 0;
  for (let at = minutes(start); at < minutes(end); at += STEP) {
    total += (hourPrice(item, day, clock(at)) * STEP) / 60;
  }
  return Math.round(total * 100) / 100;
}
