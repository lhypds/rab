import { useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { compactPrice } from "../../utils/format.js";
import { STEP, clockOf, hoursOf, minutesOf, weekOf } from "../../utils/rates.js";
import styles from "./timetable.module.css";

// The day as a timetable: a column of hours, a line across for each with its
// time at the left and a dashed one at each half hour — the timetable of `tm`,
// drawn in this project's one ink. Two things are put on it: the hours of one
// day somebody is booking from (DayTimes), and the hours of the week an owner
// says an item can be had (WeekHours).

const PAD = 10; // px above the first line and under the last, so their times are not cut
const pad = (number) => String(number).padStart(2, "0");

// The lines of the hours from `from` to `to`, each `hour` px under the last.
function Lines({ from, to, hour }) {
  return (
    <>
      {Array.from({ length: to - from + 1 }, (_, index) => (
        <div key={`h${from + index}`} className={styles.hour} style={{ top: PAD + index * hour }}>
          <span className={styles.label}>{pad(from + index)}:00</span>
        </div>
      ))}
      {Array.from({ length: to - from }, (_, index) => (
        <div key={`m${from + index}`} className={`${styles.hour} ${styles.half}`} style={{ top: PAD + (index + 0.5) * hour }} />
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

const DAY_HOUR = 40; // px an hour: half an hour is 20px, tall enough for a thumb

// One day's hours, to be read and picked from. `cells` are the half hours the
// day has (see slotStates): each can be had, is somebody's already, or has
// been asked for. `value` is the stretch picked, { start, end }; a press
// starts one, a press on a later half hour ends it there, and a press on the
// one half hour picked lets go of it — the way days are picked on the
// calendar above it. Without `onChange` it is only read.
export function DayTimes({ cells, value = null, onChange, currency }) {
  const { t, i18n } = useTranslation();
  const taken = useMemo(() => runs(cells, (cell) => cell.taken), [cells]);
  const pending = useMemo(() => runs(cells, (cell) => cell.pending && !cell.taken), [cells]);
  if (cells.length === 0) return <p className={styles.none}>{t("calendar.noHours")}</p>;

  const from = Math.floor(minutesOf(cells[0].start) / 60);
  const to = Math.ceil(minutesOf(cells[cells.length - 1].end) / 60);
  const top = (time) => ((minutesOf(time) - from * 60) * DAY_HOUR) / 60;

  function press(cell) {
    const single = value && minutesOf(value.end) - minutesOf(value.start) === STEP;
    if (single && cell.start === value.start) return onChange(null);
    // A second press later in the day ends the stretch there, where every
    // half hour between the two can be had.
    if (single && cell.start > value.start) {
      const between = cells.filter((each) => each.start >= value.start && each.start <= cell.start);
      const whole = between.every((each, index) => !each.taken && (index === 0 || between[index - 1].end === each.start));
      if (whole) return onChange({ start: value.start, end: cell.end });
    }
    onChange({ start: cell.start, end: cell.end });
  }

  return (
    <div className={styles.day} style={{ height: PAD * 2 + (to - from) * DAY_HOUR }}>
      <div className={styles.lane} style={{ top: PAD, height: (to - from) * DAY_HOUR }}>
        {cells.map((cell, index) => {
          const on = value && cell.start >= value.start && cell.start < value.end;
          // What an hour costs is written where it changes, not on every line.
          const priced = !cell.taken && (index === 0 || cells[index - 1].price !== cell.price || cells[index - 1].end !== cell.start);
          return (
            <button
              key={cell.start}
              type="button"
              className={[styles.cell, on && styles.on].filter(Boolean).join(" ")}
              style={{ top: top(cell.start), height: DAY_HOUR / 2 }}
              disabled={cell.taken || !onChange}
              aria-pressed={Boolean(on)}
              aria-label={`${cell.start}–${cell.end}`}
              onClick={() => press(cell)}
            >
              {priced && <span className={styles.price}>{compactPrice(cell.price, currency, i18n.language)}</span>}
            </button>
          );
        })}
        {taken.map((run) => (
          <div key={`t${run.start}`} className={`${styles.mark} ${styles.taken}`} style={{ top: top(run.start), height: top(run.end) - top(run.start) }}>
            <span>
              {run.start}–{run.end} {t("calendar.taken")}
            </span>
          </div>
        ))}
        {pending.map((run) => (
          <div key={`p${run.start}`} className={`${styles.mark} ${styles.pending}`} style={{ top: top(run.start), height: top(run.end) - top(run.start) }}>
            <span>{t("calendar.pending")}</span>
          </div>
        ))}
      </div>
      <Lines from={from} to={to} hour={DAY_HOUR} />
    </div>
  );
}

const WEEK_HOUR = 32; // px an hour in the week's timetable: half an hour is 16px
const WEEK_CELL = WEEK_HOUR / 2;
const OPENS_AT = 8; // the hour the week's timetable is scrolled to when it is first drawn

// The hours of the week an item can be had: seven columns, Sunday first, over
// the hours of the day. Pressing and dragging paints a stretch — across days
// as well as down the clock — and starting on a half hour already painted
// takes the paint off instead. `value` is the list of stretches the item
// keeps (see utils/rates.js); `onChange` is handed the new list.
export function WeekHours({ value, onChange, names }) {
  const week = useMemo(() => weekOf(value), [value]);
  const scrollRef = useRef(null);
  const lanesRef = useRef(null);
  const drag = useRef(null);

  useLayoutEffect(() => {
    scrollRef.current.scrollTop = OPENS_AT * WEEK_HOUR;
  }, []);

  // The day and the half hour under the pointer, held inside the timetable.
  function at(event) {
    const box = lanesRef.current.getBoundingClientRect();
    const day = Math.min(6, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * 7)));
    const cell = Math.min(week[0].length - 1, Math.max(0, Math.floor((event.clientY - box.top) / WEEK_CELL)));
    return { day, cell };
  }

  // Everything between where the press began and where the pointer is now,
  // painted — or wiped — over the week as it was when the press began, so the
  // stretch can be drawn back as well as out.
  function paint(event) {
    const { base, from, on } = drag.current;
    const to = at(event);
    const next = base.map((cells) => [...cells]);
    for (let day = Math.min(from.day, to.day); day <= Math.max(from.day, to.day); day++) {
      for (let cell = Math.min(from.cell, to.cell); cell <= Math.max(from.cell, to.cell); cell++) next[day][cell] = on;
    }
    onChange(hoursOf(next));
  }

  function down(event) {
    if (event.button > 0) return;
    const from = at(event);
    drag.current = { base: week, from, on: !week[from.day][from.cell] };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    paint(event);
  }

  return (
    <div className={styles.week}>
      <div className={styles.names} aria-hidden="true">
        {names.map((name, day) => (
          // The seven days in order; nothing else identifies them.
          // eslint-disable-next-line react/no-array-index-key
          <span key={day}>{name}</span>
        ))}
      </div>
      <div ref={scrollRef} className={styles.scroll}>
        <div className={styles.day} style={{ height: PAD * 2 + 24 * WEEK_HOUR }}>
          <div
            ref={lanesRef}
            className={styles.lanes}
            style={{ top: PAD, height: 24 * WEEK_HOUR }}
            onPointerDown={down}
            onPointerMove={(event) => drag.current && paint(event)}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            {week.map((cells, day) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={day} className={styles.column}>
                {runs(
                  cells.map((open, index) => ({ open, start: clockOf(index * STEP), end: clockOf((index + 1) * STEP) })),
                  (cell) => cell.open,
                ).map((run) => {
                  const length = (minutesOf(run.end) - minutesOf(run.start)) / STEP;
                  return (
                    <div
                      key={run.start}
                      className={styles.open}
                      style={{ top: (minutesOf(run.start) / STEP) * WEEK_CELL, height: length * WEEK_CELL }}
                    >
                      {length >= 2 && <span>{run.start}</span>}
                      {length >= 4 && <span>{run.end}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <Lines from={0} to={24} hour={WEEK_HOUR} />
        </div>
      </div>
    </div>
  );
}
