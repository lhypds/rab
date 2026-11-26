import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { STEP, clockOf, hoursOf, hoursOfDates, minutesOf, weekOf, withDatesPainted } from "../../utils/rates.js";
import styles from "./timetable.module.css";

// The day as a timetable: a column of hours, a line across for each with its
// time at the left and a dashed one at each half hour — the timetable of `tm`,
// drawn in this project's one ink. Two things are put on it: the hours of one
// day somebody is booking from (DayTimes), and the hours of the week an owner
// says an item can be had (WeekHours).

const PAD = 10; // px above the first line and under the last, so their times are not cut
const pad = (number) => String(number).padStart(2, "0");

// The lines of the hours from `from` to `to`, each `hour` px under the last,
// and a dashed one between them every `step` minutes: at the half hour, or
// at each piece of a day that is cut finer than that.
function Lines({ from, to, hour, step = STEP }) {
  const marks = [];
  for (let at = from * 60 + step; at < to * 60; at += step) {
    if (at % 60 !== 0) marks.push(at);
  }
  return (
    <>
      {Array.from({ length: to - from + 1 }, (_, index) => (
        <div key={`h${from + index}`} className={styles.hour} style={{ top: PAD + index * hour }}>
          <span className={styles.label}>{pad(from + index)}:00</span>
        </div>
      ))}
      {marks.map((at) => (
        <div key={`m${at}`} className={`${styles.hour} ${styles.half}`} style={{ top: PAD + ((at - from * 60) * hour) / 60 }} />
      ))}
    </>
  );
}

// Cells that follow one another and answer `test` the same way, as stretches.
function runs(cells, test) {
  const found = [];
  for (const cell of cells) {
    if (!test(cell)) continue;
    const last = found[found.length - 1];
    if (last && last.end === cell.start) last.end = cell.end;
    else found.push({ start: cell.start, end: cell.end });
  }
  return found;
}

// The minutes into the day it is where the reader is sitting, kept up with the
// clock while `running` — or null while not.
function useClock(running) {
  const read = () => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  };
  const [minutes, setMinutes] = useState(read);
  useEffect(() => {
    if (!running) return undefined;
    setMinutes(read());
    const timer = window.setInterval(() => setMinutes(read()), 30_000);
    return () => window.clearInterval(timer);
  }, [running]);
  return running ? minutes : null;
}

// The px an hour is drawn in, by the piece the day is cut in: a piece is never
// under 20px, which is tall enough for a thumb, and an hour never under 40px.
const dayHour = (unit) => Math.max(40, (20 * 60) / unit);

