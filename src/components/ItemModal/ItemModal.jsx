import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Modal, Select, TextArea, showToast } from "../../ui/index.js";
import { addDays, daysBetween, formatDay, formatRange, today, weekdayNames } from "../../utils/days.js";
import { CURRENCIES, compactPrice, currencySymbol, defaultCurrency, formatCoords, unitName, wholePrice } from "../../utils/format.js";
import { uploadPhoto } from "../../utils/image.js";
import { CATEGORIES, KINDS } from "../../utils/kinds.js";
import { AREA_TYPES, DEFAULT_VIEW, MAPBOX_TOKEN, areaAt, areaOf, geocode, locate, locationPermission, placeName, savedView } from "../../utils/mapbox.js";
import { cancelLine } from "../../utils/bookings.js";
import { openPreview, writePreview } from "../../utils/preview.js";
import { clockOf, hourPrice, listPrice, openByRule, priceUnitOf, STEP, unitOf, UNITS } from "../../utils/rates.js";
import { currentRegion, useRegion } from "../../utils/region.js";
import { useAuth } from "../AuthProvider/index.js";
import Calendar from "../Calendar/index.js";
import CategoryIcon from "../CategoryIcon/index.js";
import SpotMap from "../SpotMap/index.js";
import { WeekHours } from "../TimeTable/index.js";
import styles from "./item.module.css";

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 2000;
const PLACE_MAX = 120;
const IMAGES_MAX = 100;
const AREA_SEARCH_MS = 350;
// How far ahead the calendar reaches, the same year the server keeps.
const CALENDAR_DAYS = 366;
// How many photographs go up at once: enough that a hundred of them is not a
// queue, few enough that a phone is not compressing a dozen at a time.
const UPLOADS_AT_ONCE = 3;

const MODES = ["day", "time"];
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
  return { basePrice: rates[0] ? String(rates[0].price) : "", datePrices, slotPrices, extraRates, hourRules };
}

