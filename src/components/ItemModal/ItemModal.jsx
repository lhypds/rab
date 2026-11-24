import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Modal, Select, TextArea, showToast } from "../../ui/index.js";
import { addDays, daysBetween, formatDay, formatRange, today, weekdayNames } from "../../utils/days.js";
import { CURRENCIES, compactPrice, currencySymbol, defaultCurrency, formatCoords, unitName, wholePrice } from "../../utils/format.js";
import { uploadPhoto } from "../../utils/image.js";
import { CATEGORIES, KINDS, categoriesFor } from "../../utils/kinds.js";
import { dialCodeOf, dialCodes, splitDialCode } from "../../utils/dialing.js";
import { AREA_TYPES, DEFAULT_VIEW, MAPBOX_TOKEN, addressLanguage, areaAt, areaOf, areasAt, geocode, locate, locationPermission, placeName, postcodeOf, savedView } from "../../utils/mapbox.js";
import { cancelLine } from "../../utils/bookings.js";
import { openPreview, writePreview } from "../../utils/preview.js";
import { clockOf, hourPrice, inquiryUnitOf, INQUIRY_UNITS, listPrice, openByRule, priceUnitOf, STEP, unitOf, UNITS } from "../../utils/rates.js";
import { currentRegion, useRegion } from "../../utils/region.js";
import { useAuth } from "../AuthProvider/index.js";
import Calendar from "../Calendar/index.js";
import CategoryIcon from "../CategoryIcon/index.js";
import SpotMap from "../SpotMap/index.js";
import { WeekHours } from "../TimeTable/index.js";
import styles from "./item.module.css";

const TITLE_MAX = 80;
const HOMEPAGE_MAX = 500;
// A page's address as the item's page will link to it: "https://" in front of
// one written without (the server does the same when it is saved).
const homepageOf = (written) => {
  const address = written.trim();
  return !address || /^https?:\/\//i.test(address) ? address : `https://${address}`;
};
const DESCRIPTION_MAX = 2000;
const PLACE_MAX = 120;
const IMAGES_MAX = 100;
const AREA_SEARCH_MS = 350;
// How far ahead the calendar reaches, the same year the server keeps.
const CALENDAR_DAYS = 366;
// How many photographs go up at once: enough that a hundred of them is not a
// queue, few enough that a phone is not compressing a dozen at a time.
const UPLOADS_AT_ONCE = 3;

const MODES = ["day", "time", "inquiry"];
// How many areas an item can be offered in besides the first.
const MORE_REGIONS_MAX = 3;
// The ways an owner can be reached, for an item booked by asking — and how
// long what is written for one may be.
// "message" is a message here on rab: a way with nothing to write for it.
const CONTACT_TYPES = ["phone", "email", "address", "message"];
const CONTACT_MAX = 200;
const CONTACTS_MAX = 5;
// What a contact's field is, to the keyboard that comes up for it.
const CONTACT_INPUT = { phone: "tel", email: "email", address: "text" };
const CANCEL_MODES = ["any", "none", "before"];
const CANCEL_UNITS = ["days", "hours"];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const HOUR_RULES_MAX = 12;
// Every half hour of the day, for the hours a price rule is for.
// The times of day hours can start and end on, `step` minutes apart, as the
// rows of the house dropdown — under a first row that is no time at all: a
// rule that has not been given its hours yet.
const timeOptions = (step) => [
  { value: "", label: "--:--" },
  ...Array.from({ length: (24 * 60) / step + 1 }, (_, index) => ({ value: clockOf(index * step), label: clockOf(index * step) })),
];

// The times the hours of an item booked by the date can start and end on:
// every half hour.
const DAY_TIME_OPTIONS = timeOptions(30);

let ruleSeed = 0;
const newRule = (fields) => ({ id: `r${++ruleSeed}`, price: "", days: [], dates: [], start: "", end: "", ...fields });

// How the form holds what an item costs, in layers, each over the last: one
// base price; a base price of their own for single dates, set on the calendar
// of dates; and, by the time, a price of its own for a stretch of one date,
// set on the week's timetable a cell at a time. Read out of the item's price rules as they are
// kept (see server/rates.js) — and a rule that is neither, from when rules
// were written freely or a stretch of hours could be priced, is kept as it is
// (`extraRates`) rather than lost.

function startingPricing(item, calendar) {
  const rates = item?.rates ?? [];
  const byTime = item?.mode === "time";
  // The rules for hours: the item's stretches that name no dates — "09:00 to
  // 18:00, Monday to Friday". None, for a new item: nothing can be booked
  // until hours are given, by a rule or painted on a date.
  const hourRules = byTime
    ? (item.hours ?? [])
        .filter((range) => !range.dates)
        // Hours for every day are shown with every day ticked, which is
        // what they are: nothing ticked is not a thing a rule can say.
        .map((range) => newRule({ days: range.days ?? EVERY_DAY, start: range.start, end: range.end }))
    : [];
  const datePrices = {};
  // The stretches of single dates with a price of their own, set on the
  // week's timetable a cell at a time: [{ day, start, end, price }].
  const slotPrices = [];
  const extraRates = [];
  for (const rate of rates.slice(1)) {
    if (rate.dates?.length && !rate.days && !rate.start) {
      for (const day of rate.dates) datePrices[day] = String(rate.price);
      continue;
    }
    if (byTime && rate.dates?.length && !rate.days && rate.start && rate.end) {
      for (const day of rate.dates) slotPrices.push({ day, start: rate.start, end: rate.end, price: String(rate.price) });
      continue;
    }
    extraRates.push(rate);
  }
  // A price once given to a date on the item's page is that date's base price
  // too, and is brought in here to be kept with the rest (see save).
  if (!byTime) {
    for (const day of calendar?.days ?? []) {
      if (day.available && day.price != null && !(day.day in datePrices)) datePrices[day.day] = String(day.price);
    }
  }
  return { basePrice: rates[0]?.price != null ? String(rates[0].price) : "", datePrices, slotPrices, extraRates, hourRules };
}

// The form's lines for how the owner is reached, from the ways as they are
// kept: a phone number with its hyphens off.
const contactLines = (contacts) => contacts.slice(0, CONTACTS_MAX).map(contactLine);

// A phone number is its code and its digits. One kept from before a code was
// asked for has its code read off its front where it was written with one,
// and otherwise none yet: it is shown with the reader's own country's, and
// saved with it.
function contactLine(contact) {
  if (contact.type === "message") return { type: "message", value: "" };
  if (contact.type !== "phone") return { type: contact.type, value: contact.value };
  const split = contact.code ? { code: contact.code, value: contact.value } : splitDialCode(contact.value);
  return { type: "phone", code: split?.code, value: String(split?.value ?? contact.value).replace(/\D/g, "") };
}

// The ways the owner is reached that a form starts with, by how the item is
// booked: asked for, the account's own as its account has them (`own`) or an
// empty line; by the date or the time, a message here. Somebody else's starts
// with an empty line: it is not reached the way the account is.
function startingContacts(mode, shared, own) {
  if (shared) return noContacts();
  if (mode === "inquiry") return own.length > 0 ? own : noContacts();
  return messageOnly();
}

// The one empty line the form starts with.
const noContacts = () => [{ type: CONTACT_TYPES[0], value: "" }];
// And the one way an item booked by the date or the time starts with: a
// message here.
const messageOnly = () => [{ type: "message", value: "" }];

function startingFields(item, calendar, lang) {
  return {
    // Whose it is: the account's own, or somebody else's that the account is
    // writing down — which anybody may then change or delete.
    shared: item?.shared === true,
    kind: item?.kind ?? "item",
    category: item?.category ?? "",
    title: item?.title ?? "",
    description: item?.description ?? "",
    // Its own page somewhere else, as its address, where it has one.
    homepage: item?.homepage ?? "",
    // How it is booked: by the date, or by the date and the time — and, for
    // the second, the hours of the week it can be had.
    mode: item?.shared === true ? "inquiry" : MODES.includes(item?.mode) ? item.mode : "day",
    // How the owner is reached, where it is booked by asking: the first way,
    // then as many more as are added, each a kind and what is written for
    // it. One line to start with; a line left empty is not kept.
    contacts:
      item?.contacts?.length > 0
        ? contactLines(item.contacts)
        : item?.shared === true || item?.mode === "inquiry"
          ? noContacts()
          : messageOnly(),
    // And what its price is for, which may be a whole day: kept apart from
    // the pricing unit of an item booked by the time, which may not.
    inquiryUnit: inquiryUnitOf(item),
    // The piece of the clock it is booked in, where it is booked by the time.
    unit: unitOf(item),
    // And the stretch of the clock its prices are for, which is its own choice.
    priceUnit: priceUnitOf(item),
    // The hours it can be had, in two parts: the rules (`hourRules`), and what
    // was painted for particular dates in their place (`hourDates`, with
    // `hoursOff` for the dates wiped clean).
    // When a confirmed booking may still be called off by whoever made it:
    // any time, not at all, or up to so many days before it starts.
    // The last is said as a count and what it counts: days, or hours.
    cancelMode: ["days", "hours"].includes(item?.cancel?.mode) ? "before" : (item?.cancel?.mode ?? "any"),
    cancelUnit: item?.cancel?.mode === "hours" ? "hours" : "days",
    cancelCount: String(item?.cancel?.days ?? item?.cancel?.hours ?? 3),
    // What it costs — the base price, and the dates with one of their own —
    // and the rules for hours.
    ...startingPricing(item, calendar),
    hourDates: item?.mode === "time" ? (item.hours ?? []).filter((range) => range.dates) : [],
    hoursOff: item?.mode === "time" ? (item.hoursOff ?? []) : [],
    // The rule for days: the days of the week it can be had. Every day, until
    // some are unticked.
    openDays: item?.openDays ?? EVERY_DAY,
    // The hours of the day it is handed over in, where it is booked by the
    // date: none until some are set, which is the whole day.
    dayHours: item?.dayHours ?? { start: "", end: "" },
    currency: item?.currency ?? defaultCurrency(lang),
    images: item?.images ?? [],
    // No place until one is asked for: a service has no doorway, and not
    // everybody wants a pin on their street.
    located: item?.located ?? false,
    latitude: item?.latitude ?? null,
    longitude: item?.longitude ?? null,
    place: item?.place ?? "",
    // The area it is offered in: { name, detail, bbox }, or null until one is
    // picked — and one has to be.
    region: item?.region ?? null,
    // The areas added to it, for something that stands between two: each one
    // an area, or nothing yet where one has been added and not picked.
    moreRegions: (item?.moreRegions ?? []).slice(0, MORE_REGIONS_MAX),
    // What the calendar says of single dates, against the rule: the ones
    // closed, and the ones opened though the rule leaves their day out.
    closed: (calendar?.days ?? []).filter((day) => !day.available).map((day) => day.day),
    opened: (calendar?.days ?? []).filter((day) => day.available && day.price == null).map((day) => day.day),
  };
}

