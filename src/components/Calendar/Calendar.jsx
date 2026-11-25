import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { addDays, addMonths, daysBetween, formatMonth, monthGrid, monthOf, today, weekdayNames } from "../../utils/days.js";
import { compactPrice, wholePrice } from "../../utils/format.js";
import { cellsOn, dayPrice, openByRule, priceUnitOf, slotsClash } from "../../utils/rates.js";
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
    // An entry that says the day can be had says so whatever the item's rule
    // for days would have said.
    else state.opened = true;
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
      // What the hours still to be had cost: the least of them, and the most
      // where they do not all cost the same.
      // None, where the item says no price.
      price: free.length > 0 && free.every((slot) => slot.price != null) ? Math.min(...free.map((slot) => slot.price)) : null,
      priceMax: free.length > 0 && free.every((slot) => slot.price != null) ? Math.max(...free.map((slot) => slot.price)) : null,
      slots,
    };
  }
  return {
    outside,
    // Closed by the owner for that date, or left out by the rule for days and
    // not opened for that date.
    closed: Boolean(state.closed) || (!state.opened && !openByRule(item, day)),
    taken: Boolean(state.taken),
    pending: Boolean(state.pending),
    price: state.price ?? dayPrice(item, day),
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
  // No total, where a day of them has no price said.
  if (days.some((day) => day.price == null)) return { days: days.length, total: null };
  const total = days.reduce((sum, day) => sum + day.price, 0);
  return { days: days.length, total: Math.round(total * 100) / 100 };
}

// The figure on a day's square: what it costs — or, where its hours do not all
// cost the same, the least of them and a mark that it goes up from there:
// "¥30~". A square has no room for both ends.
function priceLabel(state, currency, locale) {
  const low = compactPrice(state.price, currency, locale);
  if (state.priceMax == null || state.priceMax === state.price) return low;
  return `${low}~`;
}

// A day's hours as the stretches to be read off it: the pieces that follow
// one another and are alike — taken, or to be had at one price — put together.
function stretches(slots) {
  const found = [];
  for (const slot of slots) {
    const last = found[found.length - 1];
    if (last && last.end === slot.start && last.taken === slot.taken && (slot.taken || last.price === slot.price)) last.end = slot.end;
    else found.push({ start: slot.start, end: slot.end, taken: slot.taken, price: slot.price });
  }
  return found;
}