// One day's hours, to be read and picked from. `cells` are the half hours the
// day has (see slotStates): each can be had, is somebody's already, or has
// been asked for. `value` is the stretch picked, { start, end }; a press
// starts one, a press on a later half hour ends it there, and a press on the
// one half hour picked lets go of it — the way days are picked on the
// calendar above it. Without `onChange` it is only read.
// With `today` the day shown is today, and the time it is now is ruled across
// it in red.
// `unit` is how long one of the cells is, in minutes.
export function DayTimes({ cells, value = null, onChange, today = false, unit = STEP }) {
  const DAY_HOUR = dayHour(unit);
  const { t } = useTranslation();
  const clock = useClock(today);
  // The whole day is drawn, midnight to midnight, in a box that shows a part
  // of it and scrolls to the rest. It opens on the part worth seeing: now,
  // with a little of what came before it, where the day is today; otherwise
  // the first hour that can be had. Once, as the day is first drawn — after
  // that where it stands is the reader's.
  const scrollRef = useRef(null);
  // The lane the half hours are in, and the drag across it while there is one.
  const laneRef = useRef(null);
  const dragRef = useRef(null);
  useLayoutEffect(() => {
    if (!scrollRef.current || cells.length === 0) return;
    const first = minutesOf(cells[0].start);
    const from = today ? Math.min(Math.max(clock - 60, 0), Math.max(first, clock - 60)) : first;
    scrollRef.current.scrollTop = (from * DAY_HOUR) / 60;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Today, a piece of the day that has begun can no longer be had: it is
  // greyed like the hours the day does not have, up to the first piece still
  // to come.
  const past = (cell) => clock !== null && minutesOf(cell.start) < clock;
  // What cannot be picked: somebody's already, or gone by.
  const shut = (cell) => cell.taken || past(cell);
  // A stretch picked that the clock has since reached is let go of.
  useEffect(() => {
    if (value && onChange && clock !== null && minutesOf(value.start) < clock) onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock]);
  const taken = useMemo(() => runs(cells, (cell) => cell.taken), [cells]);
  const pending = useMemo(() => runs(cells, (cell) => cell.pending && !cell.taken), [cells]);
  if (cells.length === 0) return <p className={styles.none}>{t("calendar.noHours")}</p>;

  const from = 0;
  const to = 24;
  const top = (time) => ((minutesOf(time) - from * 60) * DAY_HOUR) / 60;

  function press(cell) {
    const single = value && minutesOf(value.end) - minutesOf(value.start) === unit;
    if (single && cell.start === value.start) return onChange(null);
    // A second press later in the day ends the stretch there, where every
    // half hour between the two can be had.
    if (single && cell.start > value.start) {
      const between = cells.filter((each) => each.start >= value.start && each.start <= cell.start);
      const whole = between.every((each, index) => !shut(each) && (index === 0 || between[index - 1].end === each.start));
      if (whole) return onChange({ start: value.start, end: cell.end });
    }
    onChange({ start: cell.start, end: cell.end });
  }

  // A stretch can also be drawn: pressed where it starts and dragged to where
  // it ends, up the day or down it. The half hour under the pointer, by where
  // the pointer is in the lane — which is where it is in the day.
  function indexAt(event) {
    const box = laneRef.current.getBoundingClientRect();
    const at = ((event.clientY - box.top) / DAY_HOUR) * 60 + from * 60;
    return { at, index: cells.findIndex((cell) => at >= minutesOf(cell.start) && at < minutesOf(cell.end)) };
  }

  // From the half hour the drag began on towards the one the pointer is over,
  // as far as the half hours follow one another and can be had: a stretch
  // stops at one that is somebody's, and at an hour the day does not have.
  function stretch(anchor, at) {
    let first = anchor;
    let last = anchor;
    const joined = (a, b) => cells[a].end === cells[b].start && !shut(cells[a]) && !shut(cells[b]);
    while (last + 1 < cells.length && minutesOf(cells[last + 1].start) <= at && joined(last, last + 1)) last += 1;
    while (first > 0 && minutesOf(cells[first - 1].end) > at && joined(first - 1, first)) first -= 1;
    return { start: cells[first].start, end: cells[last].end };
  }

  function down(event) {
    if (!onChange || (event.pointerType === "mouse" && event.button !== 0)) return;
    const { index } = indexAt(event);
    if (index === -1 || shut(cells[index])) return;
    dragRef.current = { anchor: index, moved: false, before: value };
    laneRef.current.setPointerCapture(event.pointerId);
  }

  function move(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const { at } = indexAt(event);
    // Until the pointer leaves the half hour it went down on, it is a press.
    if (!drag.moved && at >= minutesOf(cells[drag.anchor].start) && at < minutesOf(cells[drag.anchor].end)) return;
    drag.moved = true;
    const next = stretch(drag.anchor, at);
    if (!value || next.start !== value.start || next.end !== value.end) onChange(next);
  }

  function up() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (!drag.moved) press(cells[drag.anchor]);
  }

  // Taken away by the system mid-drag — a call, a gesture of its own — the
  // day goes back to what was picked before.
  function cancel() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.moved) onChange(drag.before);
  }

  return (
    <div ref={scrollRef} className={styles.dayScroll}>
      <div className={styles.day} style={{ height: PAD * 2 + (to - from) * DAY_HOUR }}>
        <div
          ref={laneRef}
          className={onChange ? `${styles.lane} ${styles.pick}` : styles.lane}
          style={{ top: PAD, height: (to - from) * DAY_HOUR }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={cancel}
        >
          {cells.map((cell, index) => {
            const on = value && cell.start >= value.start && cell.start < value.end;
            return (
              <button
                key={cell.start}
                type="button"
                className={[styles.cell, on && styles.on, past(cell) && styles.past].filter(Boolean).join(" ")}
                style={{ top: top(cell.start), height: (unit * DAY_HOUR) / 60 }}
                disabled={shut(cell) || !onChange}
                aria-pressed={Boolean(on)}
                aria-label={`${cell.start}–${cell.end}`}
                // The pointer is the lane's to follow (above); this is the
                // keyboard's press, which comes as a click with no pointer.
                onClick={(event) => event.detail === 0 && press(cell)}
              />
            );
          })}
          {taken.map((run) => (
            <div
              key={`t${run.start}`}
              className={`${styles.mark} ${styles.taken}`}
              style={{
                top: top(run.start),
                height: top(run.end) - top(run.start),
              }}
            >
              <span>
                {run.start}–{run.end} {t("calendar.taken")}
              </span>
            </div>
          ))}
          {pending.map((run) => (
            <div
              key={`p${run.start}`}
              className={`${styles.mark} ${styles.pending}`}
              style={{
                top: top(run.start),
                height: top(run.end) - top(run.start),
              }}
            >
              <span>{t("calendar.pending")}</span>
            </div>
          ))}
        </div>
        <Lines from={from} to={to} hour={DAY_HOUR} step={Math.min(unit, STEP)} />
        {/* Now, where it falls inside the hours drawn. */}
        {clock !== null && clock >= from * 60 && clock <= to * 60 && (
          <div className={styles.now} style={{ top: PAD + ((clock - from * 60) * DAY_HOUR) / 60 }} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

// The px an hour is drawn in, in the week's timetable, by the cell it is cut
// in: half an hour is 16px, and a finer cell is never under 12px — small, but
// still something a pointer can be put on.
const weekHour = (step) => Math.max(32, (12 * 60) / step);
const OPENS_AT = 8; // the hour the week's timetable is scrolled to when it is first drawn

// The hours of the week an item can be had: seven columns, Sunday first, over
// the hours of the day. Pressing and dragging paints a stretch — across days
// as well as down the clock — and starting on a half hour already painted
// takes the paint off instead. `value` is the list of stretches the item
// keeps (see utils/rates.js); `onChange` is handed the new list.
//
// With `dates` — seven days, Sunday first — it is one week of the calendar and
// not every week: each column is that date, named over it, showing what the
// item's rules give it or what was painted for it, and what is painted now is
// that date's hours and no other's. `value` is then whatever has the hours,
// { hours, hoursOff, openDays }, and `onChange` is handed { hours, hoursOff }.
// A date before `from` is over and cannot be painted.
//
// `step` is how long one cell is, in minutes: half an hour, or less where the
// item is booked or priced in less.
//
// `painted` are the dates among them with hours of their own, and each has a
// small arrow after its name that hands the date to `onRevert`, to be put
// back to the usual hours; `revertLabel` is what the arrow is called.
//
// With `priceAt` — handed a date and a time, giving the price in force then,
// already written out — each stretch says what it costs rather than when it
// starts and ends, which the lines and the times at the left say already.
// With `onPrice` as well, each price has a pencil after it: a press on one
// hands on that cell — its date, where it starts and where it ends, and the
// whole stretch { start, end } it is a part of — to be given a price of its
// own, and a drag from one hands on every cell of that date dragged over;
// `priceLabel` is what the pencil is called.
// Where on the screen the sheet about a piece of the week goes: just under
// the piece, from its day's left edge — from its right edge in the last days
// of the week, so it does not run off the side. `cellHeight` is how tall a
// piece is drawn, which goes by the unit the week is cut in.
function toldPlace(lanes, { day, cell }, cellHeight) {
  const box = lanes.getBoundingClientRect();
  const top = box.top + (cell + 1) * cellHeight + 2;
  return day >= 4
    ? { top, right: window.innerWidth - box.right + ((6 - day) / 7) * box.width }
    : { top, left: box.left + (day / 7) * box.width };
}

export function WeekHours({
  value,
  onChange,
  names,
  dates = null,
  from: earliest = null,
  step = STEP,
  painted = null,
  onRevert,
  revertLabel,
  priceAt,
  fullPriceAt,
  onPrice,
  priceLabel,
}) {
  const WEEK_HOUR = weekHour(step);
  const WEEK_CELL = (WEEK_HOUR * step) / 60;
  const week = useMemo(() => (dates ? hoursOfDates(value, dates, step) : weekOf(value, step)), [value, dates, step]);
  const scrollRef = useRef(null);
  const lanesRef = useRef(null);
  const drag = useRef(null);
  // The box the drag in hand reaches over — its days and its cells — drawn as
  // an outline while the pointer is down. Nothing under it changes, on the
  // page or in what is kept, until the pointer comes up.
  const [reach, setReach] = useState(null);
  // The cell the pointer is over, while nothing is being dragged: the stretch
  // it is in is said in full beside it — when, and at what price.
  const [over, setOver] = useState(null);
  function hover(event) {
    const next = at(event);
    setOver((current) => (current && current.day === next.day && current.cell === next.cell ? current : next));
  }
  // That stretch: the cells either side of the one under the pointer that can
  // be had and cost what it costs.
  function stretchAt({ day, cell }) {
    const cells = week[day];
    if (!cells?.[cell] || !dates || !priceAt || (earliest && dates[day] < earliest)) return null;
    const price = priceAt(dates[day], clockOf(cell * step));
    let first = cell;
    let last = cell;
    while (first > 0 && cells[first - 1] && priceAt(dates[day], clockOf((first - 1) * step)) === price) first -= 1;
    while (last < cells.length - 1 && cells[last + 1] && priceAt(dates[day], clockOf((last + 1) * step)) === price) last += 1;
    // Said in full where the form gives the figure in full (`fullPriceAt`).
    const full = fullPriceAt ? fullPriceAt(dates[day], clockOf(cell * step)) : price;
    return { start: clockOf(first * step), end: clockOf((last + 1) * step), price: full };
  }
  const told = over && !reach ? stretchAt(over) : null;

  useLayoutEffect(() => {
    scrollRef.current.scrollTop = OPENS_AT * WEEK_HOUR;
    // Again when the cells change size, since the same hour is then elsewhere.
  }, [WEEK_HOUR]);

  // The day and the half hour under the pointer, held inside the timetable.
  function at(event) {
    const box = lanesRef.current.getBoundingClientRect();
    const day = Math.min(6, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * 7)));
    const cell = Math.min(week[0].length - 1, Math.max(0, Math.floor((event.clientY - box.top) / WEEK_CELL)));
    return { day, cell };
  }

  // Everything between where the press began and where the pointer is now,
  // painted — or wiped — over the week as it was when the press began, so the
  // stretch can be drawn back as well as out. Worked out and held for when
  // the pointer comes up; all that is shown meanwhile is the box it covers.
  function paint(event) {
    const { base, from, on, pricing } = drag.current;
    const to = at(event);
    // Begun on a pencil, the drag picks what is to be priced and paints
    // nothing: one date's cells, up or down from the one pressed, and no
    // further than the stretch of hours that one is in.
    if (pricing) {
      const cell = Math.min(pricing.last, Math.max(pricing.first, to.cell));
      drag.current.picked = { first: Math.min(from.cell, cell), last: Math.max(from.cell, cell) };
      setReach({ day: from.day, days: 1, cell: drag.current.picked.first, cells: drag.current.picked.last - drag.current.picked.first + 1, pricing: true });
      return;
    }
    const next = base.map((cells) => [...cells]);
    for (let day = Math.min(from.day, to.day); day <= Math.max(from.day, to.day); day++) {
      if (dates && earliest && dates[day] < earliest) continue;
      for (let cell = Math.min(from.cell, to.cell); cell <= Math.max(from.cell, to.cell); cell++) next[day][cell] = on;
    }
    drag.current.next = next;
    setReach({
      day: Math.min(from.day, to.day),
      days: Math.abs(from.day - to.day) + 1,
      cell: Math.min(from.cell, to.cell),
      cells: Math.abs(from.cell - to.cell) + 1,
    });
  }

  // The pointer comes up, and what was drawn is kept — or, with `keep` false,
  // the drag was taken away by the system and what was drawn is let go of.
  function finish(keep) {
    const { next, picked, pricing, from } = drag.current ?? {};
    drag.current = null;
    setReach(null);
    // What a drag from a pencil picked is handed on to be priced: the date,
    // from when until when, and the stretch of hours it is a part of.
    if (keep && picked) {
      const time = (cell) => clockOf(cell * step);
      onPrice(dates[from.day], time(picked.first), time(picked.last + 1), { start: time(pricing.first), end: time(pricing.last + 1) });
      return;
    }
    if (keep && next) onChange(dates ? withDatesPainted(value, dates, next, step) : hoursOf(next, step));
  }

  function down(event) {
    if (event.button > 0) return;
    const from = at(event);
    drag.current = { base: week, from, on: !week[from.day][from.cell] };
    // Pressed on a pencil: the stretch of hours the cell is in, as the first
    // and last of its cells, is as far as the drag can pick.
    if (onPrice && event.target.closest?.("[data-price]") && week[from.day][from.cell]) {
      const cells = week[from.day];
      let first = from.cell;
      let last = from.cell;
      while (first > 0 && cells[first - 1]) first -= 1;
      while (last < cells.length - 1 && cells[last + 1]) last += 1;
      drag.current.pricing = { first, last };
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    paint(event);
  }

  return (
    <div className={styles.week}>
      <div className={styles.names}>
        {names.map((name, day) => (
          // The seven days in order; nothing else identifies them.
          // eslint-disable-next-line react/no-array-index-key
          <span key={day} className={dates && earliest && dates[day] < earliest ? styles.over : undefined}>
            {name}
            {dates && ` ${Number(dates[day].slice(8))}`}
            {dates && onRevert && painted?.includes(dates[day]) && (
              <button type="button" className={styles.revert} onClick={() => onRevert(dates[day])} aria-label={revertLabel} title={revertLabel}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 9h10a6 6 0 0 1 0 12H8" />
                  <path d="m8 5-4 4 4 4" />
                </svg>
              </button>
            )}
          </span>
        ))}
      </div>
      {/* Scrolled, the piece under the pointer is another one: what was said
          about the last is taken down. */}
      <div ref={scrollRef} className={styles.scroll} onScroll={() => setOver(null)}>
        <div className={styles.day} style={{ height: PAD * 2 + 24 * WEEK_HOUR }}>
          <div
            ref={lanesRef}
            className={styles.lanes}
            style={{ top: PAD, height: 24 * WEEK_HOUR }}
            onPointerDown={down}
            onPointerMove={(event) => (drag.current ? paint(event) : hover(event))}
            onPointerLeave={() => setOver(null)}
            onPointerUp={() => finish(true)}
            onPointerCancel={() => finish(false)}
          >
            {week.map((cells, day) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={day} className={styles.column}>
                {/* A date that is over is left empty: it cannot be painted,
                    and what hours it had are nothing to anybody now. */}
                {!(dates && earliest && dates[day] < earliest) &&
                  runs(
                    cells.map((open, index) => ({
                      open,
                      start: clockOf(index * step),
                      end: clockOf((index + 1) * step),
                    })),
                    (cell) => cell.open,
                  ).map((run) => {
                    const length = (minutesOf(run.end) - minutesOf(run.start)) / step;
                    const height = length * WEEK_CELL;
                    return (
                      <div
                        key={run.start}
                        className={dates && priceAt ? `${styles.open} ${styles.priced}` : styles.open}
                        style={{
                          top: (minutesOf(run.start) / step) * WEEK_CELL,
                          height,
                        }}
                      >
                        {dates && priceAt ? (
                          // The price on every cell of the stretch, each on
                          // its own line of the cell's height.
                          Array.from({ length }, (_, at) => {
                            const time = clockOf(minutesOf(run.start) + at * step);
                            return (
                              <span key={time} style={{ height: WEEK_CELL, lineHeight: `${WEEK_CELL}px` }}>
                                {priceAt(dates[day], time)}
                                {onPrice && (
                                  // A press that starts on it is the start
                                  // of picking what to price, which the
                                  // timetable follows from there (see down).
                                  <span className={styles.pencil} data-price aria-label={priceLabel}>
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="M4 20l1-5L16 4l4 4L9 19z" />
                                      <path d="M14 6l4 4" />
                                    </svg>
                                  </span>
                                )}
                              </span>
                            );
                          })
                        ) : (
                          <>
                            {height >= 32 && <span>{run.start}</span>}
                            {height >= 64 && <span>{run.end}</span>}
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>
            ))}
            {/* Said over everything, not inside the table: the table scrolls
                and cuts off what hangs out of it, so the sheet is drawn on the
                page itself, placed where the piece under the pointer is on
                the screen. */}
            {told &&
              lanesRef.current &&
              createPortal(
                <div className={`${styles.told} ${styles.toldOver}`} style={toldPlace(lanesRef.current, over, WEEK_CELL)} aria-hidden="true">
                  <span>
                    {told.start}–{told.end}
                  </span>
                  <span>{told.price}</span>
                </div>,
                document.body,
              )}
            {reach && (
              <div
                className={reach.pricing ? `${styles.reach} ${styles.reachPrice}` : styles.reach}
                style={{
                  left: `${(reach.day / 7) * 100}%`,
                  width: `${(reach.days / 7) * 100}%`,
                  top: reach.cell * WEEK_CELL,
                  height: reach.cells * WEEK_CELL,
                }}
              />
            )}
          </div>
          <Lines from={0} to={24} hour={WEEK_HOUR} step={step} />
        </div>
      </div>
    </div>
  );
}
