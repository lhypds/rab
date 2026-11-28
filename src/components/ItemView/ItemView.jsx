import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ActionButton, Link, Modal, Select, TextArea, showToast } from "../../ui/index.js";
import { cancelLine } from "../../utils/bookings.js";
import { addDays, countDays, formatDay, formatRange, today } from "../../utils/days.js";
import { barePhone, durationName, forSale, formatCoords, formatPrice, formatUsername, relativeTime, roundPrice, unitName } from "../../utils/format.js";
import { contactHref } from "../../utils/dialing.js";
import { MESSAGES_EVENT } from "../Header/Header.jsx";
import { directionsUrl } from "../../utils/mapbox.js";
import { DAY_UNIT, cellsOn, clockOf, dayBands, hoursOn, dayPrice as ruledDayPrice, inBands, inquiryUnitOf, minDurationOf, minutesOf, priceNow, priceUnitOf, unitOf } from "../../utils/rates.js";
import Calendar, { dayStates, quote, reading, slotStates } from "../Calendar/index.js";
import CategoryIcon from "../CategoryIcon/index.js";
import { Rating } from "../ReviewModal/index.js";
import { BookingRow, ItemCard, ItemRow } from "../Rows/index.js";
import { itemPath } from "../../utils/spots.js";
import { sortLabel } from "../../utils/categories.js";
import { isAdmin } from "../../utils/admin.js";
import ReportModal from "../ReportModal/index.js";
import ShareModal from "../ShareModal/index.js";
import SpotMap from "../SpotMap/index.js";
import { DayTimes } from "../TimeTable/index.js";
import styles from "./view.module.css";

// Where the layout picked for a spot's items is kept in the browser.
const ITEMS_VIEW_KEY = "rab.spotItemsView";

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

