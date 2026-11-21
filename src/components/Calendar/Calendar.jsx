import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { addMonths, daysBetween, formatMonth, monthGrid, monthOf, today, weekdayNames } from "../../utils/days.js";
import { compactPrice } from "../../utils/format.js";
import { cellsOn, dayPrice, slotsClash } from "../../utils/rates.js";
import styles from "./calendar.module.css";

// What is known about every day the calendar reaches, worked out once from the
// three things the server sends: the owner's exceptions, what is already
// taken, and — for the two people a rental is between — the requests still
// waiting on an answer.
//
// A booking counted in days takes its days whole. One counted in hours takes
// only its hours, so those are kept as a list for the day rather than as a
// yes or no (see slotStates).
export function dayStates(calendar, bookings = []) {
  const states = new Map();
  const at = (day) => {
    if (!states.has(day)) states.set(day, {});
    return states.get(day);
  };
  const mark = (range, whole, list) => {
    for (const day of daysBetween(range.start, range.end)) {
      const state = at(day);
      if (range.slots?.length) (state[list] ??= []).push(...range.slots);
      else state[whole] = true;
    }
  };
  for (const row of calendar?.days ?? []) {
    const state = at(row.day);
    if (!row.available) state.closed = true;
    if (row.price != null) state.price = row.price;
  }
  for (const range of calendar?.taken ?? []) mark(range, "taken", "takenSlots");
  for (const booking of bookings) {
    if (booking.status === "pending") mark(booking, "pending", "pendingSlots");
  }
  return states;
}

// The half hours one day has, each with what an hour costs then, whether it is
// already somebody's and whether somebody has asked for it.
export function slotStates(item, states, day) {
  const state = states.get(day) ?? {};
  return cellsOn(item, day).map((slot) => ({
    ...slot,
    taken: Boolean(state.taken) || (state.takenSlots ?? []).some((other) => slotsClash(slot, other)),
    pending: Boolean(state.pending) || (state.pendingSlots ?? []).some((other) => slotsClash(slot, other)),
  }));
}

// What a day comes to for somebody looking at it: whether anything of it can
// still be had, and the figure to put on its square.
function reading(item, states, calendar, day) {
  const state = states.get(day) ?? {};
  const outside = day < today() || day > calendar.until;
  if (item.mode === "time") {
    const slots = slotStates(item, states, day);
    const free = slots.filter((slot) => !slot.taken);
    return {
      outside,
      closed: Boolean(state.closed) || slots.length === 0,
      taken: slots.length > 0 && free.length === 0,
      pending: slots.some((slot) => slot.pending && !slot.taken),
      price: free.length > 0 ? Math.min(...free.map((slot) => slot.price)) : null,
      own: false,
    };
  }
  return {
    outside,
    closed: Boolean(state.closed),
    taken: Boolean(state.taken),
    pending: Boolean(state.pending),
    price: state.price ?? dayPrice(item, day),
    own: state.price != null,
  };
}

const open = (day) => !day.outside && !day.closed && !day.taken;

// What a stretch of days comes to, or null where any of them cannot be had.
// For an item booked by the date; one booked by the time is the sum of the
// half hours picked, which the page adds up itself.
export function quote(item, calendar, bookings, selection) {
  if (!selection || !calendar || !item) return null;
  const states = dayStates(calendar, bookings);
  const days = daysBetween(selection.start, selection.end).map((day) => reading(item, states, calendar, day));
  if (!days.every(open)) return null;
  const total = days.reduce((sum, day) => sum + day.price, 0);
  return { days: days.length, total: Math.round(total * 100) / 100 };
}

