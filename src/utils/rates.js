// How an item is priced, read on this side of the wire: the same rules the
// server keeps (see server/rates.js), asked the same questions — what does
// this day cost, which hours does this day have, and what does an hour cost.

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

// One day of a by-the-day item: the last rule that is for that day of the week.
export function dayPrice(item, day) {
  let price = item.price;
  for (const rate of item.rates ?? []) {
    if (applies(rate, day)) price = rate.price;
  }
  return price;
}

export const STEP = 30; // minutes in one piece of the clock

// What the item costs right now, where the reader is sitting: today's price
// for one booked by the day — the price the owner gave this one date, where
// they gave it one — and the price of the half hour the clock is in for one
// booked by the time. An item with one rule and nothing else costs the same
// at every moment, and this is then simply its price.
export function priceNow(item, now = new Date()) {
  const pad = (number) => String(number).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (item.mode === "time") {
    return hourPrice(item, day, `${pad(now.getHours())}:${now.getMinutes() < STEP ? "00" : "30"}`);
  }
  return item.dayPrices?.[day] ?? dayPrice(item, day);
}

export const minutesOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const clockOf = (total) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

// Whether the item's rule for days has a date: its day of the week is one of
// the days it can be had (`openDays`, null for every day). What the owner said
// about that one date is the calendar's to answer, not this.
export function openByRule(item, day) {
  return !item.openDays || item.openDays.includes(weekday(day));
}

// The hours one date of an item booked by the date can be picked up and
// brought back in: [{ start, end }], or null where any time will do. The
// usual hours (`dayHours`) are rules — these days of the week, these hours,
// or the whole day where a rule gives none — and a date has every stretch of
// the rules for its day. A date no rule is for (one opened on the calendar)
// can be had at any time. Kept once as one stretch for every day.
export function dayBands(item, day) {
  const kept = item.dayHours;
  if (!kept) return null;
  const rules = Array.isArray(kept) ? kept : [{ days: null, ...kept }];
  const mine = rules.filter((rule) => !rule.days || rule.days.includes(weekday(day)));
  if (mine.length === 0 || mine.some((rule) => !rule.start || !rule.end)) return null;
  return mine.map(({ start, end }) => ({ start, end })).sort((a, b) => (a.start < b.start ? -1 : 1));
}

// Whether a time is inside those stretches.
export const inBands = (bands, time) => !bands || bands.some((band) => time >= band.start && time <= band.end);

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
  for (const rate of item.rates ?? []) {
    if (applies(rate, day) && (!rate.start || (time >= rate.start && time < rate.end))) price = rate.price;
  }
  return price;
}

// The piece of the clock an item booked by the time is asked for in, in
// minutes, as its owner chose (see server/rates.js): half an hour where they
// have not. The hours and the prices are still said on the half hour.
export const UNITS = [10, 15, 20, 30, 60];
export function unitOf(item) {
  return UNITS.includes(Number(item?.unit)) ? Number(item.unit) : STEP;
}

// The shortest stretch one booking may be, in minutes: a whole number of the
// unit it is booked in (see server/rates.js), one unit where it says none.
export function minDurationOf(item) {
  const unit = unitOf(item);
  const asked = Number(item?.minDuration);
  return Number.isFinite(asked) && asked > unit ? Math.ceil(asked / unit) * unit : unit;
}

// The stretch of the clock a price is for, in minutes — "an hour", "ten
// minutes" — said apart from the unit it is booked in. An item that says none
// is priced by its booking unit; one not made yet, by the hour.
export function priceUnitOf(item) {
  if (UNITS.includes(Number(item?.priceUnit))) return Number(item.priceUnit);
  return item?.unit == null ? 60 : unitOf(item);
}

// What the price of an item booked by asking is for: one of the stretches of
// the clock above, or a whole day — which is what it is where none is said.
export const DAY_UNIT = 1440;
export const INQUIRY_UNITS = [...UNITS, DAY_UNIT];
export function inquiryUnitOf(item) {
  return item?.mode === "inquiry" && UNITS.includes(Number(item.priceUnit)) ? Number(item.priceUnit) : DAY_UNIT;
}

// One day's hours cut into the pieces that can be asked for — the item's unit
// long, counted from where each stretch of hours starts — each with the
// price in force then, which is for one stretch of the pricing unit. What is left at the end of a stretch and is shorter than a
// piece cannot be asked for.
export function cellsOn(item, day) {
  const unit = unitOf(item);
  const cells = [];
  for (const range of hoursOn(item, day)) {
    for (let at = minutesOf(range.start); at + unit <= minutesOf(range.end); at += unit) {
      const start = clockOf(at);
      cells.push({ start, end: clockOf(at + unit), price: hourPrice(item, day, start) });
    }
  }
  return cells;
}

