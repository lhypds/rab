// How an item is priced, as a short list of rules its owner writes.
//
// An item is booked one of two ways. By the date: the first rule is what a day
// costs, and every rule after it is what some days cost instead — "weekends
// are 2000". Or by the date and the time: the owner says which hours of which
// days it can be had (see parseHours), the first rule is what one stretch of
// the item's pricing unit costs (see readPriceUnit) — ten minutes, an hour —
// and every rule after it is what that costs at some hours instead — "after 18:00 is
// 1500", "Saturdays are 2000". The clock is cut in half hours, which is the
// smallest piece that can be asked for and the piece a price is worked out by.
//
// A day is a plain date and a time is "HH:MM"; both compare correctly as text.

// A third way has no booking in it at all: by asking. The item says how its
// owner is reached (see readContacts) and the two sides arrange it themselves;
// its price is read as a day's, the way a by-the-date item's is.
export const MODES = new Set(["day", "time", "inquiry"]);
// "message" is a message here on rab, to the owner's account: a way with
// nothing written for it.
export const CONTACT_TYPES = new Set(["phone", "email", "address", "message"]);
const CONTACT_MAX = 200;
const CONTACTS_MAX = 5;
const DIAL_CODE_RE = /^\+\d{1,4}$/;

// How the owner of an item booked by asking is reached: the first way, the
// second, the third and so on — [{ type, value }], a way with nothing
// written in it left out.
export function readContacts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, CONTACTS_MAX)
    .map((entry) => {
      const type = CONTACT_TYPES.has(entry?.type) ? entry.type : "phone";
      if (type === "message") return { type, value: "" };
      const written = String(entry?.value ?? "").replace(/\s+/g, " ").trim();
      if (type !== "phone") return { type, value: written.slice(0, CONTACT_MAX) };
      // A phone number is kept as its digits, and shown that way: where its
      // groups are differs by country. The code it is dialled with from
      // abroad is kept beside it (`code`, "+81"), the number as it is dialled
      // at home. One sent without a code — from before a code was asked for
      // — keeps a + in front of its digits where it was written with one.
      const digits = written.replace(/\D/g, "").slice(0, CONTACT_MAX);
      const code = DIAL_CODE_RE.test(String(entry?.code ?? "")) ? String(entry.code) : null;
      if (code) return { type, code, value: digits };
      return { type, value: (written.startsWith("+") ? "+" : "") + digits };
    })
    // A message is said once, and is a way with nothing written in it.
    .filter((entry, index, all) => (entry.type === "message" ? all.findIndex((each) => each.type === "message") === index : entry.value));
}
export const STEP = 30; // minutes in one piece of the clock
// Enough for a price on single stretches of single dates, which the form
// writes as one rule for each stretch and price (see the item form).
const RULES_MAX = 200;
const DATES_MAX = 366;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// A time on a five-minute mark — which every unit an item can be booked in
// falls on — midnight at the end of the day included.
const TIME_RE = /^([01]\d|2[0-3]):[0-5][05]$|^24:00$/;
const HOURS_MAX = 400;

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

// When somebody who has a confirmed booking may still call it off, as the
// owner says: any time ("any"), not at all ("none"), or up to some time before
// it starts — so many days ("days", with how many) or so many hours ("hours").
// Any time, where nothing is said.
const CANCEL_DAYS_MAX = 365;
const CANCEL_HOURS_MAX = 999;
export function readCancel(value) {
  if (value?.mode === "none") return { mode: "none" };
  if (value?.mode === "days") {
    const days = Math.round(Number(value.days));
    if (Number.isFinite(days) && days >= 1) return { mode: "days", days: Math.min(days, CANCEL_DAYS_MAX) };
  }
  if (value?.mode === "hours") {
    const hours = Math.round(Number(value.hours));
    if (Number.isFinite(hours) && hours >= 1) return { mode: "hours", hours: Math.min(hours, CANCEL_HOURS_MAX) };
  }
  return { mode: "any" };
}

// The days of the week an item can be had at all — its rule for days, "Monday
// to Friday" — or null where it is every day.
export const readOpenDays = readWeekdays;

// The usual hours an item booked by the date can be picked up and brought
// back in, as rules: [{ days, start, end }] — the days of the week (null for
// all of them), and the hours, or null for both where it is the whole day.
// Null where no rule says any hours, and any time of day will do. One stretch
// sent the way it once was, { start, end }, is that stretch every day.
const DAY_RULES_MAX = 12;
export function readDayHours(value) {
  const list = Array.isArray(value) ? value : value ? [{ days: null, ...value }] : [];
  const rules = [];
  for (const rule of list.slice(0, DAY_RULES_MAX)) {
    const days = readWeekdays(rule?.days);
    if (Array.isArray(rule?.days) && rule.days.length === 0) continue;
    const start = String(rule?.start ?? "");
    const end = String(rule?.end ?? "");
    if (!start && !end) rules.push({ days, start: null, end: null });
    else if (TIME_RE.test(start) && TIME_RE.test(end) && start < end) rules.push({ days, start, end });
  }
  return rules.some((rule) => rule.start) ? rules : null;
}

