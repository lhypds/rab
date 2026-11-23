import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Modal, Select, TextArea, showToast } from "../../ui/index.js";
import { cancelLine } from "../../utils/bookings.js";
import { addDays, countDays, formatDay, formatRange, today } from "../../utils/days.js";
import { barePhone, formatCoords, formatPrice, formatUsername, relativeTime, unitName } from "../../utils/format.js";
import { contactHref } from "../../utils/dialing.js";
import { MESSAGES_EVENT } from "../Header/Header.jsx";
import { directionsUrl } from "../../utils/mapbox.js";
import { DAY_UNIT, cellsOn, clockOf, dayPrice as ruledDayPrice, inquiryUnitOf, minutesOf, priceNow, priceUnitOf, unitOf } from "../../utils/rates.js";
import Calendar, { dayStates, quote, slotStates } from "../Calendar/index.js";
import CategoryIcon from "../CategoryIcon/index.js";
import { Rating } from "../ReviewModal/index.js";
import { BookingRow } from "../Rows/index.js";
import { isAdmin } from "../../utils/admin.js";
import ReportModal from "../ReportModal/index.js";
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
// The times of day that can be picked for a start or an end: every quarter of
// an hour, in the house dropdown rather than the system's own time field —
// which is drawn differently by every browser and by none of them in this
// app's hand.
const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const time = clockOf(index * 15);
  return { value: time, label: time };
});

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
  reviews = [],
  viewer = null,
  preview = false,
  focusBooking = false,
  onBook,
  onSetActive,
  onDelete,
  onEdit,
  onEditAvailability,
  onMessage,
  onBookmark,
  onBookingChange,
  onSignIn,
  signInPath = "/login",
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // The page opens with today picked, since today is what is asked about
  // first: always for the owner, who can pick any day to change it, and for
  // anybody else where today can still be had — a day that cannot be asked for
  // is not one to start them on.
  const [selection, setSelection] = useState(() => {
    const day = today();
    const pickable = item.mine || (item.active && calendar && nextFreeDay(item, calendar) === day);
    return pickable ? { start: day, end: day } : null;
  });
  // The stretch of the day picked, { start, end }, where the item is booked by
  // the time.
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState("");
  // Whether the owner has pressed Delete and is being asked if they mean it.
  const [confirming, setConfirming] = useState(false);
  // The hours of the day it is handed over in, where it says any: the times
  // to choose between are the ones inside them, and the two the form starts
  // with are brought inside them too.
  const band = item.dayHours ?? null;
  const within = (time) => (!band ? time : time < band.start ? band.start : time > band.end ? band.end : time);
  const dayTimes = band ? TIME_OPTIONS.filter((option) => option.value >= band.start && option.value <= band.end) : TIME_OPTIONS;
  const [startTime, setStartTime] = useState(() => within(DEFAULT_START_TIME));
  const [endTime, setEndTime] = useState(() => within(DEFAULT_END_TIME));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [photo, setPhoto] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Whether the reader has kept the item among their bookmarks: what the page
  // came saying, and from then on what the button was last pressed to.
  const [bookmarked, setBookmarked] = useState(item.bookmarked === true);
  const [bookmarking, setBookmarking] = useState(false);
  // The page asked for again — signed in since, say — says it afresh.
  useEffect(() => setBookmarked(item.bookmarked === true), [item.bookmarked]);
  const toggleBookmark = async () => {
    if (!viewer) return onSignIn?.();
    const on = !bookmarked;
    setBookmarking(true);
    setBookmarked(on);
    try {
      await onBookmark?.(on);
    } catch (error) {
      setBookmarked(!on);
      showToast(error.message, 2400);
    } finally {
      setBookmarking(false);
    }
  };
  // Whether the sheet a report about the item is sent to the administrator
  // from is open: "report", or null.
  const [posting, setPosting] = useState(null);
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
  // Booked by asking: no calendar and no request — the card says how the
  // owner is reached, and the two sides arrange it themselves.
  const inquiry = item.mode === "inquiry";
  // Somebody else's, written down by an account that does not have it: any
  // account may change it or delete it, and nobody can switch it off.
  const shared = item.shared === true;
  // The account that looks after the site: it may change any item as its own
  // account may — edit it, say when it can be had, switch it off, delete it —
  // somebody else's included, and is the one everybody else's reports and
  // requests go to.
  const admin = isAdmin(viewer) && !preview;
  const canEdit = mine || admin || (shared && Boolean(viewer) && !preview);
  const contacts = item.contacts ?? [];
  // Where asking by the way written first goes, or null where that way is not
  // one that can be pressed (an address).
  const askHref = contactHref(contacts[0], item.title);
  const states = useMemo(() => dayStates(calendar, bookings), [calendar, bookings]);
  const free = useMemo(() => nextFreeDay(item, calendar), [item, calendar]);
  // The figure at the head of the card: what it costs today, at this hour.
  // The calendar is asked first for a price the owner gave today's date, since
  // it is kept fresh as they change it and the item's own copy is not.
  const todayRow = calendar?.days?.find((row) => row.day === today());
  const priceToday = bySlot
    ? priceNow(item)
    : todayRow?.available && todayRow.price != null
      ? todayRow.price
      : ruledDayPrice(item, today());
  // By the time, today's hours need not all cost the same: the figure is then
  // from the least of them to the most, the currency's mark written once.
  // A day with no hours has only the price in force now.
  const todayPrices = bySlot ? cellsOn(item, today()).map((cell) => cell.price) : [];
  const lowToday = todayPrices.length > 0 ? Math.min(...todayPrices) : priceToday;
  const highToday = todayPrices.length > 0 ? Math.max(...todayPrices) : priceToday;
  const priceOnRequest = inquiry && item.price == null;
  const priceHead =
    highToday === lowToday
      ? formatPrice(lowToday, item.currency, lang)
      : `${formatPrice(lowToday, item.currency, lang)}–${formatPrice(highToday, item.currency, lang).replace(/^[^\d]+/, "")}`;
  const price = useMemo(
    () => (bySlot ? null : quote(item, calendar, bookings, selection)),
    [bySlot, item, calendar, bookings, selection],
  );
  const slots = bySlot && selection ? slotStates(item, states, selection.start) : [];
  // The one day whose hours the timetable shows, where there is one: a day has
  // been picked, and the item has not been switched off.
  const day = bySlot && item.active && selection && selection.start === selection.end ? selection.start : null;
  // The pieces of the stretch picked, each costing its share of the price in
  // force then, which is for one stretch of the pricing unit.
  const chosenSlots = picked ? slots.filter((slot) => slot.start >= picked.start && slot.start < picked.end && !slot.taken) : [];
  const slotTotal = Math.round(chosenSlots.reduce((sum, slot) => sum + (slot.price * unitOf(item)) / priceUnitOf(item), 0) * 100) / 100;
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
  // The whole item, switched off or on at once: off, nobody can ask for any
  // of it and it is not listed; on, it is as its calendar says again.
  async function setActive(active) {
    if (busy || preview) return;
    setBusy(true);
    setFormError("");
    try {
      await onSetActive(active);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }

  // Deleting is asked twice: the button, then the answer to "delete it?".
  async function remove() {
    if (busy || preview) return;
    setBusy(true);
    setFormError("");
    try {
      await onDelete?.();
    } catch (error) {
      setFormError(error.message);
      setConfirming(false);
      setBusy(false);
    }
  }

  const chosen = selection
    ? bySlot
      ? [
          formatDay(selection.start, lang, { weekday: "short", month: "short", day: "numeric" }),
          picked && `${picked.start}–${picked.end}`,
          // In hours where it comes to whole or half ones, and in minutes
          // where the item's unit cuts finer than that.
          picked &&
            ((minutesOf(picked.end) - minutesOf(picked.start)) % 30 === 0
              ? t("calendar.hours", { count: (minutesOf(picked.end) - minutesOf(picked.start)) / 60 })
              : t("calendar.minutes", { count: minutesOf(picked.end) - minutesOf(picked.start) })),
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
    : inquiry
      ? t("item.byInquiry")
      : free === today()
      ? t("item.freeToday")
      : free
        ? t("item.freeFrom", { date: formatDay(free, lang) })
        : t("item.noDays");

  // The buttons at the foot of the card, for whoever may change the item. One
  // for the whole item: it can be had, or it cannot — which is not asked of
  // somebody else's, since that is its owner's to say. And beside it, at the
  // right, the way to be rid of the item altogether, in red and asked twice.
  // Somebody else's is not deleted by whoever is reading it, and has no
  // buttons here: having it deleted is asked of the administrator in a report.
  const removal = shared && !admin ? null : confirming ? (
    <div className={styles.buttons}>
      <span className={styles.confirm}>{t("item.deleteConfirm")}</span>
      <button type="button" className="small-button" disabled={busy} onClick={() => setConfirming(false)}>
        {t("common.cancel")}
      </button>
      <button type="button" className={`small-button ${styles.danger} ${styles.dangerFilled}`} disabled={busy} onClick={remove}>
        {t("item.delete")}
      </button>
    </div>
  ) : (
    <div className={styles.buttons}>
      {/* Where there is no such button, Delete stands alone at the left edge:
          nothing empty is left in its place to hold a gap open. */}
      {((mine && !shared) || admin) && (
        <button type="button" className="small-button" disabled={busy || preview} onClick={() => setActive(!item.active)}>
          {item.active ? t("calendar.close") : t("calendar.open")}
        </button>
      )}
      <button type="button" className={`small-button ${styles.danger}`} disabled={busy || preview} onClick={() => setConfirming(true)}>
        {t("item.delete")}
      </button>
    </div>
  );

  return (
    <article className={styles.page}>
      <div className={styles.columns}>
        <header className={styles.head}>
          <p className={styles.tags}>
            <span>
              <CategoryIcon kind={item.kind} category={item.category} />
              {item.category ? t(`category.${item.category}`, item.category) : t(`kind.${item.kind}`)}
            </span>
            {/* One with a category says that and not its kind as well: the
                category is within the kind, and says more. */}
          </p>
          <h1 className={styles.title}>{item.title}</h1>
          <p className={styles.meta}>
            {/* Whose account it is under — not said of somebody else's,
                which is nobody's by name. */}
            {shared || !item.owner ? null : preview ? (
              <span>{formatUsername(item.owner)}</span>
            ) : (
              <Link to={`/u/${encodeURIComponent(item.owner)}`}>{formatUsername(item.owner)}</Link>
            )}
            {item.place && <span>{item.place}</span>}
            {[item.region, ...(item.moreRegions ?? [])]
              .filter((region) => region && region.name !== item.place)
              .map((region) => (
                <span key={`${region.name}|${region.bbox.join()}`}>{region.name}</span>
              ))}
            {item.createdAt && <span>{relativeTime(item.createdAt, lang, t)}</span>}
          </p>
          {/* What the people who rented it gave it: nothing to say of a draft. */}
          {!preview && (
            <p className={styles.rating}>
              <Rating rating={item.rating} reviews={reviews} />
            </p>
          )}
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
            <strong>{priceOnRequest ? t("item.priceOnRequest") : priceHead}</strong>
            {!priceOnRequest && (
              <span>
                {bySlot
                  ? t("item.anHour", { unit: unitName(priceUnitOf(item), t) })
                  : inquiry && inquiryUnitOf(item) !== DAY_UNIT
                    ? t("item.anHour", { unit: unitName(inquiryUnitOf(item), t) })
                    : t("item.aDay")}
              </span>
            )}
            <span className={`status ${item.active && (inquiry || free === today()) ? "status-confirmed" : "status-pending"}`}>
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
            {/* Keeping it to come back to: it is then on the reader's list of
                bookmarks (see /others), until the button is pressed again.
                Not for the account it is under, whose own it is already. */}
            {!mine && (
              <button
                type="button"
                className="small-button"
                aria-pressed={bookmarked}
                onClick={toggleBookmark}
                disabled={preview || bookmarking}
              >
                <svg className={bookmarked ? `${styles.icon} ${styles.iconOn}` : styles.icon} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 4h12v17l-6-4.5L6 21z" />
                </svg>
                {t(bookmarked ? "item.bookmarked" : "item.bookmark")}
              </button>
            )}
            {canEdit && (
              <>
                <button type="button" className="small-button" onClick={onEdit} disabled={preview}>
                  {t("item.editTitle")}
                </button>
                {/* When it can be had and what it costs, which is a sheet of
                    its own apart from the one the item is edited on. */}
                <button type="button" className="small-button" onClick={onEditAvailability} disabled={preview}>
                  {t("item.availabilityTitle")}
                </button>
              </>
            )}
            {/* Writing to its owner — where it has one by name. */}
            {!mine && item.owner && !shared && (
              <button
                type="button"
                className="small-button"
                onClick={() => (viewer ? onMessage?.(item.owner) : onSignIn?.())}
                disabled={preview}
              >
                {t("messages.write", { name: formatUsername(item.owner) })}
              </button>
            )}
            {/* Saying something is wrong with it, to the administrator: for
                anybody but the account it is under, and the administrator. */}
            {!mine && !admin && (
              <button
                type="button"
                className="small-button"
                onClick={() => (viewer ? setPosting("report") : onSignIn?.())}
                disabled={preview}
              >
                {t("item.report")}
              </button>
            )}
          </div>

          {/* Somebody else's: said, with what follows from it. */}
          {shared && <p className={styles.small}>{t("item.sharedNote")}</p>}

          {/* Where it is, for one that stands somewhere: the spot on a map, and
              under it the address and the way there. Over how its owner is
              reached, since where to go is asked before whom to ask. */}
          {item.located && (
            <div className={styles.accessPart}>
              {/* Headed as the contacts under it are: in the page's own type. */}
              <div className={`${styles.calendarHead} ${styles.contactHead}`}>
                <h2>{t("item.access")}</h2>
                <span>{formatCoords(item.latitude, item.longitude)}</span>
              </div>
              <div className={styles.accessMap}>
                <SpotMap latitude={item.latitude} longitude={item.longitude} />
              </div>
              <p className={styles.access}>
                {item.place && <span>{item.place}</span>}
                <a href={directionsUrl(item.latitude, item.longitude)} target="_blank" rel="noreferrer noopener">
                  {t("item.openMaps")}
                  <span aria-hidden="true"> ↗</span>
                </a>
              </p>
            </div>
          )}

          {/* Its own page somewhere else, where it has one: the address, which
              is pressed to go there. Over how its owner is reached. */}
          {item.homepage && (
            <>
              <div className={`${styles.calendarHead} ${styles.contactHead}`}>
                <h2>{t("item.homepage")}</h2>
              </div>
              <p className={styles.homepage}>
                <a href={item.homepage} target="_blank" rel="noreferrer noopener">
                  <span>{item.homepage.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</span>
                  {/* And the mark of a page that opens somewhere else. */}
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
                  </svg>
                </a>
              </p>
            </>
          )}

          {/* Booked by asking, the card has no calendar: in its place, how the
              owner is reached — the first way, then the second. A number
              and an email address are pressed to call or to write. */}
          {/* One booked by the date or the time says how its owner is reached
              too, over its calendar, where it says any way at all. */}
          {(inquiry || contacts.length > 0) && (
            <>
              <div className={`${styles.calendarHead} ${styles.contactHead}`}>
                <h2>{t("item.contact")}</h2>
              </div>
              {item.active || mine ? (
                <dl className={styles.contacts}>
                  {contacts.map((contact, index) => (
                    <div key={index}>
                      <dt>{t(`item.contactTypes.${contact.type}`)}</dt>
                      <dd>
                        {contact.type === "message" ? (
                          // A message here on rab: the line that says so is
                          // pressed to write one — to the owner, by whoever
                          // is reading; the owner's own page opens the
                          // messages they have. A preview goes nowhere.
                          preview ? (
                            t("item.contactMessageNote")
                          ) : (
                            <button
                              type="button"
                              className={styles.contactWrite}
                              onClick={() => {
                                if (!viewer) onSignIn?.();
                                else if (mine || !item.owner) window.dispatchEvent(new Event(MESSAGES_EVENT));
                                else onMessage?.(item.owner);
                              }}
                            >
                              {t("item.contactMessageNote")}
                            </button>
                          )
                        ) : contact.type === "phone" ? (
                          <a href={contactHref(contact)}>
                            {contact.code ? `${contact.code} ` : ""}
                            {barePhone(contact.value)}
                          </a>
                        ) : contactHref(contact) ? (
                          <a href={contactHref(contact)}>{contact.value}</a>
                        ) : (
                          contact.value
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {inquiry && item.active && !mine && <p className={styles.small}>{shared || !item.owner ? t("item.inquiryExplainShared") : t("item.inquiryExplain", { name: formatUsername(item.owner) })}</p>}
            </>
          )}

          {!inquiry && (
          <>
          <div className={styles.calendarHead}>
            <h2>{t("calendar.title")}</h2>
            <span>{mine ? t("calendar.yours") : bySlot ? t("calendar.perHour", { unit: unitName(priceUnitOf(item), t) }) : t("calendar.perDay")}</span>
          </div>
          <Calendar
            item={item}
            calendar={calendar}
            bookings={bookings}
            selection={selection}
            // An item that has been switched off can be read and not picked
            // from, by its owner as by anybody else: every day of it is drawn
            // closed until it is switched on again.
            onSelect={item.active ? select : undefined}
            off={!item.active}
            editing={mine}
          />
          {/* By the time, what the prices on the squares above are for: one stretch of the item's pricing unit. */}
          {bySlot && <p className={`${styles.small} ${styles.tip}`}>{t("calendar.unit", { unit: unitName(priceUnitOf(item), t) })}</p>}

          {/* The hours of the day picked, where the item goes by the time: a
              timetable of that day. The owner reads it; anybody else presses
              the time they want it from and the time they want it until. */}
          {/* Only once a day is picked: until then there is no day whose
              hours it could show. */}
          {day && (
            <>
              <DayTimes
                // Drawn afresh for each day picked, so each opens scrolled to
                // its own hours.
                key={day}
                cells={slots}
                value={picked}
                onChange={mine ? undefined : setPicked}
                currency={item.currency}
                unit={unitOf(item)}
                today={day === today()}
              />
              {/* And the piece of the clock it is asked for in. */}
              <p className={`${styles.small} ${styles.tip}`}>{t("calendar.bookingUnit", { unit: unitName(unitOf(item), t) })}</p>
            </>
          )}
          </>
          )}

          {mine ? (
            <div className={styles.panel}>
              {/* The days picked, said back. Nothing is changed about them
                  here: what a day costs and whether it can be had are the
                  item form's to set. */}
              {item.active ? !inquiry && selection && <p className={styles.chosen}>{chosen}</p> : <p className={styles.small}>{t("item.inactiveNote")}</p>}
              {removal}
              {formError && <p className="form-message error">{formError}</p>}
            </div>
          ) : inquiry ? (
            !item.active ? (
              <p className={styles.small}>{t("item.inactiveNote")}</p>
            ) : (
              // Somebody else's has no request to send: the button where one
              // would be asks the way written first — a phone number is
              // called, an email address written to, about the item.
              shared &&
              askHref && (
                <div className={styles.panel}>
                  {preview ? (
                    <button type="button" className="primary-button" disabled>
                      {t("booking.request")}
                    </button>
                  ) : (
                    <a className={`primary-button ${styles.ask}`} href={askHref}>
                      {t("booking.request")}
                    </a>
                  )}
                </div>
              )
            )
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
                {!bySlot && band && (
                  <p className={styles.small}>{t("booking.dayHours", { start: band.start, end: band.end })}</p>
                )}
                {!bySlot && (
                  <div className={styles.times}>
                    <div>
                      <span>
                        {t("booking.pickupTime")}
                        {selection && ` · ${formatDay(selection.start, lang)}`}
                      </span>
                      <Select
                        label={t("booking.pickupTime")}
                        value={startTime}
                        onChange={setStartTime}
                        options={dayTimes}
                        searchPlaceholder={t("booking.timeSearch")}
                        emptyLabel={t("booking.timeNoMatch")}
                      />
                    </div>
                    <div>
                      <span>
                        {t("booking.returnTime")}
                        {selection && ` · ${formatDay(selection.end, lang)}`}
                      </span>
                      <Select
                        label={t("booking.returnTime")}
                        value={endTime}
                        onChange={setEndTime}
                        options={dayTimes}
                        searchPlaceholder={t("booking.timeSearch")}
                        emptyLabel={t("booking.timeNoMatch")}
                      />
                    </div>
                  </div>
                )}
                {timesWrong && <p className="form-message error">{t("booking.timeOrder")}</p>}
                <TextArea
                  className="text-area"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={
                    shared || !item.owner ? t("booking.notePlaceholderShared") : t("booking.notePlaceholder", { name: formatUsername(item.owner) })
                  }
                  maxLength={NOTE_MAX}
                  rows={2}
                  minHeight={56}
                />
                <button type="submit" className="primary-button" disabled={busy || !ready || preview}>
                  {viewer || preview ? t("booking.request") : t("booking.signIn")}
                </button>
                <p className={styles.small}>{t("booking.explain")}</p>
                {/* And what is being agreed to about calling it off. */}
                <p className={`${styles.small} ${styles.tip}`}>{cancelLine(item.cancel, t)}</p>
              </fieldset>
              {formError && <p className="form-message error">{formError}</p>}
            </form>
          ) : (
            <p className={styles.small}>{t("item.inactiveNote")}</p>
          )}
          {/* Whoever may change an item that is not their own — anybody
              the admin, for any — has the way to be rid of it here: the same
              buttons its own account has. */}
          {!mine && canEdit && removal && (
            <div className={styles.panel}>
              {removal}
              {/* Where there is no request form above to say it in. */}
              {(inquiry || !item.active) && formError && <p className="form-message error">{formError}</p>}
            </div>
          )}
        </aside>

        <div className={styles.rest}>
          {/* What its owner wrote about it, under a heading and a rule like
              the parts after it. */}
          <div className={`part-heading ${styles.first}`}>
            <h2>{t("item.description")}</h2>
          </div>
          {item.description ? (
            <p className={styles.description}>{item.description}</p>
          ) : (
            <p className="part-note">{t("item.descriptionEmpty")}</p>
          )}

          {/* ---------------------------------------------------- status */}
          {/* Booked by asking, there are no requests to list — unless some
              were made before it was turned to that. */}
          {!preview && (!inquiry || bookings.length > 0) && (
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

      <ReportModal item={item} mode={posting} onClose={() => setPosting(null)} />
      <ShareModal isOpen={sharing} onClose={() => setSharing(false)} title={item.title} url={url} slug={item.id} />
      <Modal isOpen={zoomed && Boolean(shownPhoto)} title={item.title} onClose={() => setZoomed(false)} closeOnOverlay large>
        {shownPhoto && <img className={styles.zoomed} src={shownPhoto.src} alt={item.title} />}
      </Modal>
    </article>
  );
}
