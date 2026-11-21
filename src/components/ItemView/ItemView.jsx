import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Modal, TextArea } from "../../ui/index.js";
import { addDays, countDays, formatDay, formatRange, today } from "../../utils/days.js";
import { formatCoords, formatPrice, formatUsername, relativeTime } from "../../utils/format.js";
import { directionsUrl } from "../../utils/mapbox.js";
import { STEP, minutesOf } from "../../utils/rates.js";
import Calendar, { dayStates, quote, slotStates } from "../Calendar/index.js";
import CategoryIcon from "../CategoryIcon/index.js";
import { BookingRow } from "../Rows/index.js";
import ShareModal from "../ShareModal/index.js";
import SpotMap from "../SpotMap/index.js";
import { DayTimes } from "../TimeTable/index.js";
import styles from "./view.module.css";

const NOTE_MAX = 500;
// The hours a rental by the day starts out with, until the renter says others:
// out in the morning and back in the evening, which holds for a single day as
// well as for a week — the form does not open on a complaint about its own
// defaults.
const DEFAULT_START_TIME = "10:00";
const DEFAULT_END_TIME = "18:00";

// The first day from today on which something can still be had, or null where
// the calendar has none left: the one-line answer to "is it free?".
function nextFreeDay(item, calendar) {
  const states = dayStates(calendar);
  for (let day = today(); day <= calendar.until; day = addDays(day, 1)) {
    const state = states.get(day) ?? {};
    if (state.closed) continue;
    if (item.mode === "time") {
      if (slotStates(item, states, day).some((slot) => !slot.taken)) return day;
    } else if (!state.taken) {
      return day;
    }
  }
  return null;
}