// The hours one date can be picked up and brought back in: [{ start, end }],
// or null where any time will do — every stretch of the rules for its day of
// the week, and any time on a date no rule is for, or one a rule gives the
// whole of.
export function dayBands(item, day) {
  const kept = item.dayHours;
  if (!kept) return null;
  const rules = Array.isArray(kept) ? kept : [{ days: null, ...kept }];
  const mine = rules.filter((rule) => !rule.days || rule.days.includes(weekday(day)));
  if (mine.length === 0 || mine.some((rule) => !rule.start || !rule.end)) return null;
  return mine.map(({ start, end }) => ({ start, end }));
}

// A plain list of dates, in order; empty where none are named.
export const readDayList = (value) => readDates(value) ?? [];

// Whether the item's rule for days has a date: its day of the week is one of
// the days it can be had. What the owner has said about that one date — closed
// it, or opened it though the rule leaves it out — is asked of the calendar's
// own entries, not here.
export function openByRule(item, day) {
  return !item.openDays || item.openDays.includes(weekday(day));
}

// The hours an item booked by the time can be had, as sent: a list of
// stretches of the clock. One that names no dates is a rule — those hours,
// every day or on some days of the week. One that names dates is what the
// owner painted for those dates in particular, in place of the rules.
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
    const dates = readDates(entry?.dates);
    hours.push(dates ? { start, end, days: null, dates } : { start, end, days: readWeekdays(entry?.days) });
  }
  hours.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return { hours };
}

// The piece of the clock an item booked by the time is asked for in — ten
// minutes, a quarter of an hour, half an hour or an hour — as its owner chose.
// Half an hour where they have not, which is what it was before there was a
// choice. The hours it can be had and the hours a price is for are still said
// on the half hour; this is only how finely they are cut for booking.
export const UNITS = [10, 15, 20, 30, 60];
export function readUnit(value) {
  const unit = Number(value);
  return UNITS.includes(unit) ? unit : STEP;
}

// The shortest stretch one booking may be, in minutes: a whole number of the
// unit it is booked in, one unit where nothing is said, a day at most.
export function readMinDuration(value, unit) {
  const asked = Number(value);
  if (!Number.isFinite(asked) || asked <= unit) return unit;
  return Math.min(Math.floor(1440 / unit) * unit, Math.ceil(asked / unit) * unit);
}

// The stretch of the clock a price is for — "1000 an hour", "300 for ten
// minutes" — which is the owner's to say apart from the unit it is booked in:
// a thing priced by the hour can still be booked by the quarter. An item
// that says none is priced by its booking unit.
export function readPriceUnit(item) {
  const per = Number(item?.priceUnit);
  return UNITS.includes(per) ? per : readUnit(item?.unit);
}

// What the price of an item booked by asking is for: one of the stretches of
// the clock above, or a whole day — which is what it is where none is said.
export const DAY_UNIT = 1440;
export function readInquiryUnit(value) {
  const per = Number(value);
  return UNITS.includes(per) ? per : DAY_UNIT;
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

// The hours one day has, where the item is booked by the time, joined where
// they touch, earliest first. A date the owner painted has what was painted,
// and one they wiped (`hoursOff`) has none; any other date has what the rules
// give its day of the week, where the rule for days has it at all.
export function hoursOn(item, day) {
  if (item.hoursOff?.includes(day)) return [];
  const all = item.hours ?? [];
  const painted = all.filter((range) => range.dates?.includes(day));
  const ruled = openByRule(item, day)
    ? all.filter((range) => !range.dates && (!range.days || range.days.includes(weekday(day))))
    : [];
  const on = (painted.length > 0 ? painted : ruled)
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

// What one stretch of the item's pricing unit costs at one time of one day:
// the last rule that is for that day and, where it names hours, for that time.
export function hourPrice(item, day, time) {
  let price = item.price;
  for (const rate of item.rates) {
    if (applies(rate, day) && (!rate.start || (time >= rate.start && time < rate.end))) price = rate.price;
  }
  return price;
}

// An amount brought to the smallest coin its currency has — none after the
// point for the yen, two for the dollar.
export function roundPrice(amount, currency) {
  let digits = 2;
  try {
    digits = Math.min(2, new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits);
  } catch {
    // An unknown currency is counted in hundredths.
  }
  const scale = 10 ** digits;
  return Math.round(Number(amount) * scale) / scale;
}

// Any minute of the day, midnight at its end included.
const MINUTE_RE = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

// What a stretch of one day comes to, one piece of the item's unit at a time —
// or null where it is not wholly inside the hours the day has, or not cut
// where the unit cuts them: a whole number of pieces, counted from where that
// stretch of hours starts.
// Whether the stretch asked for is shorter than the item lets one booking be.
export function tooShort(item, start, end) {
  return minutes(end) - minutes(start) < readMinDuration(item.minDuration, readUnit(item.unit));
}

export function timeQuote(item, day, start, end) {
  if (!MINUTE_RE.test(String(start)) || !MINUTE_RE.test(String(end)) || start >= end) return null;
  const range = hoursOn(item, day).find((each) => start >= each.start && end <= each.end);
  if (!range) return null;
  const unit = readUnit(item.unit);
  if ((minutes(start) - minutes(range.start)) % unit !== 0 || (minutes(end) - minutes(start)) % unit !== 0) return null;
  // A price is for one stretch of the pricing unit, and each piece asked for
  // costs its share of that.
  const per = readPriceUnit(item);
  let total = 0;
  for (let at = minutes(start); at < minutes(end); at += unit) {
    total += (hourPrice(item, day, clock(at)) * unit) / per;
  }
  return Math.round(total * 100) / 100;
}