// One month of an item's days: which can be had, which are taken, what each
// costs. It is pressed in one of three ways, and which one says who is
// pressing:
//
// - `onSelect`, by somebody renting: a day starts a stretch and a later day
//   ends it — or, where the item goes by the time, one day is the whole of it,
//   whoever is pressing.
// - `onSelect` with `editing`, by the owner on the item's page: the same
//   stretch, but over any day ahead, closed ones included, since what is being
//   chosen is which days to change.
// - `onToggle`, by the owner in the item form: every press is its own answer,
//   a day closed or opened again — or, with `marked`, a day ticked or unticked
//   for whatever the form is collecting dates for. With `onOpen`, each date
//   has a pencil beside its price, which hands the date to the form to be
//   given a price of its own.
export default function Calendar({
  item,
  calendar,
  bookings = [],
  selection = null,
  onSelect,
  onToggle,
  onOpen,
  editing = false,
  marked = null,
  off = false,
}) {
  const { t, i18n } = useTranslation();
  const now = today();
  const firstMonth = monthOf(now);
  const lastMonth = monthOf(calendar.until);
  const [month, setMonth] = useState(firstMonth);
  const states = useMemo(() => dayStates(calendar, bookings), [calendar, bookings]);
  const cells = useMemo(() => monthGrid(month), [month]);
  const names = useMemo(() => weekdayNames(i18n.language), [i18n.language]);
  // With `off` the whole item has been switched off by its owner: no day of it
  // can be had, and every day ahead is drawn the way a closed one is.
  const read = (day) => {
    const state = reading(item, states, calendar, day);
    return off && !state.outside ? { ...state, closed: true } : state;
  };
  const owner = editing || Boolean(onToggle);

  function pressable(day, state) {
    if (state.outside || (!onSelect && !onToggle)) return false;
    return owner || open(state);
  }

  function press(day) {
    if (onToggle) return onToggle(day);
    // By the time, a rental is within one day, so a press is the whole choice
    // — for the owner too, whose pick is the day whose hours are shown.
    if (item.mode === "time") {
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

  // A stretch can also be drawn with a mouse or a pen: pressed on the day it
  // starts and dragged to the day it ends, forwards or back. Not with a
  // finger, whose drag over the calendar is the page being scrolled — there
  // it stays two presses.
  const ranged = Boolean(onSelect) && !onToggle && item.mode !== "time";
  const dragRef = useRef(null);
  // The day a press has just let go of. The pointer is still on it, and a day
  // under the pointer is filled in grey — which would read as the press having
  // done something else to it. So it is drawn plain until the pointer has left.
  const [quiet, setQuiet] = useState(null);

  function dragStart(event, day) {
    if (!ranged || event.pointerType === "touch" || event.button !== 0) return;
    const drag = { anchor: day, moved: false, down: true };
    dragRef.current = drag;
    const stop = () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      drag.down = false;
      // The click that ends a drag comes straight after this, and is the
      // drag's and not a press (see the day's onClick); after it, forgotten.
      window.setTimeout(() => {
        if (dragRef.current === drag) dragRef.current = null;
      }, 0);
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function dragMove(event) {
    const drag = dragRef.current;
    if (!drag?.down) return;
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-day]")?.dataset.day;
    // Until the pointer is on another day, it is a press.
    if (!over || (!drag.moved && over === drag.anchor)) return;
    drag.moved = true;
    // From the day the drag began on towards the one under the pointer, as far
    // as the days can be pressed: a renter's stretch stops at a day that
    // cannot be had, and anybody's at the end of the calendar.
    const by = over > drag.anchor ? 1 : -1;
    let reach = drag.anchor;
    while (reach !== over) {
      const next = addDays(reach, by);
      if (!pressable(next, read(next))) break;
      reach = next;
    }
    const start = by > 0 ? drag.anchor : reach;
    const end = by > 0 ? reach : drag.anchor;
    if (selection?.start !== start || selection?.end !== end) onSelect({ start, end });
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

      <div className={styles.grid} onPointerMove={ranged ? dragMove : undefined}>
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
          // A day that cannot be pressed is switched off — unless it has a
          // pencil, which a switched-off button would take down with it: then
          // the day is left on and simply does nothing (`still`).
          const inert = !pressable(day, state);
          const still = inert && Boolean(onOpen) && !state.outside;
          const classes = [
            styles.day,
            still && styles.still,
            state.outside && styles.outside,
            !state.outside && state.closed && styles.closed,
            !state.outside && state.taken && styles.taken,
            !state.outside && state.pending && styles.pending,
            chosen && styles.chosen,
            day === quiet && styles.quiet,
            day === now && styles.today,
          ];
          const label = state.outside
            ? null
            : state.taken
              ? t("calendar.taken")
              : state.closed
                ? t("calendar.closed")
                : priceLabel(state, item.currency, i18n.language);
          return (
            <button
              key={day}
              type="button"
              className={classes.filter(Boolean).join(" ")}
              data-day={day}
              onPointerDown={(event) => dragStart(event, day)}
              // A click at the end of a drag is the drag letting go, not a press.
              onClick={() => {
                if (inert || dragRef.current?.moved) return;
                if (chosen) setQuiet(day);
                press(day);
              }}
              onPointerLeave={() => day === quiet && setQuiet(null)}
              disabled={inert && !still}
              aria-pressed={Boolean(chosen)}
              aria-label={`${day}${label ? `, ${label}` : ""}`}
            >
              <span className={styles.number}>{Number(day.slice(8))}</span>
              {/* Under the pointer, the day in full where it goes by the time:
                  each stretch of its hours and what that costs, or that it is
                  taken. Hung under the square, from its left edge — or its
                  right, in the columns at the right, and over it in the last
                  rows, so it stays on the page. */}
              {!state.outside && !state.closed && state.slots?.length > 0 && (
                <span
                  className={[
                    styles.detail,
                    index % 7 >= 4 && styles.detailRight,
                    // The last two weeks of the month hang it over the square
                    // instead: under them is the foot of whatever the
                    // calendar stands in, which would cut it off.
                    index >= cells.length - 14 && styles.detailUp,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-hidden="true"
                >
                  {stretches(state.slots).map((stretch) => (
                    <span key={stretch.start}>
                      <span>
                        {stretch.start}–{stretch.end}
                      </span>
                      {(stretch.taken || stretch.price != null) && (
                        <span>{stretch.taken ? t("calendar.taken") : wholePrice(stretch.price, item.currency, i18n.language)}</span>
                      )}
                    </span>
                  ))}
                  {/* And at the foot, what stretch of the clock those prices
                      are for, written out — there is room here: "* Per 30
                      minutes". Not where no price is said. */}
                  {state.slots.some((slot) => slot.price != null) && (
                  <span className={styles.detailNote}>
                    *{" "}
                    {t("item.everyHour", {
                      unit:
                        priceUnitOf(item) === 60
                          ? t("item.unitHour")
                          : t("calendar.minutes", { count: priceUnitOf(item) }),
                    })}
                  </span>
                  )}
                </span>
              )}
              {/* What the day costs, or why it cannot be had — and beside it,
                  where the form wants to know (`onOpen`), a pencil: the way
                  to give this one date a price of its own. A span and not a
                  button, since it stands inside one; its press is its own and
                  is not also a press on the day. */}
              {label && (
                <span className={styles.foot}>
                  <span className={styles.note}>{label}</span>
                  {onOpen && (
                    <span
                      className={styles.pencil}
                      role="button"
                      aria-label={t("calendar.editPrice")}
                      title={t("calendar.editPrice")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(day);
                      }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 20l1-5L16 4l4 4L9 19z" />
                        <path d="M14 6l4 4" />
                      </svg>
                    </span>
                  )}
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
