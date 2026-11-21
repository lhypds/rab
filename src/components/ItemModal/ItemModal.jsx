import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Checkbox, Modal, Select, TextArea, showToast } from "../../ui/index.js";
import { addDays, today, weekdayNames } from "../../utils/days.js";
import { CURRENCIES, defaultCurrency, formatCoords } from "../../utils/format.js";
import { uploadPhoto } from "../../utils/image.js";
import { CATEGORIES, KINDS } from "../../utils/kinds.js";
import { AREA_TYPES, DEFAULT_VIEW, MAPBOX_TOKEN, areaAt, areaOf, geocode, placeName, savedView } from "../../utils/mapbox.js";
import { openPreview, writePreview } from "../../utils/preview.js";
import { STEP, clockOf, listPrice } from "../../utils/rates.js";
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
const RULES_MAX = 24;
const AREA_SEARCH_MS = 350;
// How far ahead the calendar reaches, the same year the server keeps.
const CALENDAR_DAYS = 366;
// How many photographs go up at once: enough that a hundred of them is not a
// queue, few enough that a phone is not compressing a dozen at a time.
const UPLOADS_AT_ONCE = 3;

const MODES = ["day", "time"];
// The hours an item booked by the time starts out with, until its owner paints
// others: nine to six, every day.
const DEFAULT_HOURS = [{ start: "09:00", end: "18:00", days: null }];
// Every half hour of the day, for the hours a price rule is for.
const TIMES = Array.from({ length: (24 * 60) / STEP + 1 }, (_, index) => clockOf(index * STEP));

let ruleSeed = 0;
const newRule = (fields) => ({ id: `r${++ruleSeed}`, price: "", days: [], dates: [], start: "", end: "", ...fields });

// The rules the form opens holding: the item's own, or one empty rule — the
// price of an ordinary day, or of an ordinary hour.
function startingRules(item) {
  if (!item?.rates?.length) return [newRule()];
  return item.rates.map((rate) =>
    newRule({
      price: String(rate.price),
      days: rate.days ?? [],
      dates: rate.dates ?? [],
      start: rate.start ?? "",
      end: rate.end ?? "",
    }),
  );
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
    hours: item?.mode === "time" && item.hours?.length ? item.hours : DEFAULT_HOURS,
    rules: startingRules(item),
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
    active: item?.active ?? true,
    closed: (calendar?.days ?? []).filter((day) => !day.available).map((day) => day.day),
  };
}

// The rules as they would be saved: the ones with a price on them, as numbers.
// The first is for every day whatever was ticked beside it; the hours a rule is
// for are kept only where the item is booked by the time.
function cleanRules(rules, mode) {
  return rules
    .filter((rule) => rule.price.trim() !== "" && Number.isFinite(Number(rule.price)))
    .map((rule, index) => ({
      price: Number(rule.price),
      days: index === 0 || rule.days.length === 0 ? null : rule.days,
      ...(index > 0 && rule.dates.length > 0 ? { dates: [...rule.dates].sort() } : null),
      ...(index > 0 && mode === "time" && timed(rule) ? { start: rule.start, end: rule.end } : null),
    }));
}

// Whether a rule names hours, and whether the ones it names are in order.
const timed = (rule) => Boolean(rule.start && rule.end);
const timesWrong = (rule) => Boolean(rule.start || rule.end) && (!timed(rule) || rule.start >= rule.end);

