import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { addMonths, formatDay, formatMonth, monthGrid, monthOf, today, weekdayNames } from "../../utils/days.js";
import styles from "./date.module.css";

// A date, chosen from a month's page drawn the way the rest of the app is —
// a box that says the date, and under it, when pressed, the month: its name
// between the two arrows that turn it, the seven days' letters, and the days,
// each a square to press. Not the browser's own picker, which looks like
// whatever system it runs on.
//
// `value` is a day ("2026-11-19") or "" for none; `min` the earliest that
// may be chosen; `onChange` is told the day pressed, or "" where it is
// cleared. `label` names it for whoever cannot see it.
const PAGE_HEIGHT = 250; // about what a month's page stands — to know whether it fits under the box

export default function DateField({ value, min = "", onChange, label, placeholder = "" }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const boxRef = useRef(null);
  const pageRef = useRef(null);
  const [open, setOpen] = useState(false);
  // The month the page is turned to: the chosen day's, or the earliest's, or this one.
  const [month, setMonth] = useState(() => monthOf(value || min || today()));
  // Where on the window the page stands: under the box, or over it where
  // there is no room under.
  const [place, setPlace] = useState(null);
  const cells = useMemo(() => monthGrid(month), [month]);
  const names = useMemo(() => weekdayNames(lang), [lang]);
  const now = today();

  const show = () => {
    setMonth(monthOf(value || (min > now ? min : now)));
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    const put = () => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      const under = window.innerHeight - box.bottom;
      const width = 232;
      const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
      setPlace(under >= PAGE_HEIGHT || under >= box.top ? { left, top: box.bottom + 4 } : { left, bottom: window.innerHeight - box.top + 4 });
    };
    put();
    window.addEventListener("resize", put);
    // The sheet scrolling under it carries the box away: the page follows.
    window.addEventListener("scroll", put, true);
    return () => {
      window.removeEventListener("resize", put);
      window.removeEventListener("scroll", put, true);
    };
  }, [open]);

  // Closed by a press anywhere else, and by Escape.
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      if (boxRef.current?.contains(event.target) || pageRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const key = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      boxRef.current?.focus();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const pick = (day) => {
    onChange(day);
    setOpen(false);
    boxRef.current?.focus();
  };

  return (
    <>
      <button
        ref={boxRef}
        type="button"
        className={`text-input ${styles.box}${open ? ` ${styles.open}` : ""}`}
        onClick={() => (open ? setOpen(false) : show())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
      >
        <span className={value ? undefined : styles.none}>
          {value ? formatDay(value, lang, { year: "numeric", month: "short", day: "numeric" }) : placeholder}
        </span>
        {/* A small calendar: what the box opens. */}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16v14H4z" />
          <path d="M4 10h16" />
          <path d="M8 3v5M16 3v5" />
        </svg>
      </button>
      {open &&
        place &&
        createPortal(
          <div ref={pageRef} className={styles.page} style={place} role="dialog" aria-label={label}>
            <div className={styles.head}>
              <button
                type="button"
                className={styles.turn}
                onClick={() => setMonth(addMonths(month, -1))}
                // Nothing before the earliest month to turn to.
                disabled={Boolean(min) && month <= monthOf(min)}
                aria-label={t("calendar.previous")}
              >
                <svg viewBox="0 0 8 12" aria-hidden="true">
                  <path d="M6 1 1 6l5 5" />
                </svg>
              </button>
              <strong>{formatMonth(month, lang)}</strong>
              <button type="button" className={styles.turn} onClick={() => setMonth(addMonths(month, 1))} aria-label={t("calendar.next")}>
                <svg viewBox="0 0 8 12" aria-hidden="true">
                  <path d="m2 1 5 5-5 5" />
                </svg>
              </button>
            </div>
            <div className={styles.grid}>
              {names.map((name, index) => (
                <span key={index} className={styles.name}>
                  {name}
                </span>
              ))}
              {cells.map((day, index) =>
                day ? (
                  <button
                    key={day}
                    type="button"
                    className={[styles.day, day === value && styles.chosen, day === now && styles.today].filter(Boolean).join(" ")}
                    disabled={Boolean(min) && day < min}
                    onClick={() => pick(day)}
                    aria-pressed={day === value}
                    aria-label={formatDay(day, lang, { year: "numeric", month: "long", day: "numeric" })}
                  >
                    {Number(day.slice(8))}
                  </button>
                ) : (
                  <span key={`none-${index}`} />
                ),
              )}
            </div>
            {/* A date is not always needed: the one chosen can be taken off. */}
            {value && (
              <button type="button" className={`small-button ${styles.clear}`} onClick={() => pick("")}>
                {t("common.clear")}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