// An item's booking page: what it is, what it costs, when it can be had, and
// the way to ask for it. Drawn from what it is handed and nothing else, so the
// same page is what a visitor opens, what its owner manages, and — with
// `preview` — what the item form shows before anything has been published.
//
// The page is in two columns where there is room: what the thing is on the
// left, and on the right a card that stays in view holding the price, the
// calendar and the request. On a phone the card comes straight after the
// title, since when it is free is the first thing anybody wants to know.
export default function ItemView({
  item,
  calendar,
  bookings = [],
  viewer = null,
  preview = false,
  focusBooking = false,
  onBook,
  onChangeDays,
  onEdit,
  onMessage,
  onBookingChange,
  onSignIn,
  signInPath = "/login",
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [selection, setSelection] = useState(null);
  // The stretch of the day picked, { start, end }, where the item is booked by
  // the time.
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState("");
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [dayPrice, setDayPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [photo, setPhoto] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [sharing, setSharing] = useState(false);
  // How big each photograph really is, by its address, learned as it loads —
  // for the ones whose size was not written down when they were uploaded.
  const [natural, setNatural] = useState({});

  // Opened to ask for it rather than to read it — from the Request button on
  // the map — the page arrives with its booking card in view. On a wide window
  // the card is already beside the title and this moves nothing; on a phone it
  // is a screen or two down, past the photographs.
  const cardRef = useRef(null);
  useEffect(() => {
    if (focusBooking) cardRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    // Once, when the page is first drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mine = item.mine;
  const bySlot = item.mode === "time";
  const states = useMemo(() => dayStates(calendar, bookings), [calendar, bookings]);
  const free = useMemo(() => nextFreeDay(item, calendar), [item, calendar]);
  const price = useMemo(
    () => (bySlot ? null : quote(item, calendar, bookings, selection)),
    [bySlot, item, calendar, bookings, selection],
  );
  const slots = bySlot && selection ? slotStates(item, states, selection.start) : [];
  // The half hours of the stretch picked, each costing half of what an hour
  // costs then.
  const chosenSlots = picked ? slots.filter((slot) => slot.start >= picked.start && slot.start < picked.end && !slot.taken) : [];
  const slotTotal = Math.round(chosenSlots.reduce((sum, slot) => sum + (slot.price * STEP) / 60, 0) * 100) / 100;
  // Picked up and brought back on the same day, it has to come back later than
  // it went out.
  const timesWrong =
    !bySlot && Boolean(selection) && (!startTime || !endTime || (selection.start === selection.end && startTime >= endTime));
  const ready = bySlot ? chosenSlots.length > 0 : Boolean(price) && !timesWrong;
  const total = bySlot ? slotTotal : price?.total;
  const url = `${window.location.origin}/i/${item.id}`;

  function select(next) {
    setSelection(next);
    setPicked(null);
    setFormError("");
  }

  async function book(event) {
    event.preventDefault();
    if (preview) return;
    if (!viewer) return onSignIn?.();
    if (!selection || !ready || busy) return;
    setBusy(true);
    setFormError("");
    try {
      await onBook({
        start: selection.start,
        end: selection.end,
        startTime: bySlot ? picked.start : startTime,
        endTime: bySlot ? picked.end : endTime,
        note: note.trim(),
      });
      select(null);
      setNote("");
    } catch (error) {
      setFormError(
        error.code === "DAYS_UNAVAILABLE" || error.code === "TIME_UNAVAILABLE"
          ? t("booking.unavailable")
          : error.code === "ALREADY_REQUESTED"
            ? t("booking.already")
            : error.code === "TIME_REQUIRED" || error.code === "TIME_ORDER"
              ? t("booking.timeOrder")
              : error.message,
      );
    } finally {
      setBusy(false);
    }
  }

  // The owner's answer about the days picked out: closed, open again, at a
  // price of their own, or back to the usual one.
  async function changeDays(change) {
    if (!selection || busy || preview) return;
    const days = [];
    for (let day = selection.start; day <= selection.end; day = addDays(day, 1)) days.push(day);
    setBusy(true);
    setFormError("");
    try {
      await onChangeDays({ days, ...change });
      select(null);
      setDayPrice("");
    } catch (error) {
      setFormError(
        error.code === "DAY_BOOKED"
          ? t("calendar.dayBooked", { date: formatDay(error.day ?? selection.start, lang) })
          : error.message,
      );
    } finally {
      setBusy(false);
    }
  }

  const chosen = selection
    ? bySlot
      ? [
          formatDay(selection.start, lang, { weekday: "short", month: "short", day: "numeric" }),
          picked && `${picked.start}–${picked.end}`,
          picked && t("calendar.hours", { count: (minutesOf(picked.end) - minutesOf(picked.start)) / 60 }),
        ]
          .filter(Boolean)
          .join(" · ")
      : t("calendar.chosen", {
          dates: formatRange(selection.start, selection.end, lang),
          count: countDays(selection.start, selection.end),
        })
    : "";
  const shownPhoto = item.images[Math.min(photo, item.images.length - 1)];
  // A photograph is never drawn larger than it is: stretched past its own
  // pixels it goes soft, and a small sharp picture reads better than a big
  // blurred one. The frame crops to fill, so it is the frame that is held —
  // no wider than the picture, and no wider than would make its height more
  // than the picture's at the taller of the two shapes the frame takes (4:3).
  // Inside a frame that is within the picture both ways, filling it can only
  // ever shrink the picture.
  const size = shownPhoto && {
    width: shownPhoto.width ?? natural[shownPhoto.src]?.width,
    height: shownPhoto.height ?? natural[shownPhoto.src]?.height,
  };
  const photoLimit = size?.width && size?.height ? Math.floor(Math.min(size.width, (size.height * 4) / 3)) : undefined;
  const status = !item.active
    ? t("item.inactive")
    : free === today()
      ? t("item.freeToday")
      : free
        ? t("item.freeFrom", { date: formatDay(free, lang) })
        : t("item.noDays");

  return (
    <article className={styles.page}>
      <div className={styles.columns}>
        <header className={styles.head}>
          <p className={styles.tags}>
            <span>
              <CategoryIcon kind={item.kind} category={item.category} />
              {item.category ? t(`category.${item.category}`, item.category) : t(`kind.${item.kind}`)}
            </span>
            {item.category && <span>{t(`kind.${item.kind}`)}</span>}
          </p>
          <h1 className={styles.title}>{item.title}</h1>
          <p className={styles.meta}>
            {preview ? (
              <span>{formatUsername(item.owner)}</span>
            ) : (
              <Link to={`/u/${encodeURIComponent(item.owner)}`}>{formatUsername(item.owner)}</Link>
            )}
            {item.place && <span>{item.place}</span>}
            {item.region && item.region.name !== item.place && <span>{item.region.name}</span>}
            {item.createdAt && <span>{relativeTime(item.createdAt, lang, t)}</span>}
          </p>
          {/* The photographs come after the name, not before it: the page says
              what the thing is and then shows it. */}
          {shownPhoto && (
            <div className={styles.gallery}>
              <button
                type="button"
                className={styles.photo}
                style={{ maxWidth: photoLimit }}
                onClick={() => setZoomed(true)}
                aria-label={t("item.photoOpen")}
              >
                <img
                  src={shownPhoto.src}
                  alt={item.title}
                  onLoad={(event) => {
                    const { naturalWidth: width, naturalHeight: height, src } = event.currentTarget;
                    if (!width || !height) return;
                    const key = shownPhoto.src;
                    setNatural((known) => (known[key] ? known : { ...known, [key]: { width, height, src } }));
                  }}
                />
                {item.images.length > 1 && (
                  <span className={styles.photoCount}>
                    {Math.min(photo, item.images.length - 1) + 1}/{item.images.length}
                  </span>
                )}
              </button>
              {item.images.length > 1 && (
                <div className={styles.thumbs}>
                  {item.images.map((image, index) => (
                    <button
                      key={image.src}
                      type="button"
                      className={index === photo ? `${styles.thumb} ${styles.thumbChosen}` : styles.thumb}
                      onClick={() => setPhoto(index)}
                      aria-label={`${index + 1}/${item.images.length}`}
                    >
                      <img src={image.thumb} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </header>

        {/* ------------------------------------------------- the booking card */}
        <aside className={styles.card} ref={cardRef}>
          <p className={styles.price}>
            <strong>{formatPrice(item.price, item.currency, lang)}</strong>
            <span>{bySlot ? t("item.anHour") : t("item.aDay")}</span>
            <span className={`status ${item.active && free === today() ? "status-confirmed" : "status-pending"}`}>
              {status}
            </span>
          </p>

          {/* Getting the page in front of people is half of what it is for, so
              the way to do it is the first control on the card and the one
              drawn loudest. */}
          <div className={styles.actions}>
            <button type="button" className="small-button filled" onClick={() => setSharing(true)} disabled={preview}>
              <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 15V4" />
                <path d="m8 8 4-4 4 4" />
                <path d="M5 12v7h14v-7" />
              </svg>
              {t("item.share")}
            </button>
            {mine ? (
              <button type="button" className="small-button" onClick={onEdit} disabled={preview}>
                {t("item.edit")}
              </button>
            ) : (
              <button
                type="button"
                className="small-button"
                onClick={() => (viewer ? onMessage?.(item.owner) : onSignIn?.())}
                disabled={preview}
              >
                {t("messages.write", { name: formatUsername(item.owner) })}
              </button>
            )}
          </div>

          <div className={styles.calendarHead}>
            <h2>{t("calendar.title")}</h2>
            <span>{mine ? t("calendar.yours") : bySlot ? t("calendar.perHour") : t("calendar.perDay")}</span>
          </div>
          <Calendar
            item={item}
            calendar={calendar}
            bookings={bookings}
            selection={selection}
            // A stranger to an item that has been taken down can read its
            // calendar and cannot pick from it.
            onSelect={mine || item.active ? select : undefined}
            editing={mine}
          />

          {/* The hours of the day picked, where the item goes by the time: a
              timetable of that day. The owner reads it; anybody else presses
              the time they want it from and the time they want it until. */}
          {bySlot && selection && selection.start === selection.end && (
            <DayTimes
              cells={slots}
              value={picked}
              onChange={mine ? undefined : setPicked}
              currency={item.currency}
            />
          )}

          {mine ? (
            <div className={styles.panel}>
              <p className={styles.chosen}>{selection ? chosen : t("calendar.pickToEdit")}</p>
              {selection && (
                <>
                  <div className={styles.buttons}>
                    <button type="button" className="small-button" disabled={busy || preview} onClick={() => changeDays({ available: false })}>
                      {t("calendar.close")}
                    </button>
                    <button type="button" className="small-button" disabled={busy || preview} onClick={() => changeDays({ available: true, price: null })}>
                      {t("calendar.open")}
                    </button>
                  </div>
                  {/* A price for these days in particular, which only means
                      something where the item is priced by the day. */}
                  {!bySlot && (
                    <form
                      className={styles.priceRow}
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (dayPrice.trim() !== "") changeDays({ available: true, price: Number(dayPrice) });
                      }}
                    >
                      <input
                        className="text-input mono"
                        value={dayPrice}
                        onChange={(event) => setDayPrice(event.target.value.replace(/[^\d.]/g, ""))}
                        inputMode="decimal"
                        placeholder={t("calendar.pricePlaceholder", { currency: item.currency })}
                        aria-label={t("calendar.setPrice")}
                        maxLength={12}
                      />
                      <button type="submit" className="small-button" disabled={busy || preview || dayPrice.trim() === ""}>
                        {t("calendar.setPrice")}
                      </button>
                    </form>
                  )}
                </>
              )}
              {formError && <p className="form-message error">{formError}</p>}
            </div>
          ) : item.active ? (
            <form className={styles.panel} onSubmit={book}>
              <p className={styles.chosen}>
                {!selection ? (
                  bySlot ? (
                    t("calendar.pickDay")
                  ) : (
                    t("calendar.pick")
                  )
                ) : (
                  <>
                    <span>{bySlot && !picked ? `${chosen} · ${t("calendar.pickSlots")}` : chosen}</span>
                    {(bySlot ? ready : Boolean(price)) && <strong>{formatPrice(total, item.currency, lang)}</strong>}
                  </>
                )}
              </p>
              {/* Everything a request is made of stands here from the start, so
                  the card says what asking involves before a day is picked —
                  greyed and out of reach until one is. */}
              <fieldset className={styles.fields} disabled={!selection}>
                {/* The hours, where the item goes by the day: when it is
                    picked up on the first day and brought back on the last. */}
                {!bySlot && (
                  <div className={styles.times}>
                    <label>
                      <span>
                        {t("booking.pickupTime")}
                        {selection && ` · ${formatDay(selection.start, lang)}`}
                      </span>
                      <input
                        type="time"
                        className="text-input mono"
                        value={startTime}
                        onChange={(event) => setStartTime(event.target.value)}
                        step={300}
                        required
                      />
                    </label>
                    <label>
                      <span>
                        {t("booking.returnTime")}
                        {selection && ` · ${formatDay(selection.end, lang)}`}
                      </span>
                      <input
                        type="time"
                        className="text-input mono"
                        value={endTime}
                        onChange={(event) => setEndTime(event.target.value)}
                        step={300}
                        required
                      />
                    </label>
                  </div>
                )}
                {timesWrong && <p className="form-message error">{t("booking.timeOrder")}</p>}
                <TextArea
                  className="text-area"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("booking.notePlaceholder", { name: formatUsername(item.owner) })}
                  maxLength={NOTE_MAX}
                  rows={2}
                  minHeight={56}
                />
                <button type="submit" className="primary-button" disabled={busy || !ready || preview}>
                  {viewer || preview ? t("booking.request") : t("booking.signIn")}
                </button>
                <p className={styles.small}>{t("booking.explain")}</p>
              </fieldset>
              {formError && <p className="form-message error">{formError}</p>}
            </form>
          ) : (
            <p className={styles.small}>{t("item.inactiveNote")}</p>
          )}
        </aside>

        <div className={styles.rest}>
          {/* What its owner wrote about it, under a heading and a rule like
              the parts after it. */}
          {item.description && (
            <>
              <div className={`part-heading ${styles.first}`}>
                <h2>{t("item.description")}</h2>
              </div>
              <p className={styles.description}>{item.description}</p>
            </>
          )}

          {/* -------------------------------------------------- location */}
          {item.located && (
            <>
              <div className="part-heading">
                <h2>{t("item.location")}</h2>
                <span>{formatCoords(item.latitude, item.longitude)}</span>
              </div>
              <div className={styles.map}>
                <SpotMap latitude={item.latitude} longitude={item.longitude} />
              </div>
              <p className={styles.meta}>
                {item.place && <span>{item.place}</span>}
                <a href={directionsUrl(item.latitude, item.longitude)} target="_blank" rel="noreferrer noopener">
                  {t("item.openMaps")}
                  <span aria-hidden="true"> ↗</span>
                </a>
              </p>
            </>
          )}

          {/* ---------------------------------------------------- status */}
          {!preview && (
            <>
              <div className="part-heading">
                <h2>{mine ? t("booking.requests") : t("booking.yours")}</h2>
                {bookings.length > 0 && <span>{bookings.length}</span>}
              </div>
              {!viewer ? (
                <p className="part-note">
                  <Link to={signInPath}>{t("header.signIn")}</Link> {t("booking.signedOut")}
                </p>
              ) : bookings.length === 0 ? (
                <p className="part-note">{mine ? t("booking.requestsEmpty") : t("booking.yoursEmpty")}</p>
              ) : (
                <ul className="row-list">
                  {bookings.map((booking) => (
                    <BookingRow
                      key={booking.id}
                      booking={booking}
                      about="dates"
                      onChange={onBookingChange}
                      onMessage={onMessage}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      <ShareModal isOpen={sharing} onClose={() => setSharing(false)} title={item.title} url={url} slug={item.id} />
      <Modal isOpen={zoomed && Boolean(shownPhoto)} title={item.title} onClose={() => setZoomed(false)} closeOnOverlay large>
        {shownPhoto && <img className={styles.zoomed} src={shownPhoto.src} alt={item.title} />}
      </Modal>
    </article>
  );
}
