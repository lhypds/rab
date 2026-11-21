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
export const minutesOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export const clockOf = (total) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

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
  for (const rate of item.rates ?? []) {
    if (applies(rate, day) && (!rate.start || (time >= rate.start && time < rate.end))) price = rate.price;
  }
  return price;
}

// One day's hours cut into the half hours that can be asked for, each with
// what an hour costs then.
export function cellsOn(item, day) {
  const cells = [];
  for (const range of hoursOn(item, day)) {
    for (let at = minutesOf(range.start); at < minutesOf(range.end); at += STEP) {
      const start = clockOf(at);
      cells.push({ start, end: clockOf(at + STEP), price: hourPrice(item, day, start) });
    }
  }
  return cells;
}

// The hours of the week as seven rows of half hours, Sunday first, and back
// again: what the timetable in the item form paints on, and the list of
// stretches it is kept as.
export function weekOf(hours) {
  const week = Array.from({ length: 7 }, () => new Array((24 * 60) / STEP).fill(false));
  for (const range of hours ?? []) {
    for (let day = 0; day < 7; day++) {
      if (range.days && !range.days.includes(day)) continue;
      for (let at = minutesOf(range.start); at < minutesOf(range.end); at += STEP) week[day][at / STEP] = true;
    }
  }
  return week;
}

export function hoursOf(week) {
  // Each day's stretches, then the days that share a stretch put together.
  const byRange = new Map();
  week.forEach((cells, day) => {
    let from = null;
    for (let index = 0; index <= cells.length; index++) {
      if (cells[index] && from === null) from = index;
      if (!cells[index] && from !== null) {
        const key = `${clockOf(from * STEP)}-${clockOf(index * STEP)}`;
        byRange.set(key, [...(byRange.get(key) ?? []), day]);
        from = null;
      }
    }
  });
  return [...byRange.entries()]
    .map(([key, days]) => ({ start: key.slice(0, 5), end: key.slice(6), days: days.length === 7 ? null : days }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

// Whether two stretches of the clock are in each other's way.
export const slotsClash = (a, b) => a.start < b.end && b.start < a.end;

// The figure an item is listed under, from rules that have not been saved yet:
// an ordinary day, or an ordinary hour.
export function listPrice(mode, rates) {
  const price = Number(rates[0]?.price);
  return Number.isFinite(price) ? price : 0;
}