// Those rules as they would be saved: the ones whose hours are in order.
function cleanHourRules(rules) {
  return rules
    .filter((rule) => timed(rule) && rule.start < rule.end)
    .map((rule) => ({ start: rule.start, end: rule.end, days: rule.days.length === 0 || rule.days.length === 7 ? null : rule.days }));
}

// A price as typed, as a number — or null where it is not one.
const priceOf = (text) => (String(text).trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : null);

// What the form's layers come to as the rules that are kept, each one over
// the ones before it: the base price; whatever older rules it was handed; the
// dates with a base price of their own, the ones at one price together; and
// last, by the time, the stretches of single dates priced on their own.
function cleanRates(fields, byTime) {
  const base = priceOf(fields.basePrice);
  if (base === null) return [];
  const byPrice = new Map();
  for (const [day, text] of Object.entries(fields.datePrices)) {
    const price = priceOf(text);
    if (price !== null) byPrice.set(price, [...(byPrice.get(price) ?? []), day]);
  }
  return [
    { price: base, days: null },
    ...fields.extraRates,
    ...[...byPrice.entries()].map(([price, dates]) => ({ price, days: null, dates: dates.sort() })),
    ...(byTime ? slotRates(fields.slotPrices) : []),
  ];
}

// The stretches of single dates priced on their own, as the fewest rules that
// say them: a date's stretches that touch and cost the same are one stretch,
// and the same stretch at the same price on several dates is one rule for
// those dates. Dates gone by are let go of.
function slotRates(slots) {
  const from = today();
  const byDay = new Map();
  for (const slot of slots) {
    if (slot.day < from || priceOf(slot.price) === null) continue;
    byDay.set(slot.day, [...(byDay.get(slot.day) ?? []), { ...slot, price: priceOf(slot.price) }]);
  }
  const byRule = new Map();
  for (const [day, list] of byDay) {
    list.sort((a, b) => a.start.localeCompare(b.start));
    const joined = [];
    for (const slot of list) {
      const last = joined[joined.length - 1];
      if (last && last.end === slot.start && last.price === slot.price) last.end = slot.end;
      else joined.push({ ...slot });
    }
    for (const slot of joined) {
      const key = `${slot.start}-${slot.end}-${slot.price}`;
      const rule = byRule.get(key) ?? { price: slot.price, days: null, dates: [], start: slot.start, end: slot.end };
      rule.dates.push(day);
      byRule.set(key, rule);
    }
  }
  return [...byRule.values()].map((rule) => ({ ...rule, dates: rule.dates.sort() }));
}

// One stretch of one date given a price — or, with no price, put back to what
// the date costs: whatever was said of any part of that stretch before is
// cut away first, the parts of it either side kept.
function withSlotPrice(slots, { day, start, end, price }) {
  const kept = [];
  for (const slot of slots) {
    if (slot.day !== day || slot.end <= start || slot.start >= end) {
      kept.push(slot);
      continue;
    }
    if (slot.start < start) kept.push({ ...slot, end: start });
    if (slot.end > end) kept.push({ ...slot, start: end });
  }
  return priceOf(price) === null ? kept : [...kept, { day, start, end, price }];
}

// Whether a rule names hours, and whether the ones it names are in order.
const timed = (rule) => Boolean(rule.start && rule.end);

// A field for a price, with the mark of the currency it is in standing before
// the figure — ¥, $, € — so a number in it is read as money, and as which.
function PriceInput({ currency, className, ...field }) {
  return (
    <span className={className ? `${styles.priced} ${className}` : styles.priced}>
      <span aria-hidden="true">{currencySymbol(currency)}</span>
      <input className="text-input mono" {...field} />
    </span>
  );
}

// The days of the week a rule is for, as seven small boxes. None ticked is
// every day.
// With `allowed`, the days not among them are greyed and cannot be pressed.
function Weekdays({ value, onChange, names, label, allowed = null }) {
  // The day a press has just unticked. The pointer is still on it, and a day
  // under the pointer is turned over the way a ticked one is — which would
  // read as the press having done nothing. So it is drawn plain until the
  // pointer has left.
  const [quiet, setQuiet] = useState(null);
  return (
    <span className={styles.weekdays} role="group" aria-label={label}>
      {names.map((name, day) => {
        const on = value.includes(day);
        return (
          <button
            // The seven days in order; nothing else identifies them.
            // eslint-disable-next-line react/no-array-index-key
            key={day}
            type="button"
            className={[styles.weekday, on && styles.weekdayOn, day === quiet && styles.quiet].filter(Boolean).join(" ")}
            aria-pressed={on}
            disabled={Boolean(allowed) && !allowed.includes(day)}
            onClick={() => {
              if (on) setQuiet(day);
              onChange(on ? value.filter((each) => each !== day) : [...value, day].sort());
            }}
            onPointerLeave={() => day === quiet && setQuiet(null)}
          >
            {name}
          </button>
        );
      })}
    </span>
  );
}

// Whether two areas are the same one: the same name over the same ground, give
// or take the rounding an area is kept with.
function sameArea(a, b) {
  return Boolean(a && b) && a.name === b.name && a.bbox.every((edge, index) => Math.abs(edge - b.bbox[index]) < 1e-4);
}

// Whether one area is inside another: its ground within the other's, and the
// other named in what it is called or in the line saying where it is — 傘鉾町,
// "京都府京都市下京区", is inside 京都市. The ground alone does not say: the box
// round a big town has its neighbours in it too, and 向日市 is not in 京都市.
// (The same rule as the server's, in server/index.js.)
function areaWithin(inner, outer) {
  const edge = 0.002;
  const [west, south, east, north] = inner.bbox;
  const [outerWest, outerSouth, outerEast, outerNorth] = outer.bbox;
  if (west < outerWest - edge || south < outerSouth - edge || east > outerEast + edge || north > outerNorth + edge) return false;
  return inner.name.includes(outer.name) || (inner.detail ?? "").includes(outer.name);
}

// Whether two areas cannot both be an item's: the same one, or one inside the
// other.
function areasOverlap(a, b) {
  return Boolean(a && b) && (sameArea(a, b) || areaWithin(a, b) || areaWithin(b, a));
}

// Where the reader is: from where the browser says they are, or failing that
// from where the map is looking. Null where nothing says.
async function whereabouts() {
  let spot = null;
  const permission = await locationPermission();
  if (permission !== "denied" && permission !== "unsupported") spot = await locate();
  return spot ?? savedView() ?? currentRegion().center ?? null;
}