// The hours of the week as seven rows of cells, Sunday first, and back again:
// what the timetable in the item form paints on, and the list of stretches it
// is kept as. A cell is `step` minutes — half an hour, or the item's unit
// where that is finer — and is on where the whole of it is inside a stretch,
// so hours once said on a finer grid are read a little short rather than long.
function mark(cells, range, step) {
  const first = Math.ceil(minutesOf(range.start) / step);
  const last = Math.floor(minutesOf(range.end) / step);
  for (let index = first; index < last; index++) cells[index] = true;
}

export function weekOf(hours, step = STEP) {
  const week = Array.from({ length: 7 }, () => new Array((24 * 60) / step).fill(false));
  for (const range of hours ?? []) {
    for (let day = 0; day < 7; day++) {
      if (range.days && !range.days.includes(day)) continue;
      mark(week[day], range, step);
    }
  }
  return week;
}

export function hoursOf(week, step = STEP) {
  // Each day's stretches, then the days that share a stretch put together.
  const byRange = new Map();
  week.forEach((cells, day) => {
    let from = null;
    for (let index = 0; index <= cells.length; index++) {
      if (cells[index] && from === null) from = index;
      if (!cells[index] && from !== null) {
        const key = `${clockOf(from * step)}-${clockOf(index * step)}`;
        byRange.set(key, [...(byRange.get(key) ?? []), day]);
        from = null;
      }
    }
  });
  return [...byRange.entries()]
    .map(([key, days]) => ({ start: key.slice(0, 5), end: key.slice(6), days: days.length === 7 ? null : days }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

// The hours of some dates as rows of cells, one row a date: what the item
// form's timetable paints on when it is showing one week of the calendar.
// `item` is whatever has the hours — { hours, hoursOff, openDays }.
export function hoursOfDates(item, dates, step = STEP) {
  return dates.map((day) => {
    const cells = new Array((24 * 60) / step).fill(false);
    for (const range of hoursOn(item, day)) mark(cells, range, step);
    return cells;
  });
}

// What was painted over some dates, kept: `rows` is what each of `dates` has
// now (see hoursOfDates). A date left as the rules have it keeps nothing of its
// own; one that differs keeps its stretches, and one wiped clean is listed in
// `hoursOff`, since no stretches would otherwise read as "as the rules say".
// Other dates keep what they had. Gives back the item's { hours, hoursOff }.
export function withDatesPainted(item, dates, rows, step = STEP) {
  const rules = (item.hours ?? []).filter((range) => !range.dates);
  const ruled = hoursOfDates({ ...item, hours: rules, hoursOff: [] }, dates, step);
  // The stretches other dates were painted with, gathered by their clock.
  const byRange = new Map();
  const add = (key, day) => byRange.set(key, [...(byRange.get(key) ?? []), day]);
  for (const range of item.hours ?? []) {
    for (const day of range.dates ?? []) if (!dates.includes(day)) add(`${range.start}-${range.end}`, day);
  }
  const off = new Set((item.hoursOff ?? []).filter((day) => !dates.includes(day)));
  rows.forEach((cells, index) => {
    if (cells.every((on, at) => on === ruled[index][at])) return;
    let from = null;
    let any = false;
    for (let at = 0; at <= cells.length; at++) {
      if (cells[at] && from === null) from = at;
      if (!cells[at] && from !== null) {
        add(`${clockOf(from * step)}-${clockOf(at * step)}`, dates[index]);
        any = true;
        from = null;
      }
    }
    if (!any) off.add(dates[index]);
  });
  const painted = [...byRange.entries()]
    .map(([key, days]) => ({ start: key.slice(0, 5), end: key.slice(6), days: null, dates: [...new Set(days)].sort() }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return { hours: [...rules, ...painted], hoursOff: [...off].sort() };
}

// Whether two stretches of the clock are in each other's way.
export const slotsClash = (a, b) => a.start < b.end && b.start < a.end;

// The figure an item is listed under, from rules that have not been saved yet:
// an ordinary day, or an ordinary hour.
export function listPrice(mode, rates) {
  const price = Number(rates[0]?.price);
  return Number.isFinite(price) ? price : 0;
}