// The days of the week a rule is for, as seven small boxes. None ticked is
// every day.
function Weekdays({ value, onChange, names, label }) {
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
            className={on ? `${styles.weekday} ${styles.weekdayOn}` : styles.weekday}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((each) => each !== day) : [...value, day].sort())}
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
export default function ItemModal({ isOpen, item = null, calendar = null, onClose, onSaved, onDeleted }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang = i18n.language;
  const [fields, setFields] = useState(() => startingFields(item, calendar, lang));
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // The rule whose particular dates are being picked, in the sheet that holds
  // a calendar for it — or null.
  const [datingId, setDatingId] = useState(null);
  const [error, setError] = useState("");
  // Whether the place line is the reader's own words. Until it is, it follows
  // the pin: the name of wherever the map has been dragged to.
  const placeTyped = useRef(false);
  const fileRef = useRef(null);
  const editing = Boolean(item);
  const names = useMemo(() => weekdayNames(lang), [lang]);

  useEffect(() => {
    if (!isOpen) return;
    setFields(startingFields(item, calendar, lang));
    setError("");
    setConfirming(false);
    setDatingId(null);
    setUploading(0);
    placeTyped.current = Boolean(item?.place);
    // Opened afresh each time; what it was opened with is what it starts from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item]);

  const set = (name, value) => {
    setFields((current) => ({ ...current, [name]: value }));
    setError("");
  };

  const { rules } = fields;
  const setRules = (change) => setFields((current) => ({ ...current, rules: change(current.rules) }));
  const setRule = (id, patch) =>
    setRules((list) => list.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));

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

  // An item with a pin and no area yet is offered the area its pin stands in:
  // the answer most people would give, there to be changed. Asked a moment
  // after the pin stops, and never over an area somebody has picked.
  const hasRegion = Boolean(fields.region);
  useEffect(() => {
    if (!isOpen || !located || hasRegion || !MAPBOX_TOKEN) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      areaAt(latitude, longitude, lang, controller.signal)
        .then((area) => {
          const region = areaOf(area);
          if (region) setFields((current) => (current.region ? current : { ...current, region }));
        })
        .catch(() => {});
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, located, hasRegion, latitude, longitude, lang]);

  function toggleDay(day) {
    setFields((current) => ({
      ...current,
      closed: current.closed.includes(day) ? current.closed.filter((each) => each !== day) : [...current.closed, day],
    }));
  }

  // What the form comes to, as the item its page would be drawn from: the
  // calendar in here and the preview are both this.
  const { mode } = fields;
  const byTime = mode === "time";
  const rates = cleanRules(rules, mode);
  const draft = {
    id: item?.id ?? "preview",
    title: fields.title.trim() || t("item.titlePlaceholder"),
    description: fields.description.trim(),
    kind: fields.kind,
    category: fields.category,
    mode,
    rates,
    hours: byTime ? fields.hours : [],
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
      // The owner's own prices for single days are kept through an edit; what
      // the form decides is only which days are closed.
      days: [
        ...(calendar?.days ?? []).filter((day) => day.available && !fields.closed.includes(day.day)),
        ...fields.closed.map((day) => ({ day, available: false, price: null })),
      ],
      taken: calendar?.taken ?? [],
    }),
    [calendar, fields.closed],
  );

  // The booking page this draft comes to, opened beside the form as the page it
  // will be (see pages/PreviewPage). Pressed again after a change, the same tab
  // comes forward holding the newer draft.
  function preview() {
    if (!writePreview({ item: draft, calendar: draftCalendar }) || !openPreview()) {
      showToast(t("item.previewBlocked"), 3000);
    }
  }

  const dating = rules.find((rule) => rule.id === datingId) ?? null;
  // A calendar with nothing closed and nothing taken on it: for picking dates,
  // every day ahead is one that can be ticked.
  const pickCalendar = useMemo(() => ({ from: today(), until: addDays(today(), CALENDAR_DAYS), days: [], taken: [] }), []);

  function fault() {
    if (!fields.title.trim()) return t("item.titleRequired");
    if (!fields.region) return t("item.regionRequired");
    if (rates.length === 0 || rules.some((rule) => rule.price.trim() === "")) return t("item.priceRequired");
    if (byTime && rules.slice(1).some(timesWrong)) return t("item.ruleTimesWrong");
    if (rules.slice(1).some((rule) => rule.days.length === 0 && rule.dates.length === 0 && !(byTime && timed(rule)))) {
      return t(byTime ? "item.whenRequired" : "item.daysRequired");
    }
    if (byTime && fields.hours.length === 0) return t("item.hoursRequired");
    return "";
  }

  async function save(event) {
    event.preventDefault();
    if (saving || uploading > 0) return;
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
      rates,
      hours: byTime ? fields.hours : [],
      currency: fields.currency,
      images: fields.images,
      latitude: fields.located ? fields.latitude : null,
      longitude: fields.located ? fields.longitude : null,
      place: fields.located ? fields.place.trim() : "",
      region: fields.region,
      active: fields.active,
      closed: fields.closed,
    };
    try {
      const data = editing ? await api.updateItem(item.id, body) : await api.createItem(body);
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

  return (
    <>
      <Modal
        isOpen={isOpen}
        title={editing ? t("item.editTitle") : t("item.newTitle")}
        // Withheld while something is on its way up, so a stray Escape does
        // not drop a form with a photograph half sent.
        onClose={busy ? undefined : onClose}
        large
      >
        <form className={styles.form} onSubmit={save} autoComplete="off" data-save>
          <div className={styles.columns}>
            {/* ------------------------------------------------- what it is */}
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

              {/* The area it is offered in, which every item has to say: it is
                  what lists it for the people looking there, pin or no pin. */}
              <div className="field">
                <span className="field-label">{t("item.region")}</span>
                <AreaField value={fields.region} onChange={(region) => set("region", region)} />
                <span className={styles.hint}>{t("item.regionHint")}</span>
              </div>

              <div className="field">
                <span className="field-label">
                  {t("item.location")}
                  {fields.located && <span className="field-count">{formatCoords(fields.latitude, fields.longitude)}</span>}
                </span>
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
                    <button
                      type="button"
                      className={`small-button ${styles.start}`}
                      onClick={() => {
                        placeTyped.current = false;
                        setFields((current) => ({ ...current, located: false, place: "" }));
                      }}
                    >
                      {t("item.locationRemove")}
                    </button>
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

            {/* ------------------------------------- what it costs, and when */}
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
                      onClick={() => set("mode", each)}
                    >
                      {t(`item.mode.${each}`)}
                    </button>
                  ))}
                </div>
                <span className={styles.hint}>{t(`item.modeHint.${mode}`)}</span>
              </div>

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

                <ul className={styles.rules}>
                  {rules.map((rule, index) => {
                    const base = index === 0;
                    return (
                      <li key={rule.id} className={styles.rule}>
                        <div className={styles.ruleWhen}>
                          {base ? (
                            <span className={styles.everyDay}>{t(byTime ? "item.everyHour" : "item.everyDay")}</span>
                          ) : (
                            <>
                              <Weekdays
                                value={rule.days}
                                onChange={(days) => setRule(rule.id, { days })}
                                names={names}
                                label={t("item.ruleDays")}
                              />
                              {/* And the particular dates it is for, beside the
                                  days of the week: a holiday is a date, not a
                                  Saturday. The count says how many are picked. */}
                              <button
                                type="button"
                                className={rule.dates.length > 0 ? `${styles.dates} ${styles.datesOn}` : styles.dates}
                                onClick={() => setDatingId(rule.id)}
                                aria-label={t("item.ruleDates")}
                                title={t("item.ruleDates")}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M4 6h16v14H4z" />
                                  <path d="M4 10h16" />
                                  <path d="M8 3v5M16 3v5" />
                                </svg>
                                {rule.dates.length > 0 && <span>{rule.dates.length}</span>}
                              </button>
                              {/* By the time, a rule can also be for a stretch
                                  of the clock: evenings, the early morning. */}
                              {byTime && (
                                <span className={styles.ruleTimes}>
                                  {["start", "end"].map((edge) => (
                                    <select
                                      key={edge}
                                      className={styles.ruleTime}
                                      value={rule[edge]}
                                      onChange={(event) => {
                                        setRule(rule.id, { [edge]: event.target.value });
                                        setError("");
                                      }}
                                      aria-label={t(`item.ruleTime.${edge}`)}
                                    >
                                      <option value="">--:--</option>
                                      {TIMES.map((time) => (
                                        <option key={time} value={time}>
                                          {time}
                                        </option>
                                      ))}
                                    </select>
                                  ))}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        <input
                          className={`text-input mono ${styles.rulePrice}`}
                          value={rule.price}
                          onChange={(event) => {
                            setRule(rule.id, { price: event.target.value.replace(/[^\d.]/g, "") });
                            setError("");
                          }}
                          inputMode="decimal"
                          placeholder={t("item.price")}
                          aria-label={t("item.price")}
                          maxLength={12}
                        />
                        <button
                          type="button"
                          className={styles.ruleRemove}
                          onClick={() => setRules((list) => list.filter((each) => each.id !== rule.id))}
                          // The price of an ordinary day is the one rule an
                          // item cannot do without.
                          disabled={base}
                          aria-label={t("item.ruleRemove")}
                          title={t("item.ruleRemove")}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6 6 18" />
                          </svg>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {rules.length < RULES_MAX && (
                  <button
                    type="button"
                    className={`small-button ${styles.start}`}
                    onClick={() => setRules((list) => [...list, newRule()])}
                  >
                    <span aria-hidden="true">+ </span>
                    {t(`item.ruleAdd.${mode}`)}
                  </button>
                )}
                <span className={styles.hint}>{t(`item.ruleHint.${mode}`)}</span>
              </div>

              {/* The hours of the week it can be had, where it is booked by the
                  time: painted on a timetable, a column for each day. */}
              {byTime && (
                <div className="field">
                  <span className="field-label">
                    {t("item.hours")}
                    {fields.hours.length > 0 && (
                      <button type="button" className={styles.clear} onClick={() => set("hours", [])}>
                        {t("item.hoursClear")}
                      </button>
                    )}
                  </span>
                  <WeekHours value={fields.hours} onChange={(hours) => set("hours", hours)} names={names} />
                  <span className={styles.hint}>{t("item.hoursHint")}</span>
                </div>
              )}

              <div className="field">
                <span className="field-label">
                  {t("item.availability")}
                  {fields.closed.length > 0 && (
                    <span className="field-count">{t("item.closedCount", { count: fields.closed.length })}</span>
                  )}
                </span>
                <Calendar item={draft} calendar={draftCalendar} onToggle={toggleDay} />
                <span className={styles.hint}>{t("item.availabilityHint")}</span>
              </div>

              {editing && (
                <Checkbox className={styles.check} checked={fields.active} onChange={(on) => set("active", on)}>
                  {t("item.active")}
                </Checkbox>
              )}
            </div>
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
              {editing && (
                <button type="button" className="outline-button modal-aside" onClick={() => setConfirming(true)} disabled={busy}>
                  {t("item.delete")}
                </button>
              )}
              <button type="button" className="outline-button" onClick={onClose} disabled={busy}>
                {t("common.cancel")}
              </button>
              {/* The page all of this comes to, before it is anybody's to see:
                  opened as a page of its own, in its own tab. */}
              <button type="button" className="outline-button" onClick={preview} disabled={uploading > 0}>
                {t("item.preview")}
              </button>
              <button type="submit" className="primary-button" disabled={busy}>
                {uploading > 0 ? t("item.uploading") : editing ? t("common.save") : t("item.publish")}
              </button>
            </div>
          )}
        </form>
      </Modal>

      {/* The dates one price rule is for, picked a day at a time off a calendar
          of their own: a sheet over the form, since the form's own calendar is
          answering a different question — which days are closed. */}
      <Modal isOpen={isOpen && Boolean(dating)} title={t("item.ruleDates")} onClose={() => setDatingId(null)} closeOnOverlay>
        {dating && (
          <>
            <Calendar
              item={draft}
              calendar={pickCalendar}
              marked={dating.dates}
              onToggle={(day) =>
                setRule(dating.id, {
                  dates: dating.dates.includes(day) ? dating.dates.filter((each) => each !== day) : [...dating.dates, day],
                })
              }
            />
            <div className="modal-actions">
              <button
                type="button"
                className="outline-button modal-aside"
                onClick={() => setRule(dating.id, { dates: [] })}
                disabled={dating.dates.length === 0}
              >
                {t("item.ruleDatesClear")}
              </button>
              <button type="button" className="primary-button" onClick={() => setDatingId(null)}>
                {t("item.ruleDatesDone", { count: dating.dates.length })}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