// The area an item is offered in: a search for a town, a ward or a prefecture,
// and once one is picked, its name — which is pressed to pick another, and
// opens the search again with the area left as it was until one is chosen.
// Not a <form> — it stands inside the item's.
//
// A postcode is searched for too, and answers with two areas to choose
// between: the town it is in, and the neighbourhood of that town it is. The
// same two are offered for where the reader is (`near`, where the form knows
// it already) as soon as the search is opened, before anything is typed: the
// town is what the form filled in, and the neighbourhood is under it.
//
// `taken` is the areas the item is offered in already, in its other fields:
// an area is said once, so those are left out of what is listed here — and
// with them whatever is inside one of them, or has one of them inside it.
function AreaField({ value, onChange, near = null, taken = [] }) {
  const { t } = useTranslation();
  const { country } = useRegion();
  // Places are named in the language of the country the reader is in.
  const lang = addressLanguage(country);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState(null);
  // Whether the search is open, and the areas round the reader that are
  // offered while it is.
  const [changing, setChanging] = useState(false);
  const [nearby, setNearby] = useState([]);

  useEffect(() => {
    if (!changing) return undefined;
    const controller = new AbortController();
    (async () => {
      const spot = near ?? (await whereabouts());
      if (!spot || controller.signal.aborted) return;
      areasAt(spot.latitude, spot.longitude, lang, controller.signal)
        .then((found) => setNearby(found.filter((place) => areaOf(place))))
        .catch(() => {});
    })();
    return () => controller.abort();
  }, [changing, near, lang]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setPlaces(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      // Leant towards wherever the map was last looking, inside the reader's
      // country — the same search the map's own field makes, kept to places
      // big enough to be an area.
      const postcode = postcodeOf(text);
      const search = postcode
        ? // A postcode is a neighbourhood: the town it is in, and itself.
          // The neighbourhood is the one the postcode found, where it found
          // one — the middle of it may stand nearer the next one over.
          geocode(postcode, { lang, country, types: "postcode,locality", limit: 1, signal: controller.signal }).then(async ([hit]) => {
            if (!hit) return [];
            const around = await areasAt(hit.latitude, hit.longitude, lang, controller.signal);
            const town = around.find((place) => place.type === "place");
            const neighbourhood = hit.type === "locality" ? hit : around.find((place) => place.type === "locality");
            return [town, neighbourhood].filter(Boolean);
          })
        : geocode(text, { lang, country, near: savedView() ?? currentRegion().center, types: AREA_TYPES, signal: controller.signal });
      search
        .then((found) => setPlaces({ list: found.filter((place) => areaOf(place)) }))
        .catch((error) => {
          if (error?.name !== "AbortError") setPlaces({ error: t("map.searchFailed") });
        });
    }, AREA_SEARCH_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, lang, country, t]);

  function close() {
    setQuery("");
    setPlaces(null);
    setChanging(false);
  }

  function choose(place) {
    close();
    onChange(areaOf(place));
  }

  // What is listed under the field: what the search found, and before
  // anything is searched for, the areas round the reader.
  const listed = places ?? (changing && nearby.length > 0 ? { list: nearby } : null);
  // Without the areas the item has already, or any that overlaps one. Nothing is said about a list of
  // nearby areas that comes to none: only a search can find nothing.
  const free = listed?.list?.filter((place) => !taken.some((area) => areasOverlap(area, areaOf(place))));
  const offered = !listed || (!places && free.length === 0) ? null : listed.list ? { list: free } : listed;

  if (value && !changing) {
    return (
      <button type="button" className={styles.area} aria-haspopup="listbox" onClick={() => setChanging(true)}>
        <span className={styles.areaName}>
          <strong>{value.name}</strong>
          {value.detail && <span>{value.detail}</span>}
        </span>
      </button>
    );
  }

  return (
    <div
      className={styles.areaSearch}
      role="search"
      // Left without choosing, the search closes and the area is what it was.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <input
        className="text-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setChanging(true)}
        // Opened by pressing the area, it is ready to be typed in.
        autoFocus={Boolean(value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            close();
            return;
          }
          if (event.key === "Enter") {
            // Enter picks the first answer; it must not publish the form.
            event.preventDefault();
            if (offered?.list?.[0]) choose(offered.list[0]);
          }
        }}
        placeholder={t("item.regionPlaceholder")}
        aria-label={t("item.region")}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={!MAPBOX_TOKEN}
      />
      {offered && (
        <ul className={styles.areaResults}>
          {offered.error && <li className={styles.areaNote}>{offered.error}</li>}
          {offered.list?.length === 0 && <li className={styles.areaNote}>{t("map.searchEmpty")}</li>}
          {offered.list?.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className={styles.areaResult}
                // The field keeps the focus, so pressing an answer does not
                // close the list from under the press.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(place)}
              >
                <strong>{place.name}</strong>
                {place.detail && <span>{place.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Putting something out for rent, and changing it afterwards: the item's page
// written as a form. What it is and what it looks like on the left; what it
// costs and when it can be had on the right; and a preview of the page all of
// that comes to before any of it is published.
//
// The form is in two parts, each a sheet of its own: what the item is — its
// kind, its name, its photographs, where it is — and when it can be had and
// what it costs. An item that exists is opened on one of them (`part`,
// "item" or "availability") and saved from there; a new one is taken through
// both, the first and then the second, and published from the second.
export default function ItemModal({ isOpen, page, item = null, calendar = null, part = "item", onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang = i18n.language;
  const [fields, setFields] = useState(() => startingFields(item, calendar, lang));
  const [uploading, setUploading] = useState(0);
  // Whether the form is being filled in from the main photograph.
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  // The rule whose particular dates are being picked, in the sheet that holds
  // a calendar for it — or null.
  // The date whose base price is being set, on a sheet over the form, and
  // what has been typed there so far.
  const [pricing, setPricing] = useState(null);
  // Which of the two parts a new item's form is on.
  const [step, setStep] = useState("item");
  const [error, setError] = useState("");
  // Whether the place line is the reader's own words. Until it is, it follows
  // the pin: the name of wherever the map has been dragged to.
  const placeTyped = useRef(false);
  // Whether the area was picked by hand. Until it is, it is the town the
  // reader is in — wherever the item's pin is put.
  const regionPicked = useRef(false);
  // Where the reader was found to be, for filling the area in: the area field
  // offers the neighbourhood of it too.
  const [here, setHere] = useState(null);
  // The account's own places, to put the item at one without finding the spot
  // again; and the name being given to the spot on the map, while it is being
  // saved as one of them.
  const [ownLocations, setLocations] = useState([]);
  // And the public account's: the places somebody else's things are at, which
  // is where somebody else's item is put. Everybody's to choose from and to
  // add to.
  const [publicLocations, setPublicLocations] = useState([]);
  const [naming, setNaming] = useState(null);
  // Whether the nearest public place may still be chosen for the item by
  // itself: until one has been, or the spot has been touched by hand.
  const autoPlace = useRef(true);
  // Somewhere for the form's map to go to: the place just chosen from the
  // list. A new object each time, so the same place chosen twice still moves it.
  const [spotTarget, setSpotTarget] = useState(null);
  // How the account is reached, as it wrote it on its account's sheet: what
  // an item of its own that is booked by asking starts with. Not somebody
  // else's, which is reached some other way.
  // The code a phone number is given until one is chosen — the reader's own
  // country's — and the codes there are to choose from.
  const { country } = useRegion();
  const dialCode = dialCodeOf(country);
  // The language a place found for the item is named in (see addressLanguage).
  const placeLang = addressLanguage(country);
  const dialOptions = useMemo(
    () =>
      dialCodes(lang).map(({ code, name }) => ({ value: code, short: code, label: `${code} ${name}`, text: `${code} ${name}` })),
    [lang],
  );
  const [ownContacts, setOwnContacts] = useState([]);
  // Whether the ways the owner is reached have been written by hand. Until
  // they are, they are what the way it is booked starts with (see
  // startingContacts), and change with it.
  const contactsTouched = useRef(false);
  const fileRef = useRef(null);
  const editing = Boolean(item);
  const names = useMemo(() => weekdayNames(lang), [lang]);

  useEffect(() => {
    if (!isOpen) return;
    const location = page?.location;
    const initial = startingFields(item, calendar, lang);
    if (page) initial.kind = page.kind;
    if (location) {
      initial.located = true;
      initial.latitude = location.latitude;
      initial.longitude = location.longitude;
      initial.place = location.address || location.name;
      initial.region = location.region;
    }
    setFields(initial);
    setError("");
    setPricing(null);
    setStep("item");
    setUploading(0);
    placeTyped.current = Boolean(initial.place);
    regionPicked.current = Boolean(initial.region);
    setNaming(null);
    setHoursDay(today());
    api
      .getLocations()
      .then((answer) => setLocations(answer.locations ?? []))
      .catch(() => setLocations([]));
    autoPlace.current = !item;
    contactsTouched.current = Boolean(item?.contacts?.length);
    setSpotTarget(null);
    api
      .getLocations({ shared: true })
      .then((answer) => setPublicLocations(answer.locations ?? []))
      .catch(() => setPublicLocations([]));
    api
      .getContacts()
      .then((answer) => {
        const lines = contactLines(answer.contacts ?? []);
        setOwnContacts(lines);
        // Filled in where nothing has been written by hand yet.
        if (contactsTouched.current) return;
        setFields((current) => ({ ...current, contacts: startingContacts(current.mode, current.shared, lines) }));
      })
      .catch(() => setOwnContacts([]));
    // Opened afresh each time; what it was opened with is what it starts from.
    // Keyed on which item it is, not on the item as handed in: the page behind
    // the form asks the server again every half minute and hands in a new copy
    // of the same item, and starting over at each of those would throw away
    // whatever had been typed since the last.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id, page?.id]);

  const set = (name, value) => {
    setFields((current) => ({ ...current, [name]: value }));
    setError("");
  };


  // The pin's place, named a moment after the map stops moving.
  const { latitude, longitude, located } = fields;
  useEffect(() => {
    if (!isOpen || !located || placeTyped.current || !MAPBOX_TOKEN) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      placeName(latitude, longitude, placeLang, controller.signal)
        .then((name) => {
          if (name && !placeTyped.current) setFields((current) => ({ ...current, place: name.slice(0, PLACE_MAX) }));
        })
        .catch(() => {});
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, located, latitude, longitude, placeLang]);

  // Every photograph is reduced in the browser before it is sent (see
  // utils/image.js), a few at a time, and lands in the order it was picked.
  async function addPhotos(event) {
    const room = IMAGES_MAX - fields.images.length;
    const files = [...event.target.files].slice(0, room);
    // The same file picked again is still a change.
    event.target.value = "";
    if (files.length === 0) return;
    setError("");
    setUploading(files.length);
    const done = new Array(files.length).fill(null);
    let next = 0;
    async function work() {
      while (next < files.length) {
        const index = next++;
        try {
          done[index] = await uploadPhoto(files[index]);
        } catch (uploadError) {
          setError(uploadError.message || t("item.photoFailed"));
        }
        setUploading((count) => count - 1);
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOADS_AT_ONCE, files.length) }, work));
    setFields((current) => {
      const known = new Set(current.images.map((image) => image.src));
      const added = done.filter((photo) => photo && !known.has(photo.src) && known.add(photo.src));
      return { ...current, images: [...current.images, ...added].slice(0, IMAGES_MAX) };
    });
  }

  // The form filled in from the main photograph, as the phone's is the moment
  // a photo is taken (see server/describe.js): which kind of thing it is, its
  // category, a name and a few lines about it. Only the main photograph is
  // looked at — the first — however many there are. Asked for by a button,
  // so what it answers is written over whatever those four said before.
  async function generate() {
    const photo = fields.images[0];
    if (!photo || generating) return;
    setError("");
    setGenerating(true);
    try {
      const blob = await fetch(photo.src).then((response) => {
        if (!response.ok) throw new Error("photo");
        return response.blob();
      });
      const listing = await api.describePhoto(blob, lang.slice(0, 2));
      setFields((current) => ({
        ...current,
        kind: !page && KINDS.includes(listing.kind) ? listing.kind : current.kind,
        category: page && listing.kind !== page.kind ? current.category : listing.category ?? "",
        title: (listing.title || current.title).slice(0, TITLE_MAX),
        description: (listing.description || current.description).slice(0, DESCRIPTION_MAX),
      }));
    } catch (describeError) {
      setError(t(describeError.code === "DESCRIBE_UNAVAILABLE" ? "item.generateUnavailable" : describeError.code === "DESCRIBE_BUSY" ? "item.generateBusy" : "item.generateFailed"));
    } finally {
      setGenerating(false);
    }
  }

  function addLocation() {
    autoPlace.current = false;
    const view = savedView() ?? currentRegion().center ?? DEFAULT_VIEW;
    setFields((current) => ({ ...current, located: true, latitude: view.latitude, longitude: view.longitude }));
  }

  // One of the account's own places: the pin goes to its spot and the line
  // under the pin is its address — the place's own, so it stays put rather
  // than following the pin. The area the item is offered in is left as it is.
  function putAt(id) {
    const location = locations.find((each) => each.id === id);
    if (!location) return;
    autoPlace.current = false;
    placeTyped.current = true;
    // The map goes there too: with a pin on it already, the pin alone would
    // move, to somewhere the map is not looking.
    setSpotTarget({ latitude: location.latitude, longitude: location.longitude });
    setFields((current) => ({
      ...current,
      located: true,
      latitude: location.latitude,
      longitude: location.longitude,
      place: (location.address || location.name).slice(0, PLACE_MAX),
    }));
    setError("");
  }

  // Whether the pin and its address are one of the account's places as it is
  // kept: chosen from the list and left alone, or just saved. There is nothing
  // to save then; moving the pin or rewriting the address makes it a new spot.
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  // The places to choose from: the account's own for its own item, the public
  // account's for somebody else's.
  const locations = fields.shared ? publicLocations : ownLocations;
  const keptLocation = fields.located
    ? locations.find(
        (location) =>
          near(location.latitude, fields.latitude) &&
          near(location.longitude, fields.longitude) &&
          (location.address || location.name).slice(0, PLACE_MAX) === fields.place.trim(),
      )
    : null;
  const kept = Boolean(keptLocation);

  // The spot on the map, kept as one of the account's places under a name.
  async function saveLocation() {
    const name = (naming ?? "").trim();
    if (!name) return;
    try {
      const answer = await api.saveLocation({
        name,
        address: fields.place.trim(),
        latitude: fields.latitude,
        longitude: fields.longitude,
        region: fields.region,
        // Somebody else's item is at a public place, kept for everybody.
        shared: fields.shared,
      });
      (fields.shared ? setPublicLocations : setLocations)((current) => [
        ...current.filter((each) => each.id !== answer.location.id),
        answer.location,
      ]);
      setNaming(null);
      showToast(t("item.locationSaved"), 2000);
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  // Somebody else's new item is put at the public place nearest the reader,
  // by itself, as soon as it is known where the reader is: the likeliest of
  // them, there to be changed. Once only, and not over a spot put by hand.
  const { shared } = fields;
  useEffect(() => {
    if (!isOpen || !shared || !autoPlace.current || !here || publicLocations.length === 0) return;
    autoPlace.current = false;
    // Near enough for choosing between places: degrees, with the ones east
    // and west narrowed to what they are at this latitude.
    const squeeze = Math.cos((here.latitude * Math.PI) / 180);
    const far = (place) => Math.hypot(place.latitude - here.latitude, (place.longitude - here.longitude) * squeeze);
    const nearest = publicLocations.reduce((best, place) => (far(place) < far(best) ? place : best));
    placeTyped.current = true;
    setFields((current) =>
      current.located
        ? current
        : {
            ...current,
            located: true,
            latitude: nearest.latitude,
            longitude: nearest.longitude,
            place: (nearest.address || nearest.name).slice(0, PLACE_MAX),
          },
    );
  }, [isOpen, shared, here, publicLocations]);

  // Until somebody picks an area, the item is offered in the town the reader
  // is in: from where the browser says they are, or failing that from where
  // the map is looking. Where the item's pin is put has no say in it. The
  // answer most people would give, there to be changed; and never written
  // over one somebody has picked.
  useEffect(() => {
    if (!isOpen || !MAPBOX_TOKEN || regionPicked.current) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      const spot = await whereabouts();
      if (cancelled || !spot) return;
      setHere(spot);
      areaAt(spot.latitude, spot.longitude, placeLang, controller.signal)
        .then((area) => {
          const region = areaOf(area);
          if (region && !cancelled && !regionPicked.current) setFields((current) => ({ ...current, region }));
        })
        .catch(() => {});
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isOpen, placeLang]);

  // The day pressed on the calendar of an item booked by the time, and the week
  // it is in, Sunday first: the seven dates the timetable shows.
  const [hoursDay, setHoursDay] = useState(today);
  const hoursWeek = useMemo(() => {
    const sunday = addDays(hoursDay, -new Date(`${hoursDay}T00:00:00Z`).getUTCDay());
    return daysBetween(sunday, addDays(sunday, 6));
  }, [hoursDay]);

  // A press on a date of an item booked by the date goes against the rule for
  // days: a day the rule has is closed, and opened again; a day the rule leaves
  // out is opened, and left out again.
  function toggleDay(day) {
    const flip = (list) => (list.includes(day) ? list.filter((each) => each !== day) : [...list, day]);
    setFields((current) =>
      openByRule({ openDays: current.openDays }, day)
        ? { ...current, closed: flip(current.closed) }
        : { ...current, opened: flip(current.opened) },
    );
  }

  // The rule for days, ticked and unticked. The last day cannot be unticked: an
  // item that can be had on no day of the week is not a rule anybody means.
  function setOpenDays(days) {
    if (days.length === 0) return;
    set("openDays", days);
  }

  // How finely the hours it can be had are said: by the half hour, or by the
  // unit it is booked in or priced in where either is finer — ten minutes at
  // a time, where ten minutes is what is booked or what is priced. The
  // timetable's cells and the times in the dropdowns are both this.
  const hourStep = Math.min(STEP, fields.unit, fields.priceUnit);
  const TIME_OPTIONS = useMemo(() => timeOptions(hourStep), [hourStep]);
  const hourRules = fields.hourRules;
  const setHourRules = (change) => setFields((current) => ({ ...current, hourRules: change(current.hourRules) }));
  const setHourRule = (id, patch) =>
    setHourRules((list) => list.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));

  // What the form comes to, as the item its page would be drawn from: the
  // calendar in here and the preview are both this.
  const { mode } = fields;
  const byTime = mode === "time";
  // Booked by asking: no calendar and no request, only how the owner is reached.
  const inquiry = mode === "inquiry";
  const byDay = !byTime && !inquiry;
  // The hours it is handed over in, as they are kept: both ends or neither.
  const { dayHours } = fields;
  const keptDayHours = byDay && dayHours.start && dayHours.end ? dayHours : null;
  const contacts = fields.contacts
    // A phone number is kept as its digits, and shown that way too, with
    // the code it is dialled with from abroad beside it. A message here has
    // nothing written for it, and is not a way to reach somebody else.
    .map((contact) =>
      contact.type === "phone"
        ? { type: "phone", code: contact.code ?? dialCode, value: contact.value.replace(/\D/g, "") }
        : contact.type === "message"
          ? { type: "message", value: "" }
          : { type: contact.type, value: contact.value.trim() },
    )
    .filter((contact) => (contact.type === "message" ? !fields.shared : contact.value));
  const setContact = (index, patch) => {
    contactsTouched.current = true;
    setFields((current) => ({
      ...current,
      contacts: current.contacts.map((contact, each) => (each === index ? { ...contact, ...patch } : contact)),
    }));
  };
  const rates = cleanRates(fields, byTime);
  // Every hour the item has: the rules, then what was painted for dates.
  const hours = byTime ? [...cleanHourRules(hourRules), ...fields.hourDates] : [];
  const openDays = fields.openDays.length === 7 ? null : fields.openDays;
  // The rule for calling off as it would be kept: at least a day before,
  // where it is so many days before.
  const cancelCount = Math.max(1, Number(fields.cancelCount) || 1);
  const cancel =
    fields.cancelMode !== "before"
      ? { mode: fields.cancelMode }
      : fields.cancelUnit === "hours"
        ? { mode: "hours", hours: Math.min(999, cancelCount) }
        : { mode: "days", days: Math.min(365, cancelCount) };
  // What the calendar's single dates say, where it still goes against the
  // rule: a date closed that the rule has, one opened that it leaves out.
  const closed = fields.closed.filter((day) => openByRule({ openDays }, day));
  const opened = fields.opened.filter((day) => !openByRule({ openDays }, day));
  const draft = {
    id: item?.id ?? "preview",
    title: fields.title.trim() || t("item.titlePlaceholder"),
    description: fields.description.trim(),
    homepage: homepageOf(fields.homepage),
    kind: fields.kind,
    category: fields.category,
    shared: fields.shared,
    mode,
    unit: fields.unit,
    priceUnit: inquiry ? fields.inquiryUnit : fields.priceUnit,
    cancel,
    contacts,
    rates,
    hours,
    hoursOff: byTime ? fields.hoursOff : [],
    openDays,
    dayHours: keptDayHours,
    // It may be left without one: priced on request.
    price: rates.length === 0 ? null : listPrice(mode, rates),
    currency: fields.currency,
    images: fields.images,
    thumb: fields.images[0]?.thumb ?? null,
    located: fields.located,
    latitude: fields.latitude,
    longitude: fields.longitude,
    place: fields.located ? fields.place.trim() : "",
    region: fields.region,
    moreRegions: fields.moreRegions.filter(Boolean),
    active: true,
    owner: fields.shared ? null : (user?.username ?? ""),
    mine: false,
    createdAt: item?.createdAt ?? null,
  };
  const draftCalendar = useMemo(
    () => ({
      from: today(),
      until: addDays(today(), CALENDAR_DAYS),
      // What the form decides about single days: which are closed, and which
      // are opened though the rule for days leaves them out. A price a date
      // was once given on the item's page is among the form's own dates now.
      days: [
        ...closed.map((day) => ({ day, available: false, price: null })),
        ...opened.map((day) => ({ day, available: true, price: null })),
      ],
      taken: calendar?.taken ?? [],
    }),
    // The two lists are made afresh each time; what they hold is what counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendar, closed.join(), opened.join()],
  );

  // The booking page this draft comes to, opened beside the form as the page it
  // will be (see pages/PreviewPage). Pressed again after a change, the same tab
  // comes forward holding the newer draft.
  function preview() {
    if (!writePreview({ item: draft, calendar: draftCalendar }) || !openPreview()) {
      showToast(t("item.previewBlocked"), 3000);
    }
  }

  // What is wrong with the first part, and with the whole of it.
  function itemFault() {
    if (!fields.title.trim()) return t("item.titleRequired");
    if (!fields.region) return t("item.regionRequired");
    return "";
  }

  function fault() {
    const first = itemFault();
    if (first) return first;
    if (byTime && hourRules.some((rule) => !timed(rule) || rule.start >= rule.end)) return t("item.ruleTimesWrong");
    if (byDay && (dayHours.start || dayHours.end) && !(dayHours.start && dayHours.end && dayHours.start < dayHours.end)) {
      return t("item.dayHoursWrong");
    }
    if (byTime && hours.length === 0) return t("item.hoursRequired");
    // Booked by asking, the first way to reach the owner has to be written.
    if (inquiry && contacts.length === 0) return t("item.contactRequired");
    return "";
  }

  function next() {
    const problem = itemFault();
    if (problem) return setError(problem);
    setError("");
    setStep("availability");
  }

  async function save(event) {
    event.preventDefault();
    if (saving || uploading > 0) return;
    // A new item's first part is not saved: it goes on to the second.
    if (!editing && step === "item") return next();
    const problem = fault();
    if (problem) return setError(problem);
    setSaving(true);
    setError("");
    const body = {
      title: fields.title.trim(),
      description: fields.description.trim(),
      homepage: fields.homepage.trim(),
      ...(page && { pageId: page.id }),
      kind: fields.kind,
      category: fields.category,
      shared: fields.shared,
      mode,
      unit: fields.unit,
      priceUnit: inquiry ? fields.inquiryUnit : fields.priceUnit,
      cancel,
      contacts,
      rates,
      hours,
      hoursOff: byTime ? fields.hoursOff : [],
      openDays,
      dayHours: keptDayHours,
      currency: fields.currency,
      images: fields.images,
      latitude: fields.located ? fields.latitude : null,
      longitude: fields.located ? fields.longitude : null,
      place: fields.located ? fields.place.trim() : "",
      region: fields.region,
      moreRegions: fields.moreRegions.filter(Boolean),
      // Saving the form publishes the item: one that was not public yet —
      // registered from the phone, to be finished here — is from now on. Where
      // it is shown follows from what it has: on the map if it has a location,
      // by search and by its link either way.
      active: true,
      closed,
      opened,
    };
    try {
      const data = editing ? await api.updateItem(item.id, body) : await api.createItem(body);
      // A price a date was given on the item's page, from when that could be
      // done there, is kept with the item's own rules now (see
      // startingPricing): the calendar's copy is let go of, so the two cannot
      // come to say different things. Not a date the form has just closed.
      const stale = byTime
        ? []
        : (calendar?.days ?? []).filter((day) => day.available && day.price != null && !closed.includes(day.day)).map((day) => day.day);
      if (editing && stale.length > 0) await api.setDays(item.id, { days: stale, available: true, price: null });
      onSaved?.(data.item, data.page);
    } catch (requestError) {
      setError(
        requestError.code === "REGION_REQUIRED"
          ? t("item.regionRequired")
          : requestError.code === "HOURS_REQUIRED"
            ? t("item.hoursRequired")
            : requestError.code === "CONTACT_REQUIRED"
              ? t("item.contactRequired")
              : requestError.message,
      );
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || uploading > 0;
  const withIcon = (slug, name) => (
    <span className={styles.category}>
      <CategoryIcon kind={fields.kind} category={slug} />
      {name}
    </span>
  );
  const categories = [
    // Each row leads with the category's own mark — the one its pin will wear
    // on the map — so the list is recognised as well as read.
    { value: "", label: withIcon("", t("item.categoryNone")), text: t("item.categoryNone") },
    // `text` is what the dropdown's search reads: the name, and the slug too so
    // the English word finds a row whatever language the names are in.
    // A grown-up category only for an account old enough for it — or where
    // the item is in one already, so that editing it does not empty the box.
    ...categoriesFor(fields.kind, Boolean(user?.adult) || CATEGORIES[fields.kind].includes(fields.category) && !categoriesFor(fields.kind).includes(fields.category)).map((slug) => ({
      value: slug,
      label: withIcon(slug, t(`category.${slug}`)),
      text: `${t(`category.${slug}`)} ${slug}`,
    })),
  ];

  // The dates it can be had: the rule for days, and the calendar that rule
  // comes to. Written here once and stood in one column or the other, by how
  // the item is booked (see the second sheet below).
  const datesField = (
              <div className="field">
                <span className="field-label">
                  {t("item.availability")}
                  {!byTime && closed.length > 0 && (
                    <span className="field-count">{t("item.closedCount", { count: closed.length })}</span>
                  )}
                </span>
                {/* The rule for days: the days of the week it can be had. The
                    calendar under it is what the rule comes to, date by date. */}
                <div className={styles.dayRule}>
                  <span className={styles.everyDay}>{t("item.openDays")}</span>
                  <Weekdays value={fields.openDays} onChange={setOpenDays} names={names} label={t("item.openDays")} />
                </div>
                {/* By the date, a press closes a day or opens it again. By the
                    time, a day can be had once it has hours, so a press picks
                    the day whose week the timetable below is showing. */}
                <Calendar
                  item={draft}
                  calendar={draftCalendar}
                  // By the time the calendar is only read: which week the
                  // timetable shows is turned to beside the timetable itself.
                  onToggle={byTime ? undefined : toggleDay}
                  // The pencil beside a date's price asks what its own base price is.
                  onOpen={(day) => setPricing({ day, price: fields.datePrices[day] ?? "" })}
                />
                <span className={styles.hint}>{t(byTime ? "item.availabilityHintTime" : "item.availabilityHint")}</span>
              </div>
  );

  // The part on show: the one asked for, for an item that exists; the step a
  // new one has got to.
  const shown = editing ? part : step;

  return (
    <>
      <Modal
        isOpen={isOpen}
        title={shown === "availability" ? t("item.availabilityTitle") : editing ? t("item.editTitle") : t("item.newTitle")}
        // Withheld while something is on its way up, so a stray Escape does
        // not drop a form with a photograph half sent.
        onClose={busy ? undefined : onClose}
        large
      >
        <form className={styles.form} onSubmit={save} autoComplete="off" data-save>
          <div className={styles.columns}>
            {/* ------------------------------------------------- what it is */}
            {shown === "item" && (
            <>
            <div className={styles.column}>
              {/* First of all, whose it is: the account's own, or somebody
                  else's that the account is writing down — a shop it knows
                  of, say. The second is everybody's to keep right: anybody
                  signed in can change it or delete it. Asked of whoever put
                  it here; somebody else editing it is not asked, since it
                  is not theirs to take. */}
              {!page && (!editing || (item.mine && !item.shared)) && (
                <div className="field">
                  <span className="field-label">{t("item.whose")}</span>
                  <div className="tabs" role="group" aria-label={t("item.whose")}>
                    {[false, true].map((each) => (
                      <button
                        key={String(each)}
                        type="button"
                        className={fields.shared === each ? "tab active" : "tab"}
                        aria-pressed={fields.shared === each}
                        // Somebody else's is booked by asking and no
                        // other way: nobody here could answer a request.
                        // The account's own starts by the date again. And
                        // how the account itself is reached is not how
                        // somebody else is: it goes from the one and comes
                        // back to the other, unless something else was
                        // written over it.
                        onClick={() =>
                          setFields((current) => {
                            if (current.shared === each) return current;
                            const mode = each ? "inquiry" : "day";
                            // Written by hand, they stay — but for a message
                            // here, which somebody else's cannot be sent.
                            const written = each ? current.contacts.filter((contact) => contact.type !== "message") : current.contacts;
                            const contacts = !contactsTouched.current
                              ? startingContacts(mode, each, ownContacts)
                              : written.length > 0
                                ? written
                                : noContacts();
                            return { ...current, shared: each, mode, contacts };
                          })
                        }
                      >
                        {t(each ? "item.whoseOthers" : "item.whoseMine")}
                      </button>
                    ))}
                  </div>
                  <span className={styles.hint}>{t(fields.shared ? "item.whoseOthersHint" : "item.whoseMineHint")}</span>
                </div>
              )}
              {/* Which kind of thing it is, before anything else is said of it:
                  the one question whose answer is known before a photograph
                  is taken. */}
              <div className="field">
                <span className="field-label">{t("item.kind")}</span>
                <div className="tabs" role="group">
                  {(page ? [page.kind] : KINDS).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={fields.kind === kind ? "tab active" : "tab"}
                      aria-pressed={fields.kind === kind}
                      onClick={() => setFields((current) => ({ ...current, kind, category: "" }))}
                    >
                      {/* One's own time is a skill one has; somebody else's
                          is a service they give. The kind kept is the same. */}
                      {t(kind === "service" && !fields.shared ? "kind.skill" : `kind.${kind}`)}
                    </button>
                  ))}
                </div>
                <span className={styles.hint}>{t(`kind.${fields.kind}Hint`)}</span>
              </div>

              {/* Then the photographs: they are what is taken before anything
                  is written. */}
              <div className="field">
                <span className="field-label">
                  {t("item.photos")}
                  <span className="field-count">
                    {fields.images.length}/{IMAGES_MAX}
                  </span>
                </span>
                <div className={styles.photos}>
                  {fields.images.map((image, index) => (
                    <span key={image.src} className={index === 0 ? `${styles.photo} ${styles.photoMain}` : styles.photo}>
                      {/* Pressing a photograph makes it the main one: the
                          first in the row, and the one a pin on the map wears. */}
                      <button
                        type="button"
                        className={styles.photoPick}
                        onClick={() =>
                          set("images", [image, ...fields.images.filter((each) => each.src !== image.src)])
                        }
                        disabled={index === 0}
                        aria-label={t("item.photoMakeMain")}
                        title={index === 0 ? t("item.photoMain") : t("item.photoMakeMain")}
                      >
                        <img src={image.thumb} alt="" loading="lazy" />
                      </button>
                      {index === 0 && <span className={styles.photoBadge}>{t("item.photoMain")}</span>}
                      <button
                        type="button"
                        className={styles.photoRemove}
                        onClick={() => set("images", fields.images.filter((each) => each.src !== image.src))}
                        aria-label={t("item.photoRemove")}
                        title={t("item.photoRemove")}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                      </button>
                    </span>
                  ))}
                  {Array.from({ length: uploading }, (_, index) => (
                    // Placeholders for what is still going up; they have no identity.
                    // eslint-disable-next-line react/no-array-index-key
                    <span key={`up-${index}`} className={`${styles.photo} ${styles.photoWaiting}`} aria-hidden="true" />
                  ))}
                  {fields.images.length + uploading < IMAGES_MAX && (
                    <button
                      type="button"
                      className={styles.photoAdd}
                      onClick={() => fileRef.current?.click()}
                      aria-label={t("item.photoAdd")}
                      title={t("item.photoAdd")}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                  )}
                </div>
                <span className={styles.hint}>{t("item.photosHint")}</span>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={addPhotos} />
              </div>

              {/* Under the photographs, a field of its own: the rest of what
                  the thing is — its category, its name and what is said about
                  it, and its kind where the picture says otherwise — made out
                  from the main one, with a line saying so. */}
              <div className="field">
                <button
                  type="button"
                  className={`small-button ${styles.start}`}
                  onClick={generate}
                  disabled={fields.images.length === 0 || uploading > 0 || generating}
                >
                  {t(generating ? "item.generating" : "item.generate")}
                </button>
                <span className={styles.hint}>{t("item.generateHint")}</span>
              </div>

              <div className="field">
                <span className="field-label">{t("item.category")}</span>
                <Select
                  sans
                  label={t("item.category")}
                  value={fields.category}
                  onChange={(value) => set("category", value)}
                  options={categories}
                  searchPlaceholder={t("item.categorySearch")}
                  emptyLabel={t("item.categoryNoMatch")}
                />
              </div>

              <label className="field">
                <span className="field-label">{t("item.title")}</span>
                <input
                  className="text-input"
                  value={fields.title}
                  onChange={(event) => set("title", event.target.value)}
                  placeholder={t("item.titlePlaceholder")}
                  maxLength={TITLE_MAX}
                />
              </label>

              <label className="field">
                <span className="field-label">
                  {t("item.description")}
                  <span className="field-count">
                    {fields.description.length}/{DESCRIPTION_MAX}
                  </span>
                </span>
                <TextArea
                  className="text-area"
                  value={fields.description}
                  onChange={(event) => set("description", event.target.value)}
                  placeholder={t("item.descriptionPlaceholder")}
                  maxLength={DESCRIPTION_MAX}
                  rows={5}
                  minHeight={110}
                />
              </label>
            </div>

            {/* The item's sheet has two columns where there is room: what it
                is on the left, and where it is on the right. */}
            <div className={styles.column}>
              {/* Its own page somewhere else, where it has one: shown on the
                  item's page over how its owner is reached. */}
              <label className="field">
                <span className="field-label">{t("item.homepage")}</span>
                <input
                  className="text-input"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={fields.homepage}
                  onChange={(event) => set("homepage", event.target.value)}
                  placeholder="https://"
                  maxLength={HOMEPAGE_MAX}
                />
              </label>

              {/* The area it is offered in, which every item has to say: it is
                  what lists it for the people looking there, pin or no pin.
                  Filled in with the town the item is in; changing it, or
                  starting to, makes it the reader's own choice. */}
              <div className="field">
                <span className="field-label">{t("item.region")}</span>
                <AreaField
                  value={fields.region}
                  near={here}
                  taken={fields.moreRegions}
                  onChange={(region) => {
                    regionPicked.current = true;
                    set("region", region);
                  }}
                />
                {/* More areas, for something that stands between two: each
                    picked the same way, and taken off again at its right. */}
                {fields.moreRegions.map((region, index) => (
                  <div key={index} className={styles.moreArea}>
                    <AreaField
                      value={region}
                      near={here}
                      taken={[fields.region, ...fields.moreRegions.filter((_, at) => at !== index)]}
                      onChange={(picked) =>
                        setFields((current) => ({
                          ...current,
                          moreRegions: current.moreRegions.map((each, at) => (at === index ? picked : each)),
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="small-button"
                      onClick={() =>
                        setFields((current) => ({ ...current, moreRegions: current.moreRegions.filter((_, at) => at !== index) }))
                      }
                    >
                      {t("item.regionRemove")}
                    </button>
                  </div>
                ))}
                {fields.moreRegions.length < MORE_REGIONS_MAX && (
                  <button
                    type="button"
                    className={`small-button ${styles.start}`}
                    // One at a time: the last one added is picked first.
                    disabled={!fields.region || fields.moreRegions.some((region) => !region)}
                    onClick={() => setFields((current) => ({ ...current, moreRegions: [...current.moreRegions, null] }))}
                  >
                    {t("item.regionAdd")}
                  </button>
                )}
                <span className={styles.hint}>{t("item.regionHint")}</span>
              </div>

              <div className="field">
                <span className="field-label">
                  {t("item.location")}
                  {fields.located && <span className="field-count">{formatCoords(fields.latitude, fields.longitude)}</span>}
                </span>
                {/* The places to put it at: choosing one puts the pin there.
                    The account's own for its own item; for somebody else's,
                    the public ones, which is not at any of the account's.
                    Always here, so that it is known there is such a list:
                    with none in it yet, it says so. */}
                {(
                  <Select
                    sans
                    label={t(fields.shared ? "item.locationChoosePublic" : "item.locationChoose")}
                    // The place the pin is at, where it is one of them: the box
                    // says its name until the pin is moved off it.
                    value={keptLocation?.id ?? ""}
                    onChange={putAt}
                    options={[
                      { value: "", label: t(fields.shared ? "item.locationChoosePublic" : "item.locationChoose") },
                      // Not a place: choosing it puts the pin nowhere.
                      ...(locations.length === 0
                        ? [{ value: "none", label: t(fields.shared ? "item.locationNonePublic" : "item.locationNone") }]
                        : []),
                      // Each place on two lines: what it is called and where,
                      // and under that, in grey, the spot itself.
                      ...locations.map((location) => {
                        const line = location.address ? `${location.name} — ${location.address}` : location.name;
                        return {
                          value: location.id,
                          text: line,
                          // In the closed box, the one line of it.
                          short: line,
                          label: (
                            <span className={styles.location}>
                              <span>{line}</span>
                              <span className={styles.locationSpot}>
                                {formatCoords(location.latitude, location.longitude)}
                              </span>
                            </span>
                          ),
                        };
                      }),
                    ]}
                  />
                )}
                {fields.located ? (
                  <>
                    <div className={styles.map}>
                      <SpotMap
                        latitude={fields.latitude}
                        longitude={fields.longitude}
                        target={spotTarget}
                        onMove={(spot) => {
                          // The pin has been put somewhere else, so the name it
                          // had belongs to where it was: the line under it goes
                          // back to following the pin, typed over or not.
                          placeTyped.current = false;
                          setFields((current) => ({ ...current, ...spot }));
                        }}
                      />
                      {/* What the spot is called, on the map it is a name for:
                          in the middle of its bottom edge, where the front
                          page's map says what it is showing. It follows the
                          pin until somebody types over it. */}
                      <input
                        className={styles.place}
                        value={fields.place}
                        onChange={(event) => {
                          placeTyped.current = event.target.value.trim() !== "";
                          set("place", event.target.value);
                        }}
                        placeholder={t("item.placePlaceholder")}
                        maxLength={PLACE_MAX}
                        aria-label={t("item.place")}
                      />
                    </div>
                    {/* Under the map: keeping the spot at the left, taking it off
                        the item at the right. */}
                    <div className={styles.locationActions}>
                      {/* The spot kept for next time, under a name of its own —
                          unless it is one of the places already. The account's
                          own for its own item; for somebody else's the public
                          ones, in the public account's folder, by the same
                          button. The empty span keeps Remove at the right. */}
                      {kept ? (
                        <span />
                      ) : naming === null ? (
                        <button type="button" className="small-button" onClick={() => setNaming("")}>
                          {t("item.locationSave")}
                        </button>
                      ) : (
                        <div className={styles.naming}>
                          <input
                            className="text-input"
                            value={naming}
                            onChange={(event) => setNaming(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter") return;
                              event.preventDefault();
                              saveLocation();
                            }}
                            placeholder={t("item.locationName")}
                            maxLength={60}
                            autoFocus
                          />
                          <button type="button" className="small-button" onClick={saveLocation} disabled={!naming.trim()}>
                            {t("common.save")}
                          </button>
                          <button type="button" className="small-button" onClick={() => setNaming(null)}>
                            {t("common.cancel")}
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        className="small-button"
                        onClick={() => {
                          placeTyped.current = false;
                          autoPlace.current = false;
                          setFields((current) => ({ ...current, located: false, place: "" }));
                        }}
                      >
                        {t("item.locationRemove")}
                      </button>
                    </div>
                    <span className={styles.hint}>{t("item.locationHint")}</span>
                  </>
                ) : (
                  <>
                    <button type="button" className={`small-button ${styles.start}`} onClick={addLocation}>
                      {t("item.locationAdd")}
                    </button>
                    <span className={styles.hint}>{t("item.locationOptional")}</span>
                  </>
                )}
              </div>
            </div>
            </>
            )}

            {/* ------------------------------------- what it costs, and when */}
            {shown === "availability" && (
            <>
            <div className={styles.column}>
              <div className="field">
                <span className="field-label">{t("item.bookingType")}</span>
                {/* The ways it can be booked: by the date, priced by the
                    day; by the date and the time, priced by the hour; or by
                    asking its owner, who says how they are reached. The
                    rules under it are read as whichever is chosen. */}
                <div className="tabs" role="group">
                  {MODES.map((each) => (
                    <button
                      key={each}
                      type="button"
                      className={mode === each ? "tab active" : "tab"}
                      aria-pressed={mode === each}
                      // Somebody else's can only be booked by asking.
                      disabled={fields.shared && each !== "inquiry"}
                      // The usual hours are never none: turned to booking
                      // by the time without any, it starts with nine in the
                      // morning to nine at night, every day, there to be
                      // changed.
                      onClick={() =>
                        setFields((current) => ({
                          ...current,
                          mode: each,
                          // How the owner is reached starts over with the way
                          // it is booked, until it is written by hand.
                          contacts: contactsTouched.current ? current.contacts : startingContacts(each, current.shared, ownContacts),
                          hourRules:
                            each === "time" && current.hourRules.length === 0
                              ? [newRule({ days: EVERY_DAY, start: "09:00", end: "21:00" })]
                              : current.hourRules,
                        }))
                      }
                    >
                      {t(`item.mode.${each}`)}
                    </button>
                  ))}
                </div>
                <span className={styles.hint}>{t(fields.shared ? "item.modeHintShared" : `item.modeHint.${mode}`)}</span>
              </div>

              {/* By the time, the piece of the clock it is asked for in: the
                  shortest stretch somebody can book, and the step a longer one
                  grows by. */}
              {byTime && (
                <div className="field">
                  <span className="field-label">{t("item.unit")}</span>
                  <div className="tabs" role="group" aria-label={t("item.unit")}>
                    {UNITS.map((each) => (
                      <button
                        key={each}
                        type="button"
                        className={fields.unit === each ? "tab active" : "tab"}
                        aria-pressed={fields.unit === each}
                        onClick={() => set("unit", each)}
                      >
                        {unitName(each, t)}
                      </button>
                    ))}
                  </div>
                  <span className={styles.hint}>{t("item.unitHint")}</span>
                </div>
              )}

              <div className="field">
                <span className="field-label">{t("item.pricing")}</span>
                <div className={styles.modeRow}>
                  <span className={styles.everyDay}>{t("item.currency")}</span>
                  <Select
                    className={styles.currency}
                    label={t("item.currency")}
                    value={fields.currency}
                    onChange={(value) => set("currency", value)}
                    options={CURRENCIES.map((code) => ({ value: code, label: code }))}
                  />
                </div>

                {/* By the time, the stretch of the clock every price is for,
                    on a line of its own: said apart from the unit it is
                    booked in — by the hour and booked by the quarter, say. */}
                {/* Booked by asking, the same line: what the price is for,
                    which here may be a whole day too. */}
                {inquiry && (
                  <div className={styles.modeRow}>
                    <span className={styles.everyDay}>{t("item.priceUnit")}</span>
                    <Select
                      className={styles.currency}
                      label={t("item.priceUnit")}
                      value={fields.inquiryUnit}
                      onChange={(value) => set("inquiryUnit", value)}
                      options={INQUIRY_UNITS.map((each) => ({ value: each, label: unitName(each, t) }))}
                    />
                  </div>
                )}
                {byTime && (
                  <div className={styles.modeRow}>
                    <span className={styles.everyDay}>{t("item.priceUnit")}</span>
                    <Select
                      className={styles.currency}
                      label={t("item.priceUnit")}
                      value={fields.priceUnit}
                      onChange={(value) => set("priceUnit", value)}
                      options={UNITS.map((each) => ({ value: each, label: unitName(each, t) }))}
                    />
                  </div>
                )}
                {/* The base price: what it is for, and — in the field at the
                    right — what that costs. By the time, what it is for is a
                    stretch of the clock the owner picks, apart from the unit
                    it is booked in: by the hour and booked by the quarter,
                    say. By the date, it is a day. A date's own base price is
                    set on the calendar of dates below, and a price for some
                    hours beside those hours. */}
                <ul className={`${styles.rules} ${styles.plain}`}>
                  <li className={styles.rule}>
                    <div className={styles.ruleWhen}>
                      <span className={styles.everyDay}>{t("item.basePricing")}</span>
                      {!byTime && !inquiry && <span className={styles.everyDay}>{t("item.aDay")}</span>}
                    </div>
                    <PriceInput
                      currency={fields.currency}
                      className={styles.rulePrice}
                      value={fields.basePrice}
                      onChange={(event) => {
                        set("basePrice", event.target.value.replace(/[^\d.]/g, ""));
                        setError("");
                      }}
                      inputMode="decimal"
                      placeholder={t("item.price")}
                      aria-label={t("item.basePricing")}
                      maxLength={12}
                    />
                  </li>
                </ul>
                {/* Rules from when prices were written freely, which are none
                    of the three layers: still in force, and said to be. */}
                {fields.extraRates.length > 0 && (
                  <span className={styles.hint}>
                    {t("item.extraRates", { count: fields.extraRates.length })}{" "}
                    <button type="button" className={styles.clear} onClick={() => set("extraRates", [])}>
                      {t("item.extraRatesClear")}
                    </button>
                  </span>
                )}
                <span className={styles.hint}>{t(`item.pricingHint.${mode}`)}</span>
              </div>
              {/* The rule for calling a booking off, once the owner has said
                  yes to it: any time, never, or until so many days before it
                  starts — and for the last, how many. */}
              {!inquiry && (
              <div className="field">
                <span className="field-label">{t("item.cancelRule")}</span>
                <div className="tabs" role="group" aria-label={t("item.cancelRule")}>
                  {CANCEL_MODES.map((each) => (
                    <button
                      key={each}
                      type="button"
                      className={fields.cancelMode === each ? "tab active" : "tab"}
                      aria-pressed={fields.cancelMode === each}
                      onClick={() => set("cancelMode", each)}
                    >
                      {t(`item.cancelMode.${each}`)}
                    </button>
                  ))}
                </div>
                {/* Before: how many, and then what is counted — days, or
                    hours. */}
                {fields.cancelMode === "before" && (
                  <div className={styles.before}>
                    <input
                      className={`text-input mono ${styles.days}`}
                      value={fields.cancelCount}
                      onChange={(event) => set("cancelCount", event.target.value.replace(/\D/g, "").slice(0, 3))}
                      inputMode="numeric"
                      aria-label={t("item.cancelCount")}
                    />
                    <Select
                      className={styles.currency}
                      label={t("item.cancelUnit")}
                      value={fields.cancelUnit}
                      onChange={(value) => set("cancelUnit", value)}
                      options={CANCEL_UNITS.map((each) => ({ value: each, label: t(`item.cancelUnits.${each}`) }))}
                    />
                  </div>
                )}
                <span className={styles.hint}>{cancelLine(cancel, t)}</span>
              </div>
              )}

              {/* By the date, the hours of the day it is handed over in — when
                  it can be picked up and brought back: last on the left, under
                  what it costs. Left at --:--, any time will do. */}
              {byDay && (
                <div className="field">
                  <span className="field-label">{t("item.dayHours")}</span>
                  <span className={styles.ruleTimes}>
                    {["start", "end"].map((edge) => (
                      <Select
                        key={edge}
                        className={styles.ruleTime}
                        label={t(`item.ruleTime.${edge}`)}
                        value={dayHours[edge]}
                        onChange={(value) => {
                          setFields((current) => ({ ...current, dayHours: { ...current.dayHours, [edge]: value } }));
                          setError("");
                        }}
                        options={DAY_TIME_OPTIONS}
                      />
                    ))}
                  </span>
                  <span className={styles.hint}>{t("item.dayHoursHint")}</span>
                </div>
              )}

              {/* By the time, the dates stand here, under the price, and the
                  column beside is the hours'. */}
              {byTime && datesField}
            </div>

            {/* This sheet has two columns too. By the date: how it is booked,
                what it costs and the hours of the day on the left, the dates
                it can be had on the right. By the time: the dates go left with the rest, and the
                right is the hours. */}
            <div className={styles.column}>
              {/* By the date, the dates are this column's. */}
              {byDay && datesField}

              {/* The hours it can be had, where it is booked by the time: under
                  the dates. First the usual hours — these hours, on these
                  days of the week — and then one week of what they come to,
                  the week turned to with the arrows over it, where a date can
                  be painted to have hours of its own. */}
              {byTime && (
                <div className="field">
                  <span className="field-label">
                    {t("item.hours")}
                  </span>
                  {/* First the usual hours: these hours, on these days of the
                      week, and what they cost where that is not the base
                      price. */}
                  <span className={`field-label ${styles.sub}`}>{t("item.usualHours")}</span>
                  <ul className={styles.rules}>
                    {hourRules.map((rule) => (
                      <li key={rule.id} className={styles.rule}>
                        <div className={styles.ruleWhen}>
                          <Weekdays
                            value={rule.days}
                            // The last day cannot be unticked: hours on no
                            // day of the week are not hours.
                            onChange={(days) => days.length > 0 && setHourRule(rule.id, { days })}
                            // A day the item cannot be had on at all — left
                            // unticked in the rule for days — is greyed here:
                            // hours on it would be hours nobody can book.
                            allowed={fields.openDays}
                            names={names}
                            label={t("item.ruleDays")}
                          />
                          <span className={styles.ruleTimes}>
                            {["start", "end"].map((edge) => (
                              <Select
                                key={edge}
                                className={styles.ruleTime}
                                label={t(`item.ruleTime.${edge}`)}
                                value={rule[edge]}
                                onChange={(value) => {
                                  setHourRule(rule.id, { [edge]: value });
                                  setError("");
                                }}
                                options={TIME_OPTIONS}
                              />
                            ))}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={styles.ruleRemove}
                          onClick={() => setHourRules((list) => list.filter((each) => each.id !== rule.id))}
                          // The last of them cannot be taken off.
                          disabled={hourRules.length <= 1}
                          aria-label={t("item.ruleRemove")}
                          title={t("item.ruleRemove")}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6 6 18" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {hourRules.length < HOUR_RULES_MAX && (
                    <button
                      type="button"
                      className={`small-button ${styles.start}`}
                      onClick={() => setHourRules((list) => [...list, newRule({ days: EVERY_DAY, start: "09:00", end: "18:00" })])}
                    >
                      {t("item.hourRuleAdd")}
                    </button>
                  )}
                  <span className={styles.hint}>{t("item.hourRulesHint")}</span>

                  {/* The week on show, between the ways to the one before it
                      and the one after: not back past this week, nor on past
                      the end of the calendar. */}
                  <div className={styles.weekNav}>
                    <button
                      type="button"
                      onClick={() => setHoursDay(addDays(hoursDay, -7))}
                      disabled={hoursWeek[0] <= today()}
                      aria-label={t("calendar.previous")}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m15 18-6-6 6-6" />
                      </svg>
                    </button>
                    <strong>{formatRange(hoursWeek[0], hoursWeek[6], lang)}</strong>
                    <button
                      type="button"
                      onClick={() => setHoursDay(addDays(hoursDay, 7))}
                      disabled={addDays(hoursWeek[6], 1) > addDays(today(), CALENDAR_DAYS)}
                      aria-label={t("calendar.next")}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </button>
                  </div>
                  <WeekHours
                    value={{ hours, hoursOff: fields.hoursOff, openDays }}
                    onChange={(painted) =>
                      setFields((current) => ({
                        ...current,
                        hourDates: painted.hours.filter((range) => range.dates),
                        hoursOff: painted.hoursOff,
                      }))
                    }
                    names={names}
                    dates={hoursWeek}
                    from={today()}
                    step={hourStep}
                    // The dates of this week whose hours were painted, each
                    // with the way back to the usual hours beside its name:
                    // what was painted for it — or its being wiped — let go
                    // of, and the other dates left as they are.
                    painted={hoursWeek.filter(
                      (day) => fields.hoursOff.includes(day) || fields.hourDates.some((range) => range.dates.includes(day)),
                    )}
                    onRevert={(day) =>
                      setFields((current) => ({
                        ...current,
                        hourDates: current.hourDates
                          .map((range) => ({ ...range, dates: range.dates.filter((each) => each !== day) }))
                          .filter((range) => range.dates.length > 0),
                        hoursOff: current.hoursOff.filter((each) => each !== day),
                      }))
                    }
                    revertLabel={t("item.hoursClear")}
                    // What each stretch costs, written on it: the price in
                    // force on that date when the stretch starts — the
                    // date's own base price where it has one.
                    priceAt={(day, time) => compactPrice(hourPrice(draft, day, time), fields.currency, lang)}
                    // The same figure written out in full, for when the
                    // pointer asks about a stretch.
                    // Said under the pointer with what stretch of the clock
                    // it is for: "¥1,500 / 30 min".
                    fullPriceAt={(day, time) =>
                      t("item.perHour", {
                        price: wholePrice(hourPrice(draft, day, time), fields.currency, lang),
                        unit: unitName(fields.priceUnit, t),
                      })
                    }
                    // The pencil after each of those prices asks what that
                    // one cell of that one date costs.
                    // one cell of that one date costs — and is answered for
                    // a stretch of the date, which starts out as that cell
                    // and can be drawn out as far as the stretch of hours the
                    // cell is in reaches (`from` to `until`), and no further.
                    onPrice={(day, start, end, run) => {
                      const own = fields.slotPrices.find((slot) => slot.day === day && slot.start <= start && slot.end >= end);
                      setPricing({ day, start, end, from: run.start, until: run.end, price: own?.price ?? "" });
                    }}
                    priceLabel={t("item.slotPriceEdit")}
                  />
                  <span className={styles.hint}>{t("item.hoursHint")}</span>
                </div>
              )}

              {/* Last of all on the sheet. */}
              {/* How the owner is reached, whichever way it is booked: the
                  first way, the second, the third and so on, each a kind — a
                  phone number, an email address, an address, a message here
                  — and what is written for it. Booked by asking, the first
                  has to be given; the others are added with the + under them
                  and taken off with the cross beside them, and the ones
                  after move up a place. */}
              {(
                <div className="field">
                  <span className="field-label">{t("item.contact")}</span>
                  {fields.contacts.map((contact, index) => (
                    <div key={index} className={styles.contact}>
                      <span className={`field-label ${styles.sub}`}>{t(`item.contactNth.${index}`)}</span>
                      <div className={styles.contactRow}>
                        <Select
                          className={styles.currency}
                          label={t("item.contactType")}
                          value={contact.type}
                          // Turned into a phone number, what is written
                          // already loses whatever is not a digit.
                          onChange={(value) =>
                            setContact(index, {
                              type: value,
                              value: value === "message" ? "" : value === "phone" ? contact.value.replace(/\D/g, "") : contact.value,
                            })
                          }
                          // A message here is said once, and not of somebody
                          // else's, which has no account to send one to.
                          options={CONTACT_TYPES.filter(
                            (each) =>
                              each !== "message" ||
                              contact.type === "message" ||
                              (!fields.shared && !fields.contacts.some((other) => other.type === "message")),
                          ).map((each) => ({ value: each, label: t(`item.contactTypes.${each}`) }))}
                        />
                        {/* A phone number's code, chosen in front of it: the
                            reader's own country's until another is. The box
                            says the code; the list says whose it is. */}
                        {contact.type === "phone" && (
                          <Select
                            className={styles.currency}
                            fit
                            label={t("item.contactCode")}
                            value={contact.code ?? dialCode}
                            onChange={(value) => setContact(index, { code: value })}
                            searchPlaceholder={t("item.contactCodeSearch")}
                            emptyLabel={t("item.contactCodeNoMatch")}
                            options={dialOptions}
                          />
                        )}
                        {contact.type === "message" && <span className={styles.contactNote}>{t("item.contactMessageNote")}</span>}
                        <input
                          className="text-input"
                          hidden={contact.type === "message"}
                          type={CONTACT_INPUT[contact.type] ?? "text"}
                          value={contact.value}
                          onChange={(event) => {
                            // A phone number is typed as digits only: a
                            // hyphen typed or pasted among them is dropped
                            // at once, and its code is chosen beside it.
                            setContact(index, { value: contact.type === "phone" ? event.target.value.replace(/\D/g, "") : event.target.value });
                            setError("");
                          }}
                          maxLength={CONTACT_MAX}
                          aria-label={`${t(`item.contactNth.${index}`)} · ${t(`item.contactTypes.${contact.type}`)}`}
                        />
                        <button
                          type="button"
                          className={styles.ruleRemove}
                          onClick={() => {
                            contactsTouched.current = true;
                            setFields((current) => ({ ...current, contacts: current.contacts.filter((_, each) => each !== index) }));
                          }}
                          // The last of them cannot be taken off.
                          disabled={fields.contacts.length <= 1}
                          aria-label={t("item.contactRemove")}
                          title={t("item.contactRemove")}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6 6 18" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                  {fields.contacts.length < CONTACTS_MAX && (
                    <button
                      type="button"
                      className={`small-button ${styles.start}`}
                      onClick={() => {
                        contactsTouched.current = true;
                        setFields((current) => ({
                          ...current,
                          // The kind the next one starts as: the first not in
                          // use yet — a message here not being one for
                          // somebody else's.
                          contacts: [
                            ...current.contacts,
                            {
                              type:
                                CONTACT_TYPES.find(
                                  (each) => !(each === "message" && current.shared) && !current.contacts.some((contact) => contact.type === each),
                                ) ?? CONTACT_TYPES[0],
                              value: "",
                            },
                          ],
                        }));
                      }}
                    >
                      {t("item.contactAdd")}
                    </button>
                  )}
                  <span className={styles.hint}>{t("item.contactHint")}</span>
                </div>
              )}
            </div>
            </>
            )}
          </div>

          <div className="modal-actions">
            {/* What is wrong with the form, said at the foot of the sheet: at
                the left of the line the buttons are at the right of. */}
            {error && <p className="form-message error">{error}</p>}
            {/* A new item's second part goes back to its first; anything
                else is left by cancelling. */}
            {!editing && shown === "availability" ? (
              <button type="button" className="outline-button" onClick={() => setStep("item")} disabled={busy}>
                {t("item.back")}
              </button>
            ) : (
              <button type="button" className="outline-button" onClick={onClose} disabled={busy}>
                {t("common.cancel")}
              </button>
            )}
            {/* The page all of this comes to, before it is anybody's to see:
                opened as a page of its own, in its own tab. */}
            {(editing || shown === "availability") && (
              <button type="button" className="outline-button" onClick={preview} disabled={uploading > 0}>
                {t("item.preview")}
              </button>
            )}
            <button type="submit" className="primary-button" disabled={busy}>
              {uploading > 0 ? t("item.uploading") : editing ? t("common.save") : shown === "item" ? t("item.next") : t("item.publish")}
            </button>
          </div>
        </form>
      </Modal>

      {/* One date's own base price, asked for on a sheet over the form when
          the pencil beside it is pressed on the calendar of dates — or the
          price of one cell of one date, from the pencil on the week's
          timetable. Left empty, it costs what it would have anyway. */}
      <Modal
        isOpen={isOpen && Boolean(pricing)}
        title={
          !pricing
            ? ""
            : pricing.start
              ? t("item.slotPrice", { date: formatDay(pricing.day, lang) })
              : t("item.datePrice", { date: formatDay(pricing.day, lang) })
        }
        onClose={() => setPricing(null)}
        closeOnOverlay
      >
        {pricing && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setFields((current) => {
                // A stretch of the date, from the week's timetable — or the
                // whole date, from the calendar.
                if (pricing.start) {
                  const { day, start, end, price } = pricing;
                  return { ...current, slotPrices: withSlotPrice(current.slotPrices, { day, start, end, price }) };
                }
                const datePrices = { ...current.datePrices };
                if (priceOf(pricing.price) === null) delete datePrices[pricing.day];
                else datePrices[pricing.day] = pricing.price;
                return { ...current, datePrices };
              });
              setError("");
              setPricing(null);
            }}
          >
            {/* The stretch of the date the price is for: from when until when,
                each a time within the stretch of hours the cell pressed is
                in, and starting out as that one cell. */}
            {pricing.start && (
              <div className={`field ${styles.slotTimes}`}>
                {["start", "end"].map((edge) => (
                  <div key={edge}>
                    <span className="field-label">{t(`item.ruleTime.${edge}`)}</span>
                    <Select
                      label={t(`item.ruleTime.${edge}`)}
                      value={pricing[edge]}
                      onChange={(value) => setPricing({ ...pricing, [edge]: value })}
                      options={TIME_OPTIONS.filter((option) => option.value >= pricing.from && option.value <= pricing.until)}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="field">
              <PriceInput
                currency={fields.currency}
                value={pricing.price}
                onChange={(event) => setPricing({ ...pricing, price: event.target.value.replace(/[^\d.]/g, "") })}
                inputMode="decimal"
                placeholder={(pricing.start && fields.datePrices[pricing.day]) || fields.basePrice || t("item.price")}
                aria-label={t("item.price")}
                maxLength={12}
                autoFocus
              />
              <span className={styles.hint}>{t(pricing.start ? "item.slotPriceHint" : "item.datePriceHint")}</span>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="outline-button modal-aside"
                onClick={() => setPricing({ ...pricing, price: "" })}
                disabled={pricing.price === ""}
              >
                {t("item.datePriceClear")}
              </button>
              {/* A stretch has to start before it ends. */}
              <button type="submit" className="primary-button" disabled={Boolean(pricing.start) && pricing.start >= pricing.end}>
                {t("item.datePriceDone")}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