// When something of it can next be had — { day, time, now } — or null where
// the calendar has none left: the one-line answer to "is it free?". `time` is
// the hour of that day it starts at, null where any time will do, and `now`
// says it can be had this minute. Of today, only what the clock has not
// reached counts: an hour that has started is not one to be asked for, and
// neither is a day whose hours are over.
function nextFree(item, calendar) {
  const states = dayStates(calendar);
  const at = new Date();
  const clock = clockOf(at.getHours() * 60 + at.getMinutes());
  for (let day = today(); day <= calendar.until; day = addDays(day, 1)) {
    const state = states.get(day) ?? {};
    if (state.closed) continue;
    const late = day === today();
    if (item.mode === "time") {
      const open = slotStates(item, states, day).filter((slot) => !slot.taken);
      // The stretch the clock is in, where nobody has it: it is free now.
      if (late && open.some((slot) => slot.start <= clock && clock < slot.end)) return { day, time: null, now: true };
      const first = open.find((slot) => !(late && slot.start < clock));
      if (first) return { day, time: first.start, now: false };
    } else if (!state.taken) {
      const bands = dayBands(item, day);
      // Any time will do: today is now, another day is the day.
      if (!bands) return { day, time: null, now: late };
      if (!late) return { day, time: bands[0].start, now: false };
      if (bands.some((band) => band.start <= clock && clock < band.end)) return { day, time: null, now: true };
      const first = bands.find((band) => band.start > clock);
      if (first) return { day, time: first.start, now: false };
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
  // On a page of its owner's: the sheet for which items are on it.
  onEditItems,
  onMessage,
  onBookmark,
  onBookingChange,
  onSignIn,
  signInPath = "/login",
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // An item's page opens with no day picked: which day is asked for is the
  // reader's to say. A spot's page still opens on today, whose hours are
  // what is read first there.
  const [selection, setSelection] = useState(() => (item.spot ? { start: today(), end: today() } : null));
  // The stretch of the day picked, { start, end }, where the item is booked by
  // the time.
  const [picked, setPicked] = useState(null);
  // On a spot, which category of the items on it is shown: null for all.
  const [itemsCategory, setItemsCategory] = useState(null);
  // And how they are laid out: as cards, which is how it starts, or as a list
  // — the one picked last kept in this browser for the next spot.
  const [itemsView, setItemsView] = useState(() => {
    try {
      return localStorage.getItem(ITEMS_VIEW_KEY) === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });
  const chooseItemsView = (view) => {
    setItemsView(view);
    try {
      localStorage.setItem(ITEMS_VIEW_KEY, view);
    } catch {
      // kept for this page only
    }
  };
  const [note, setNote] = useState("");
  // Whether the owner has pressed Delete and is being asked if they mean it.
  const [confirming, setConfirming] = useState(false);
  // The hours it is handed over in on the day it is picked up and on the day
  // it comes back, where it says any (see dayBands): the times to choose
  // between are the ones inside them, and a time chosen is brought inside
  // them too — the nearest one on from it, or the last of the day.
  const startBands = selection ? dayBands(item, selection.start) : null;
  const endBands = selection ? dayBands(item, selection.end) : null;
  const startTimes = TIME_OPTIONS.filter((option) => inBands(startBands, option.value));
  const endTimes = TIME_OPTIONS.filter((option) => inBands(endBands, option.value));
  const fit = (times, time) =>
    times.some((option) => option.value === time) ? time : (times.find((option) => option.value > time) ?? times.at(-1))?.value ?? time;
  const [startPick, setStartTime] = useState(DEFAULT_START_TIME);
  const [endPick, setEndTime] = useState(DEFAULT_END_TIME);
  const startTime = fit(startTimes, startPick);
  const endTime = fit(endTimes, endPick);
  // What the hours are, said as a line: for the day it is picked up, and for
  // the day it comes back where those are not the same.
  const bandsText = (bands) => bands.map((band) => `${band.start}–${band.end}`).join(", ");
  const bandLines = [];
  if (selection && startBands) bandLines.push(bandsText(startBands));
  if (selection && endBands && selection.end !== selection.start && bandsText(endBands) !== bandLines[0]) {
    if (bandLines.length > 0) bandLines[0] = `${formatDay(selection.start, lang)} ${bandLines[0]}`;
    bandLines.push(`${formatDay(selection.end, lang)} ${bandsText(endBands)}`);
  }
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [photo, setPhoto] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  // The photograph before the one shown, or the one after, round and round.
  const photoCount = item.images.length;
  const stepPhoto = (by) => {
    if (photoCount < 2) return;
    setPhoto((shown) => (Math.min(shown, photoCount - 1) + by + photoCount) % photoCount);
  };
  // While the photograph is up large, the arrow keys turn to the next and
  // the one before.
  useEffect(() => {
    if (!zoomed || photoCount < 2) return undefined;
    const turn = (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      setPhoto((shown) => (Math.min(shown, photoCount - 1) + (event.key === "ArrowLeft" ? -1 : 1) + photoCount) % photoCount);
    };
    document.addEventListener("keydown", turn);
    return () => document.removeEventListener("keydown", turn);
  }, [zoomed, photoCount]);
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
  // How its owner is reached. Where none is written — what the phone
  // registers says none — the first way is a message here on rab: an
  // account's own item always has that one. Somebody else's has nobody here
  // to write to, and stays without.
  const contacts = item.contacts?.length > 0 ? item.contacts : !shared && item.owner ? [{ type: "message", value: "" }] : [];
  // Where asking by the way written first goes, or null where that way is not
  // one that can be pressed (an address).
  const askHref = contactHref(contacts[0], item.title);
  const states = useMemo(() => dayStates(calendar, bookings), [calendar, bookings]);
  const free = useMemo(() => nextFree(item, calendar), [item, calendar]);
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
  // Only for sale — not lent out at all: what it is sold for is its price.
  const saleOnly = !item.spot && item.rentable === false && forSale(item);
  // Offered neither way — not lent out, not for sale: only written down (what
  // the phone's scanner registers is, to start with). No price, nothing to ask.
  const notOffered = !item.spot && item.rentable === false && !forSale(item);
  const priceOnRequest = priceToday == null;
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
  // been picked. Published or not, its hours are what they are.
  const day = bySlot && selection && selection.start === selection.end ? selection.start : null;
  // The pieces of the stretch picked, each costing its share of the price in
  // force then, which is for one stretch of the pricing unit.
  const chosenSlots = picked ? slots.filter((slot) => slot.start >= picked.start && slot.start < picked.end && !slot.taken) : [];
  // An item that says no price comes to no total.
  const slotTotal = chosenSlots.some((slot) => slot.price == null)
    ? null
    : roundPrice(chosenSlots.reduce((sum, slot) => sum + (slot.price * unitOf(item)) / priceUnitOf(item), 0), item.currency);
  // Picked up and brought back on the same day, it has to come back later than
  // it went out.
  const timesWrong =
    !bySlot && Boolean(selection) && (!startTime || !endTime || (selection.start === selection.end && startTime >= endTime));
  // By the time, a stretch shorter than one booking may be cannot be asked for.
  const minDuration = minDurationOf(item);
  const tooShort = bySlot && Boolean(picked) && minutesOf(picked.end) - minutesOf(picked.start) < minDuration;
  const ready = bySlot ? chosenSlots.length > 0 && !tooShort : Boolean(price) && !timesWrong;
  const total = bySlot ? slotTotal : price?.total;
  const url = `${window.location.origin}${itemPath(item)}`;

  function select(next) {
    setSelection(next);
    setPicked(null);
    setFormError("");
  }

  async function book(event) {
    event.preventDefault();
    if (preview || mine) return;
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
          : error.code === "TIME_TOO_SHORT"
            ? t("booking.tooShort", { duration: durationName(minDuration, t) })
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
  // On a spot's page, the one day picked said back: its date, and the hours
  // it can be used in that day — or that it cannot be, or that it can all day
  // where the spot says no hours.
  const spotDay = item.spot && calendar && selection ? selection.start : null;
  const spotState = spotDay ? reading(item, states, calendar, spotDay) : null;
  const spotBands = spotDay ? (bySlot ? hoursOn(item, spotDay) : spotState.bands) : null;
  const spotClosed = Boolean(spotDay) && (spotState.closed || (bySlot && spotBands.length === 0));
  const spotHours = !spotDay
    ? ""
    : spotClosed
      ? t("calendar.closed")
      : spotBands?.length
        ? t("booking.dayHours", { hours: spotBands.map((band) => `${band.start}–${band.end}`).join(", ") })
        : t("calendar.allDay");
  const shownPhoto = item.images[Math.min(photo, item.images.length - 1)];
  // A photograph is never drawn larger than it is: stretched past its own
  // pixels it goes soft, and a small sharp picture reads better than a big
  // blurred one. The picture stands whole in its frame (its sides made up with
  // itself, blurred — see .photoBlur), so it is the frame that is held —
  // no wider than the picture, and no wider than would make its height more
  // than the picture's at the taller of the two shapes the frame takes (4:3).
  // Inside a frame that is within the picture both ways, filling it can only
  // ever shrink the picture.
  const size = shownPhoto && {
    width: shownPhoto.width ?? natural[shownPhoto.src]?.width,
    height: shownPhoto.height ?? natural[shownPhoto.src]?.height,
  };
  const photoLimit = size?.width && size?.height ? Math.floor(Math.min(size.width, (size.height * 4) / 3)) : undefined;
  // Whether it can be had, which publishing has nothing to do with: that only
  // says who can see it, and is a tag of its own beside this one.
  const status = notOffered
      ? t("item.notOffered")
      : saleOnly
      ? t("item.forSale")
      : inquiry
      ? t("item.byInquiry")
      : free?.now
      ? t("item.freeToday")
      : free
        ? // The day, said as today where it is, and the hour it starts at.
          t("item.freeFrom", {
            date: [free.day === today() ? t("item.today") : formatDay(free.day, lang), free.time].filter(Boolean).join(" "),
          })
        : t("item.noDays");
  // The two tags, at the top right of the card: at the end of the price row,
  // or of the share row on a spot, which has no price.
  const statusTags = (
    <span className={styles.statusTags}>
      <span className={`status ${!notOffered && (inquiry || free?.now) ? "status-confirmed" : "status-pending"}`}>{status}</span>
      {!item.active && <span className="status status-off">{t("spot.unpublished")}</span>}
    </span>
  );

  // The buttons at the foot of the card, for whoever may change the item. One
  // for the whole item: published, or not — an item is added unpublished
  // (see ItemModal) and published here, and unpublished again whenever its
  // owner likes. Not asked of somebody else's, since that is its owner's to say. And beside it, at the
  // right, the way to be rid of the item altogether, in red and asked twice.
  // Somebody else's is not deleted by whoever is reading it, and has no
  // buttons here: having it deleted is asked of the administrator in a report.
  const removal = shared && !admin ? null : (
    <div className={styles.buttons}>
      {/* Where there is no such button, Delete stands alone at the left edge:
          nothing empty is left in its place to hold a gap open. */}
      {((mine && !shared) || admin) && (
        <button type="button" className="small-button" disabled={busy || preview} onClick={() => setActive(!item.active)}>
          {item.active ? t("item.unpublish") : t("item.publish")}
        </button>
      )}
      {/* The default spot, which every account has, is not deleted. */}
      {!item.default && (
        <button type="button" className={`small-button ${styles.danger}`} disabled={busy || preview} onClick={() => setConfirming(true)}>
          {t("item.delete")}
        </button>
      )}
    </div>
  );

  // How the owner is reached: on an item, over its calendar — in its place,
  // booked by asking; on a spot, under it, over the button that does the
  // reaching.
  const contactPart = (inquiry || contacts.length > 0) && (
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
      {inquiry && !notOffered && item.active && <p className={styles.small}>{shared || !item.owner ? t("item.inquiryExplainShared") : t("item.inquiryExplain", { name: formatUsername(item.owner) })}</p>}
    </>
  );

  // The button that goes to whoever has it directly, on a spot and on an
  // item booked by asking: the way written first — a phone number called, an
  // address written to — or else a message to them here. Greyed for its own
  // account, and on a preview.
  const contactButton =
    askHref && !mine && !preview ? (
      <a className={`primary-button ${styles.ask}`} href={askHref}>
        {t("booking.contact")}
      </a>
    ) : (
      (askHref || (item.owner && !shared)) && (
        <button
          type="button"
          className="primary-button"
          disabled={mine || preview}
          onClick={() => (viewer ? onMessage?.(item.owner) : onSignIn?.())}
        >
          {t("booking.contact")}
        </button>
      )
    );

  // The categories of the items on a spot, each with how many, the most
  // first (and where as many, in the order they first come).
  const spotCategories = [];
  if (item.spot) {
    const counts = new Map();
    for (const each of item.items ?? []) counts.set(each.category ?? "", (counts.get(each.category ?? "") ?? 0) + 1);
    spotCategories.push(...[...counts].sort((a, b) => b[1] - a[1]));
  }
  // A spot's tags: its own category, then its items' others.
  const spotTags = item.spot ? [...new Set([item.category, ...spotCategories.map(([slug]) => slug)].filter(Boolean))] : [];

  return (
    <article className={styles.page}>
      <div className={styles.columns}>
        <header className={styles.head}>
          {/* What it is, as tags over its name. An item: its category. A
              spot: the one chosen for it first, and then the others its
              items are in, the most first — none where it has neither. */}
          {item.spot ? (
            spotTags.length > 0 && (
              <p className={styles.tags}>
                {spotTags.map((slug) => (
                  <span key={slug}>
                    <CategoryIcon category={slug} />
                    {t(`category.${slug}`, slug)}
                  </span>
                ))}
              </p>
            )
          ) : (
            <p className={styles.tags}>
              <span>
                <CategoryIcon category={item.category} />
                {sortLabel(item, t)}
              </span>
            </p>
          )}
          <h1 className={styles.title}>{item.title}</h1>
          {/* A few words for what it is, under its name. */}
          {item.what && <p className={styles.what}>{item.what}</p>}
          {/* How many of it there are, where there is more than one. */}
          {!item.spot && item.quantity > 1 && <p className={styles.small}>{t("item.countLine", { n: item.quantity })}</p>}
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
                // Pressed in the middle, the photograph is shown large; pressed
                // at its left or its right third — where there are several —
                // the one before or the one after is shown, round and round.
                // A press that is not the mouse's (the keyboard's) has no
                // place, and shows it large.
                onClick={(event) => {
                  const count = item.images.length;
                  const box = event.currentTarget.getBoundingClientRect();
                  const at = event.detail > 0 && box.width > 0 ? (event.clientX - box.left) / box.width : 0.5;
                  if (count < 2 || (at >= 1 / 3 && at <= 2 / 3)) return setZoomed(true);
                  const now = Math.min(photo, count - 1);
                  setPhoto((now + (at < 1 / 3 ? count - 1 : 1)) % count);
                }}
                onKeyDown={(event) => {
                  const count = item.images.length;
                  if (count < 2 || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                  event.preventDefault();
                  const now = Math.min(photo, count - 1);
                  setPhoto((now + (event.key === "ArrowLeft" ? count - 1 : 1)) % count);
                }}
                aria-label={t("item.photoOpen")}
              >
                {/* The photograph again, filling the frame and blurred: what
                    stands at the sides of one that is not the frame's shape. */}
                {/* One whose subject was cut out and stood on a colour has
                    that colour there instead: it is its own ground. */}
                {shownPhoto.backdrop ? (
                  <span className={styles.photoGround} style={{ background: shownPhoto.backdrop }} aria-hidden="true" />
                ) : (
                  <img className={styles.photoBlur} src={shownPhoto.src} alt="" aria-hidden="true" />
                )}
                <img
                  className={styles.photoWhole}
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
                  <>
                    {/* Each arrow in a box as the app's own buttons are drawn
                        (see ActionButton): they cannot be buttons, standing
                        inside one. */}
                    <span className={`${styles.photoSide} ${styles.photoBefore}`} aria-hidden="true">
                      <span className={styles.photoArrow}><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg></span>
                    </span>
                    <span className={`${styles.photoSide} ${styles.photoAfter}`} aria-hidden="true">
                      <span className={styles.photoArrow}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg></span>
                    </span>
                  </>
                )}
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
          {/* A page has no price of its own — each item on it has its own —
              nor a way it is booked to say up here. */}
          {!item.spot && (
          <p className={styles.price}>
            {!notOffered && <strong>{saleOnly ? formatPrice(item.salePrice, item.currency, lang) : priceOnRequest ? t("item.priceOnRequest") : priceHead}</strong>}
            {!saleOnly && !priceOnRequest && (
              <span>
                {bySlot
                  ? t("item.anHour", { unit: unitName(priceUnitOf(item), t) })
                  : inquiry && inquiryUnitOf(item) !== DAY_UNIT
                    ? t("item.anHour", { unit: unitName(inquiryUnitOf(item), t) })
                    : t("item.aDay")}
              </span>
            )}
            {item.deposit != null && <span>{t("item.depositLine", { price: formatPrice(item.deposit, item.currency, lang) })}</span>}
            {!saleOnly && forSale(item) && <span>{t("item.saleLine", { price: formatPrice(item.salePrice, item.currency, lang) })}</span>}
            {statusTags}
          </p>
          )}

          {/* Getting the page in front of people is half of what it is for, so
              the way to do it is the first control on the card and the one
              drawn loudest. A spot, with no price row, has its tags at the
              far end of this one. */}
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
                bookmarks (see /mine), until the button is pressed again.
                Shown to the account it is under as to anybody — the card reads
                the same for everyone — but greyed: its own it is already. */}
            {(
              <button
                type="button"
                className="small-button"
                aria-pressed={bookmarked}
                onClick={toggleBookmark}
                disabled={preview || bookmarking || mine}
              >
                <svg className={bookmarked ? `${styles.icon} ${styles.iconOn}` : styles.icon} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 4h12v17l-6-4.5L6 21z" />
                </svg>
                {t(bookmarked ? "item.bookmarked" : "item.bookmark")}
              </button>
            )}
            {/* On the same row, the way to the admin: the same for everybody,
                greyed where it goes nowhere — one does not report to oneself.
                What the owner and the admin do with it is at the foot of the
                card, apart from everything a reader needs. */}
            {/* Saying something is wrong with it, to the administrator. */}
            <button
              type="button"
              className="small-button"
              onClick={() => (viewer ? setPosting("report") : onSignIn?.())}
              disabled={preview || mine || admin}
            >
              {t("item.report")}
            </button>
            {item.spot && statusTags}
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

          {/* Its own pages somewhere else, where it has any: each address,
              pressed to go there. Over how its owner is reached. */}
          {item.links?.length > 0 && (
            <>
              <div className={`${styles.calendarHead} ${styles.contactHead}`}>
                <h2>{t("item.links")}</h2>
              </div>
              {item.links.map((link) => (
                <p key={link} className={styles.homepage}>
                  <a href={link} target="_blank" rel="noreferrer noopener">
                    <span>{link.replace(/^https?:\/\//i, "").replace(/\/$/, "")}</span>
                    {/* And the mark of a page that opens somewhere else. */}
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
                    </svg>
                  </a>
                </p>
              ))}
            </>
          )}

          {/* The pages its owner put it on — a spot, a space — each the way
              to that page, where the rest of what they have is. */}
          {item.spots?.length > 0 && (
            <>
              <div className={`${styles.calendarHead} ${styles.contactHead}`}>
                <h2>{t("item.spots")}</h2>
              </div>
              <ul className={styles.spotLinks}>
                {item.spots.map((spot) => (
                  <li key={spot.id}>
                    {preview ? (
                      <span>
                        {spot.name}
                      </span>
                    ) : (
                      <Link to={itemPath({ ...spot, spot: true })}>
                        {spot.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Booked by asking, the card has no calendar: in its place, how the
              owner is reached — the first way, then the second. A number
              and an email address are pressed to call or to write. */}
          {/* One booked by the date or the time says how its owner is reached
              too, over its calendar, where it says any way at all. */}
          {!item.spot && contactPart}

          {!inquiry && (
          <>
          <div className={styles.calendarHead}>
            <h2>{t(item.spot ? "calendar.spotTitle" : "calendar.title")}</h2>
            {/* What the figures on the squares are, which a page has none of. */}
            <span>{item.spot ? null : bySlot ? t("calendar.perHour", { unit: unitName(priceUnitOf(item), t) }) : t("calendar.perDay")}</span>
          </div>
          <Calendar
            item={item}
            calendar={calendar}
            bookings={bookings}
            selection={selection}
            // Picked from the same way by its owner as by anybody else.
            // Published or not, its days are what they are: publishing only
            // says who can see it. A spot's are only read, one at a time.
            onSelect={select}
            single={item.spot}
          />
          {/* By the time, what the prices on the squares above are for: one stretch of the item's pricing unit. */}
          {bySlot && !item.spot && <p className={`${styles.small} ${styles.tip}`}>{t("calendar.unit", { unit: unitName(priceUnitOf(item), t) })}</p>}

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
                onChange={item.spot ? undefined : setPicked}
                unit={unitOf(item)}
                least={minDuration}
                today={day === today()}
              />
              {/* And the piece of the clock it is asked for in — which a
                  page, not booked itself, has none of. */}
              {!item.spot && (
                <p className={`${styles.small} ${styles.tip}`}>
                  {t("calendar.bookingUnit", { unit: unitName(unitOf(item), t) })}
                  {/* And the shortest it may be, where that is more than one step. */}
                  {minDuration > unitOf(item) && ` · ${t("calendar.minDuration", { duration: durationName(minDuration, t) })}`}
                </p>
              )}
            </>
          )}
          </>
          )}

          {item.spot ? (
            // A spot is not booked itself: under its calendar, the day
            // picked and its hours; and the request button, which goes to
            // whoever keeps the spot directly — the way written first, a
            // phone number called or an address written to, or else a
            // message to them here. Greyed for the spot's own account, and
            // on a preview.
            <div className={styles.panel}>
              {!inquiry && spotDay && (
                <p className={styles.chosen}>
                  <span>{formatDay(spotDay, lang, { weekday: "short", month: "short", day: "numeric" })}</span>
                  {/* Under it, on a line of its own, its hours in plain ink
                      — or, in grey, that it cannot be used. */}
                  <span className={spotClosed ? styles.spotHours : `${styles.spotHours} ${styles.spotHoursOpen}`}>{spotHours}</span>
                </p>
              )}
              {contactPart}
              {/* Ruled off from what is above it. */}
              {contactButton && <div className={styles.contactRule}>{contactButton}</div>}
            </div>
          ) : inquiry ? (
            // Unpublished, nobody but its owner sees it; the owner sees the
            // card as it will read once it is published.
            !item.active && !mine ? (
              <p className={styles.small}>{t("item.inactiveNote")}</p>
            ) : (
              // Booked by asking, there is no request to send: the button
              // where one would be goes to the owner directly.
              contactButton && (
                <div className={styles.panel}>
                  <div className={styles.contactRule}>{contactButton}</div>
                </div>
              )
            )
          ) : item.active || mine ? (
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
                    <span>
                      {bySlot && !picked
                        ? `${chosen} · ${t("calendar.pickSlots")}`
                        : tooShort
                          ? `${chosen} · ${t("booking.tooShort", { duration: durationName(minDuration, t) })}`
                          : chosen}
                    </span>
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
                {!bySlot &&
                  bandLines.map((line) => (
                    <p key={line} className={styles.small}>
                      {t("booking.dayHours", { hours: line })}
                    </p>
                  ))}
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
                        options={startTimes}
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
                        options={endTimes}
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
                <button type="submit" className="primary-button" disabled={busy || !ready || preview || mine}>
                  {viewer || preview ? t("booking.request") : t("booking.signIn")}
                </button>
                <p className={styles.small}>{t("booking.explain")}</p>
                {/* And what is being agreed to about calling it off, under
                    a label of its own. */}
                <div className={styles.policy}>
                  <span className={styles.policyLabel}>{t("booking.cancelPolicy")}</span>
                  <p className={styles.small}>{cancelLine(item.cancel, t)}</p>
                </div>
              </fieldset>
              {formError && <p className="form-message error">{formError}</p>}
            </form>
          ) : (
            <p className={styles.small}>{t("item.inactiveNote")}</p>
          )}
          {/* At the foot of the card, ruled off from what is for a reader:
              what whoever may change it does with it — its own account, the
              admin, anybody signed in for somebody else's. Changing it, and
              publishing it or being rid of it. */}
          {canEdit && (
            <div className={styles.ownerTools}>
              <div className={styles.buttons}>
                <button type="button" className="small-button" onClick={onEdit} disabled={preview}>
                  {t(item.spot ? "spot.edit" : "item.editTitle")}
                </button>
                {/* When it can be had and what it costs, which is a sheet of
                    its own apart from the one the item is edited on. */}
                <button type="button" className="small-button" onClick={onEditAvailability} disabled={preview}>
                  {t("item.availabilityTitle")}
                </button>
                {/* Which of its owner's items are on a page. */}
                {item.spot && mine && onEditItems && (
                  <button type="button" className="small-button" onClick={onEditItems} disabled={preview}>
                    {t("spot.editItems")}
                  </button>
                )}
              </div>
              {removal}
              {/* Where there is no request form above to say it in. */}
              {(mine || inquiry || item.spot || !item.active) && formError && <p className="form-message error">{formError}</p>}
            </div>
          )}
        </aside>
        {/* Asked twice before it is deleted: on a sheet of its own, over the
            page, rather than in place of the buttons. */}
        <Modal isOpen={confirming} title={t("item.delete")} onClose={busy ? undefined : () => setConfirming(false)} closeOnOverlay>
          <p className="modal-text">{t("item.deleteConfirm")}</p>
          <div className="modal-actions">
            <button type="button" className="outline-button" disabled={busy} onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className={`primary-button ${styles.deleteButton}`} disabled={busy} onClick={remove}>
              {t("item.delete")}
            </button>
          </div>
        </Modal>

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

          {/* ------------------------------------------ the items on it */}
          {/* A page: the items its owner put on it, in their order. */}
          {item.spot && !preview && (
            <>
              <div className="part-heading">
                {/* The heading, and beside it the pair that lays the items
                    out as cards or as a list, as the top bar's map and lists. */}
                <span className={styles.itemsHead}>
                  <h2>{t("spot.itemsHeading")}</h2>
                  {(item.items ?? []).length > 0 && (
                    <span className="topbar-view" role="group" aria-label={t("spot.itemsView")}>
                      <ActionButton tooltip={t("spot.viewCards")} tooltipLeft aria-pressed={itemsView === "cards"} onClick={() => chooseItemsView("cards")}>
                        <svg viewBox="0 0 24 24">
                          {/* 田: one square, crossed through the middle. */}
                          <path d="M4 4h16v16H4z" />
                          <path d="M12 4v16" />
                          <path d="M4 12h16" />
                        </svg>
                      </ActionButton>
                      <ActionButton tooltip={t("spot.viewList")} aria-pressed={itemsView === "list"} onClick={() => chooseItemsView("list")}>
                        <svg viewBox="0 0 24 24">
                          <path d="M9 6h11" />
                          <path d="M9 12h11" />
                          <path d="M9 18h11" />
                          <path d="M4 6h.01" />
                          <path d="M4 12h.01" />
                          <path d="M4 18h.01" />
                        </svg>
                      </ActionButton>
                    </span>
                  )}
                </span>
                <span>{item.items?.length ?? 0}</span>
              </div>
              {(item.items ?? []).length === 0 ? (
                <p className="part-note">{t("spot.itemsEmpty")}</p>
              ) : (
                <>
                  {/* Where the items on it are of more than one category, a
                      button for each — the most first, with how many — and
                      one for all of them, to narrow the list to one. */}
                  {spotCategories.length > 1 && (
                    <div className={`tabs ${styles.itemTabs}`} role="group" aria-label={t("item.category")}>
                      <button
                        type="button"
                        className={itemsCategory === null ? "tab active" : "tab"}
                        aria-pressed={itemsCategory === null}
                        onClick={() => setItemsCategory(null)}
                      >
                        {t("map.all")}
                        <small>{item.items.length}</small>
                      </button>
                      {spotCategories.map(([slug, count]) => (
                        <button
                          key={slug}
                          type="button"
                          className={itemsCategory === slug ? "tab active" : "tab"}
                          aria-pressed={itemsCategory === slug}
                          onClick={() => setItemsCategory(itemsCategory === slug ? null : slug)}
                        >
                          <CategoryIcon category={slug} />
                          {slug ? t(`category.${slug}`, slug) : t("item.uncategorized")}
                          <small>{count}</small>
                        </button>
                      ))}
                    </div>
                  )}
                  {itemsView === "cards" ? (
                    <ul className="item-cards">
                      {item.items
                        .filter((each) => itemsCategory === null || (each.category ?? "") === itemsCategory)
                        .map((each) => (
                          <ItemCard key={each.id} item={each} showPublished={mine} />
                        ))}
                    </ul>
                  ) : (
                    <ul className="row-list">
                      {item.items
                        .filter((each) => itemsCategory === null || (each.category ?? "") === itemsCategory)
                        .map((each) => (
                          <ItemRow key={each.id} item={each} showPublished={mine} />
                        ))}
                    </ul>
                  )}
                </>
              )}
            </>
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

      {/* These sheets are drawn on the document's body, not in the page: the
          page is a container (see .page — its narrow shapes are asked of its
          own width), and a container holds whatever is fixed inside it — a
          sheet in it would cover the page from top to foot and stand in the
          middle of that, off the window on a phone, not in the middle of the
          window. */}
      {createPortal(
        <>
          <ReportModal item={item} mode={posting} onClose={() => setPosting(null)} />
          <ShareModal isOpen={sharing} onClose={() => setSharing(false)} title={item.title} url={url} slug={item.id} />
          {/* The photograph large: on a sheet the size of the one an item's page
              is read on, the photograph whole in the middle of it — and, where
              there are several, a button at its left and one at its right for the
              one before and the one after (the arrow keys too). */}
          <Modal
            isOpen={zoomed && Boolean(shownPhoto)}
            title={item.title}
            onClose={() => setZoomed(false)}
            closeOnOverlay
            large
            className={styles.zoomSheet}
          >
            {shownPhoto && (
              // The room at either side of the photograph turns too: pressed
              // at its left, the one before; at its right, the one after.
              <div
                className={`${styles.zoomStage} ${item.images.length > 1 ? styles.zoomTurns : ""}`}
                onClick={(event) => {
                  if (event.target !== event.currentTarget) return;
                  const box = event.currentTarget.getBoundingClientRect();
                  stepPhoto(event.clientX < box.left + box.width / 2 ? -1 : 1);
                }}
              >
                {/* The photograph and its count in a frame the photograph's own
                    size, so the count stands in the photograph's corner. */}
                <div className={styles.zoomFrame}>
                  <img className={styles.zoomed} src={shownPhoto.src} alt={item.title} />
                  {item.images.length > 1 && (
                    <span className={styles.photoCount}>
                      {Math.min(photo, item.images.length - 1) + 1}/{item.images.length}
                    </span>
                  )}
                </div>
                {item.images.length > 1 && (
                  <>
                    <button
                      type="button"
                      className={`${styles.photoArrow} ${styles.zoomStep} ${styles.zoomBefore}`}
                      onClick={() => stepPhoto(-1)}
                      aria-label={t("item.photoPrevious")}
                    >
                      <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
                    </button>
                    <button
                      type="button"
                      className={`${styles.photoArrow} ${styles.zoomStep} ${styles.zoomAfter}`}
                      onClick={() => stepPhoto(1)}
                      aria-label={t("item.photoNext")}
                    >
                      <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
                    </button>
                  </>
                )}
              </div>
            )}
          </Modal>
        </>,
        document.body,
      )}
    </article>
  );
}