function startingFields(item, calendar, lang) {
  return {
    kind: item?.kind ?? "item",
    category: item?.category ?? "",
    title: item?.title ?? "",
    description: item?.description ?? "",
    // How it is booked: by the date, or by the date and the time — and, for
    // the second, the hours of the week it can be had.
    mode: item?.mode === "time" ? "time" : "day",
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

// The area an item is offered in: a search for a town, a ward or a prefecture,
// and once one is picked, its name with the way to pick another. Not a <form> —
// it stands inside the item's.
function AreaField({ value, onChange }) {
  const { t, i18n } = useTranslation();
  const { country } = useRegion();
  const lang = i18n.language;
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState(null);

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
      geocode(text, { lang, country, near: savedView() ?? currentRegion().center, types: AREA_TYPES, signal: controller.signal })
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

  function choose(place) {
    setQuery("");
    setPlaces(null);
    onChange(areaOf(place));
  }

  if (value) {
    return (
      <div className={styles.area}>
        <span className={styles.areaName}>
          <strong>{value.name}</strong>
          {value.detail && <span>{value.detail}</span>}
        </span>
        <button type="button" className="small-button" onClick={() => onChange(null)}>
          {t("item.regionChange")}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.areaSearch} role="search">
      <input
        className="text-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") {
            // Enter picks the first answer; it must not publish the form.
            event.preventDefault();
            if (places?.list?.[0]) choose(places.list[0]);
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
      {places && (
        <ul className={styles.areaResults}>
          {places.error && <li className={styles.areaNote}>{places.error}</li>}
          {places.list?.length === 0 && <li className={styles.areaNote}>{t("map.searchEmpty")}</li>}
          {places.list?.map((place) => (
            <li key={place.id}>
              <button type="button" className={styles.areaResult} onClick={() => choose(place)}>
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
export default function ItemModal({ isOpen, item = null, calendar = null, part = "item", onClose, onSaved, onDeleted }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang = i18n.language;
  const [fields, setFields] = useState(() => startingFields(item, calendar, lang));
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
  // Whether the area was picked by hand. Until it is, it is the town the item
  // is in: the reader's own, or the pin's once there is one.
  const regionPicked = useRef(false);
  // The account's own places, to put the item at one without finding the spot
  // again; and the name being given to the spot on the map, while it is being
  // saved as one of them.
  const [locations, setLocations] = useState([]);
  const [naming, setNaming] = useState(null);
  const fileRef = useRef(null);
  const editing = Boolean(item);
  const names = useMemo(() => weekdayNames(lang), [lang]);

  useEffect(() => {
    if (!isOpen) return;
    setFields(startingFields(item, calendar, lang));
    setError("");
    setConfirming(false);
    setPricing(null);
    setStep("item");
    setUploading(0);
    placeTyped.current = Boolean(item?.place);
    regionPicked.current = Boolean(item?.region);
    setNaming(null);
    setHoursDay(today());
    api
      .getLocations()
      .then((answer) => setLocations(answer.locations ?? []))
      .catch(() => setLocations([]));
    // Opened afresh each time; what it was opened with is what it starts from.
    // Keyed on which item it is, not on the item as handed in: the page behind
    // the form asks the server again every half minute and hands in a new copy
    // of the same item, and starting over at each of those would throw away
    // whatever had been typed since the last.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id]);

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
      placeName(latitude, longitude, lang, controller.signal)
        .then((name) => {
          if (name && !placeTyped.current) setFields((current) => ({ ...current, place: name.slice(0, PLACE_MAX) }));
        })
        .catch(() => {});
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, located, latitude, longitude, lang]);

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

  function addLocation() {
    const view = savedView() ?? currentRegion().center ?? DEFAULT_VIEW;
    setFields((current) => ({ ...current, located: true, latitude: view.latitude, longitude: view.longitude }));
  }

  // One of the account's own places: the pin goes to its spot, the line under
  // the pin is its address, and the item is offered in its area — the place's
  // own where it has one, and the town its pin stands in either way (see
  // below), over any area picked before. The address is the place's own, so it
  // stays put rather than following the pin.
  function putAt(id) {
    const location = locations.find((each) => each.id === id);
    if (!location) return;
    placeTyped.current = true;
    regionPicked.current = false;
    setFields((current) => ({
      ...current,
      located: true,
      latitude: location.latitude,
      longitude: location.longitude,
      place: (location.address || location.name).slice(0, PLACE_MAX),
      region: location.region ?? current.region,
    }));
    setError("");
  }

  // Whether the pin and its address are one of the account's places as it is
  // kept: chosen from the list and left alone, or just saved. There is nothing
  // to save then; moving the pin or rewriting the address makes it a new spot.
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const kept = locations.some(
    (location) =>
      near(location.latitude, fields.latitude) &&
      near(location.longitude, fields.longitude) &&
      (location.address || location.name).slice(0, PLACE_MAX) === fields.place.trim(),
  );

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
      });
      setLocations((current) => [...current.filter((each) => each.id !== answer.location.id), answer.location]);
      setNaming(null);
      showToast(t("item.locationSaved"), 2000);
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  // Until somebody picks an area, the item is offered in the town it is in:
  // the one the pin stands in, where it has a pin — asked a moment after the
  // pin stops, and again wherever it is moved to — and otherwise the one the
  // reader is in, from where the browser says they are, or failing that from
  // where the map is looking. The answer most people would give, there to be
  // changed; and never written over one somebody has picked.
  useEffect(() => {
    if (!isOpen || !MAPBOX_TOKEN || regionPicked.current) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      let spot = located ? { latitude, longitude } : null;
      if (!spot) {
        const permission = await locationPermission();
        if (permission !== "denied" && permission !== "unsupported") spot = await locate();
        spot ??= savedView() ?? currentRegion().center;
      }
      if (cancelled || !spot) return;
      areaAt(spot.latitude, spot.longitude, lang, controller.signal)
        .then((area) => {
          const region = areaOf(area);
          if (region && !cancelled && !regionPicked.current) setFields((current) => ({ ...current, region }));
        })
        .catch(() => {});
    }, located ? 500 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, located, latitude, longitude, lang]);

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
    kind: fields.kind,
    category: fields.category,
    mode,
    unit: fields.unit,
    priceUnit: fields.priceUnit,
    cancel,
    rates,
    hours,
    hoursOff: byTime ? fields.hoursOff : [],
    openDays,
    price: listPrice(mode, rates),
    currency: fields.currency,
    images: fields.images,
    thumb: fields.images[0]?.thumb ?? null,
    located: fields.located,
    latitude: fields.latitude,
    longitude: fields.longitude,
    place: fields.located ? fields.place.trim() : "",
    region: fields.region,
    active: true,
    owner: user?.username ?? "",
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
    if (rates.length === 0) return t("item.priceRequired");
    if (byTime && hourRules.some((rule) => !timed(rule) || rule.start >= rule.end)) return t("item.ruleTimesWrong");
    if (byTime && hours.length === 0) return t("item.hoursRequired");
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
      kind: fields.kind,
      category: fields.category,
      mode,
      unit: fields.unit,
      priceUnit: fields.priceUnit,
      cancel,
      rates,
      hours,
      hoursOff: byTime ? fields.hoursOff : [],
      openDays,
      currency: fields.currency,
      images: fields.images,
      latitude: fields.located ? fields.latitude : null,
      longitude: fields.located ? fields.longitude : null,
      place: fields.located ? fields.place.trim() : "",
      region: fields.region,
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
      onSaved?.(data.item);
    } catch (requestError) {
      setError(
        requestError.code === "REGION_REQUIRED"
          ? t("item.regionRequired")
          : requestError.code === "HOURS_REQUIRED"
            ? t("item.hoursRequired")
            : requestError.message,
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await api.deleteItem(item.id);
      onDeleted?.(item);
    } catch (requestError) {
      setError(requestError.message);
      setConfirming(false);
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
    ...CATEGORIES[fields.kind].map((slug) => ({
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
              <div className="field">
                <span className="field-label">{t("item.kind")}</span>
                <div className="tabs" role="group">
                  {KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={fields.kind === kind ? "tab active" : "tab"}
                      aria-pressed={fields.kind === kind}
                      onClick={() => setFields((current) => ({ ...current, kind, category: "" }))}
                    >
                      {t(`kind.${kind}`)}
                    </button>
                  ))}
                </div>
                <span className={styles.hint}>{t(`kind.${fields.kind}Hint`)}</span>
              </div>

              <div className="field">
                <span className="field-label">{t("item.category")}</span>
                <Select
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
            </div>

            {/* The item's sheet has two columns where there is room: what it
                is on the left, and where it is on the right. */}
            <div className={styles.column}>
              {/* The area it is offered in, which every item has to say: it is
                  what lists it for the people looking there, pin or no pin.
                  Filled in with the town the item is in; changing it, or
                  starting to, makes it the reader's own choice. */}
              <div className="field">
                <span className="field-label">{t("item.region")}</span>
                <AreaField
                  value={fields.region}
                  onChange={(region) => {
                    regionPicked.current = true;
                    set("region", region);
                  }}
                />
                <span className={styles.hint}>{t("item.regionHint")}</span>
              </div>

              <div className="field">
                <span className="field-label">
                  {t("item.location")}
                  {fields.located && <span className="field-count">{formatCoords(fields.latitude, fields.longitude)}</span>}
                </span>
                {/* The account's own places: choosing one puts the pin there. */}
                {locations.length > 0 && (
                  <Select
                    label={t("item.locationChoose")}
                    value=""
                    onChange={putAt}
                    options={[
                      { value: "", label: t("item.locationChoose") },
                      // Each place on two lines: what it is called and where,
                      // and under that, in grey, the spot itself.
                      ...locations.map((location) => {
                        const line = location.address ? `${location.name} — ${location.address}` : location.name;
                        return {
                          value: location.id,
                          text: line,
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
                          unless it is one of the account's places already. The
                          empty span keeps Remove at the right. */}
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
                {/* The two ways it can be booked: by the date, priced by the
                    day, or by the date and the time, priced by the hour. The
                    rules under it are read as whichever is chosen. */}
                <div className="tabs" role="group">
                  {MODES.map((each) => (
                    <button
                      key={each}
                      type="button"
                      className={mode === each ? "tab active" : "tab"}
                      aria-pressed={mode === each}
                      // The usual hours are never none: turned to booking
                      // by the time without any, it starts with the whole
                      // day, every day, there to be cut down.
                      onClick={() =>
                        setFields((current) => ({
                          ...current,
                          mode: each,
                          hourRules:
                            each === "time" && current.hourRules.length === 0
                              ? [newRule({ days: EVERY_DAY, start: "00:00", end: "24:00" })]
                              : current.hourRules,
                        }))
                      }
                    >
                      {t(`item.mode.${each}`)}
                    </button>
                  ))}
                </div>
                <span className={styles.hint}>{t(`item.modeHint.${mode}`)}</span>
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
                      {!byTime && <span className={styles.everyDay}>{t("item.aDay")}</span>}
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

              {/* By the time, the dates stand here, under the price, and the
                  column beside is the hours'. */}
              {byTime && datesField}
            </div>

            {/* This sheet has two columns too. By the date: how it is booked
                and what it costs on the left, the dates it can be had on the
                right. By the time: the dates go left with the rest, and the
                right is the hours. */}
            <div className={styles.column}>
              {/* By the date, the dates are this column's. */}
              {!byTime && datesField}

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
                    fullPriceAt={(day, time) => wholePrice(hourPrice(draft, day, time), fields.currency, lang)}
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
            </div>
            </>
            )}
          </div>

          {error && <p className="form-message error">{error}</p>}

          {confirming ? (
            <div className="modal-actions">
              <span className={`${styles.confirm} modal-aside`}>{t("item.deleteConfirm")}</span>
              <button type="button" className="outline-button" onClick={() => setConfirming(false)} disabled={saving}>
                {t("common.cancel")}
              </button>
              <button type="button" className="primary-button" onClick={remove} disabled={saving}>
                {t("item.delete")}
              </button>
            </div>
          ) : (
            <div className="modal-actions">
              {/* Deleting is the item's, and is on the sheet that is about the
                  item. */}
              {editing && shown === "item" && (
                <button type="button" className="outline-button modal-aside" onClick={() => setConfirming(true)} disabled={busy}>
                  {t("item.delete")}
                </button>
              )}
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
          )}
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