// One month of an item's days: which can be had, which are taken, what each
// costs. It is pressed in one of three ways, and which one says who is
// pressing:
//
// - `onSelect`, by somebody renting: a day starts a stretch and a later day
//   ends it — or, where the item goes by the time, one day is the whole of it.
// - `onSelect` with `editing`, by the owner on the item's page: the same
//   stretch, but over any day ahead, closed ones included, since what is being
//   chosen is which days to change.
// - `onToggle`, by the owner in the item form: every press is its own answer,
//   a day closed or opened again — or, with `marked`, a day ticked or unticked
//   for whatever the form is collecting dates for.
export default function Calendar({
  item,
  calendar,
  bookings = [],
  selection = null,
  onSelect,
  onToggle,
  editing = false,
  marked = null,
}) {
  const { t, i18n } = useTranslation();
  const now = today();
  const firstMonth = monthOf(now);
  const lastMonth = monthOf(calendar.until);
  const [month, setMonth] = useState(firstMonth);
  const states = useMemo(() => dayStates(calendar, bookings), [calendar, bookings]);
  const cells = useMemo(() => monthGrid(month), [month]);
  const names = useMemo(() => weekdayNames(i18n.language), [i18n.language]);
  const read = (day) => reading(item, states, calendar, day);
  const owner = editing || Boolean(onToggle);

  function pressable(day, state) {
    if (state.outside || (!onSelect && !onToggle)) return false;
    return owner || open(state);
  }

  function press(day) {
    if (onToggle) return onToggle(day);
    // By the time, a rental is within one day, so a press is the whole choice.
    if (item.mode === "time" && !editing) {
      return onSelect(selection?.start === day ? null : { start: day, end: day });
    }
    // Nothing chosen, a stretch already finished, or a day before the one the
    // stretch starts on: the press starts a new one here.
    if (!selection || selection.start !== selection.end || day < selection.start) {
      return onSelect({ start: day, end: day });
    }
    // The same day twice lets go of it.
    if (day === selection.start) return onSelect(null);
    // A stretch cannot run across a day that cannot be had, so a renter's
    // second press past one of those starts over from it.
    if (!editing && !daysBetween(selection.start, day).every((each) => open(read(each)))) {
      return onSelect({ start: day, end: day });
    }
    onSelect({ start: selection.start, end: day });
  }

  return (
    <div className={styles.calendar}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.turn}
          onClick={() => setMonth(addMonths(month, -1))}
          disabled={month <= firstMonth}
          aria-label={t("calendar.previous")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <strong className={styles.month}>{formatMonth(month, i18n.language)}</strong>
        <button
          type="button"
          className={styles.turn}
          onClick={() => setMonth(addMonths(month, 1))}
          disabled={month >= lastMonth}
          aria-label={t("calendar.next")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      <div className={styles.grid}>
        {names.map((name, index) => (
          // The headings are the seven days in order and nothing else.
          // eslint-disable-next-line react/no-array-index-key
          <span key={index} className={styles.weekday}>
            {name}
          </span>
        ))}
        {cells.map((day, index) => {
          // eslint-disable-next-line react/no-array-index-key
          if (!day) return <span key={index} className={styles.blank} />;
          const state = read(day);
          // Turned over: the stretch being picked, or — where days are being
          // ticked one at a time for something — the ones ticked so far.
          const chosen = (selection && day >= selection.start && day <= selection.end) || marked?.includes(day);
          const classes = [
            styles.day,
            state.outside && styles.outside,
            !state.outside && state.closed && styles.closed,
            !state.outside && state.taken && styles.taken,
            !state.outside && state.pending && styles.pending,
            chosen && styles.chosen,
            day === now && styles.today,
          ];
          const label = state.outside
            ? null
            : state.taken
              ? t("calendar.taken")
              : state.closed
                ? t("calendar.closed")
                : compactPrice(state.price, item.currency, i18n.language);
          return (
            <button
              key={day}
              type="button"
              className={classes.filter(Boolean).join(" ")}
              onClick={() => press(day)}
              disabled={!pressable(day, state)}
              aria-pressed={Boolean(chosen)}
              aria-label={`${day}${label ? `, ${label}` : ""}`}
            >
              <span className={styles.number}>{Number(day.slice(8))}</span>
              {/* What the day costs, or why it cannot be had. A price of its
                  own is marked so the owner can see which days they changed. */}
              {label && (
                <span className={state.own && !state.taken && !state.closed ? styles.ownPrice : styles.note}>
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <ul className={styles.legend}>
        <li>
          <span className={styles.swatch} />
          {t("calendar.available")}
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.taken}`} />
          {t("calendar.taken")}
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.closed}`} />
          {t("calendar.closed")}
        </li>
        {bookings.some((booking) => booking.status === "pending") && (
          <li>
            <span className={`${styles.swatch} ${styles.pending}`} />
            {t("calendar.pending")}
          </li>
        )}
      </ul>
    </div>
  );
}
