import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import * as api from "../../api.js";
import { Link, Select, showToast, useLocation, useNavigate } from "../../ui/index.js";
import { iconMarkup } from "../../utils/categoryIcons.js";
import { priceLine } from "../../utils/format.js";
import { contactHref } from "../../utils/dialing.js";
import { homeFilter, homePath, sortLabel } from "../../utils/categories.js";
import { isAdmin } from "../../utils/admin.js";
import {
  DEFAULT_VIEW,
  MAPBOX_TOKEN,
  areaAt,
  MAP_STYLE,
  PIN_PATH,
  locate,
  locateFailure,
  locationPermission,
  mapLanguage,
  onPosition,
  saveView,
  savedView,
} from "../../utils/mapbox.js";
import { currentRegion, loadRegion, onTravel, takeJourney, useRegion, waitingJourney } from "../../utils/region.js";
import { MapTools, showSelf } from "../MapParts/index.js";
import { ItemRow } from "../Rows/index.js";
import { useAuth } from "../AuthProvider/index.js";
import { LIST_EVENT } from "../Header/Header.jsx";
import { categoriesOf } from "../CategoryFilter/index.js";
import CategoryIcon from "../CategoryIcon/index.js";
import FilterBox from "../FilterBox/index.js";
import ItemPreview from "../ItemPreview/index.js";
import UserName, { dotted } from "../UserName/index.js";
import styles from "./map.module.css";

// How long the map has to have stopped moving before the items in its window
// are asked for, so a drag is one request rather than one per frame of it.
const SETTLE_MS = 250;

// How far above the spot a bubble sits: the pin's own height (25.2px) and a
// pixel, as in lo.
const POPUP_OFFSET = 26;

// Whether the reader has already been asked for their location this visit and
// said not now. Kept for the tab's life only: the next visit asks again, since
// a map of what is nearby has one question worth asking twice.
const GATE_KEY = "rab:gate-dismissed";

// A pointer that can rest on a thing, as against a finger that can only land on
// it. Read once: a device does not change its mind about this. Where there is
// one, resting it on a pin opens the pin's bubble and a click holds it there —
// lo's arrangement.
const HOVERS = window.matchMedia("(hover: hover)").matches;

// How long a bubble opened by the pointer outlives the pointer leaving its pin:
// long enough to cross the hairline between the pin and the bubble over it, so
// what the bubble offers can be reached and pressed.
const LEAVE_MS = 120;

// vi's keys for moving, and the arrows they stand for among the rows.
const VI_KEYS = { h: "ArrowLeft", j: "ArrowDown", k: "ArrowUp", l: "ArrowRight" };

function gateDismissed() {
  try {
    return sessionStorage.getItem(GATE_KEY) === "1";
  } catch {
    return false;
  }
}

// A pin, built by hand because the map places DOM nodes rather than React ones:
// the drawing, in its head the mark of the item's category, and over it the
// item's main photograph where it has one. Nothing is written under it — what it is called and what it costs are in the bubble a
// press opens.
function pinElement() {
  const element = document.createElement("button");
  element.type = "button";
  element.className = styles.pin;
  // The category's drawing goes in the pin's head, drawn full size on its own
  // 24-unit grid and shrunk to fit about the head's middle at (12, 10) — the
  // arrangement lo's pins use, at lo's sizes. The scale is the one lo gives its
  // own drawing that fills the grid edge to edge (the picture frame, at 0.36),
  // opened a little because these stop two or three units short of the edge:
  // what has to match is how big the mark reads in the head, and that comes out
  // the same seven units across.
  element.innerHTML = `<svg viewBox="0 0 24 21.6" aria-hidden="true"><path d="${PIN_PATH}"/><g class="${styles.glyph}" transform="translate(12 10) scale(0.4) translate(-12 -12)"></g></svg>`;
  return element;
}

function setPinPhoto(element, src) {
  let frame = element.querySelector(`.${styles.pinPhoto}`);
  if (!src) {
    frame?.remove();
    return;
  }
  if (!frame) {
    frame = document.createElement("span");
    frame.className = styles.pinPhoto;
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    frame.append(image);
    element.append(frame);
  }
  const image = frame.firstChild;
  if (image.getAttribute("src") !== src) image.src = src;
}

// The map the site opens on: everything out for rent in the window being
// looked at, each standing where it is picked up.
// The way an item's owner is reached first, as a small drawing beside the
// word that asks for it: a telephone, a letter, or a message here on rab.
// Nothing for an address, or where no way is said.
const CONTACT_ICONS = {
  phone: "M7 3h3l1.5 4.5-2 1.5a12 12 0 0 0 5.5 5.5l1.5-2L21 14v3a3 3 0 0 1-3 3A15 15 0 0 1 4 6a3 3 0 0 1 3-3z",
  email: "M3 6h18v12H3zM3 7l9 7 9-7",
  message: "M4 5h16v11H10l-5 4v-4H4z",
};

function ContactIcon({ type }) {
  const path = CONTACT_ICONS[type];
  if (!path) return null;
  return (
    <svg className={styles.cardIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export default function MapView({ view = "map", query = "", onQuery }) {
  // Read as lists rather than on the map: the same area and the same items,
  // with the map put away (not taken down — it is where it was on the way
  // back).
  const listing = view === "list";
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const popupRef = useRef(null);
  // Whether the reader has moved the map themselves. Once they have, nothing
  // that arrives late — a position, a country — is allowed to move it for them.
  const touchedRef = useRef(false);
  const [popupNode] = useState(() => document.createElement("div"));
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  // The pin the pointer is resting on, where there is a pointer. Its bubble is
  // borrowed from the chosen one for as long as it rests there.
  const [hoveredId, setHoveredId] = useState(null);
  // The row of the list the pointer is resting on: its pin is lit for as long
  // as it rests there, and no bubble is put up for it.
  const [pointedId, setPointedId] = useState(null);
  const leaveRef = useRef(null);
  // Which category the pins are for is in the address — /c/camera — so the
  // page can be sent to somebody as it stands. Changing it changes the
  // address in place: no new entry to step back
  // through, and what the entry carries (see utils/back.js) is kept.
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { category } = homeFilter(pathname) ?? { category: "" };
  const setCategory = (slug) => navigate(homePath(slug), { replace: true, scroll: false, state: window.history.state });
  // The category the columns were last laid out for. Changed, the columns
  // are not laid out again at once — thousands of rows take a moment, and the
  // press would seem to have done nothing meanwhile — but the frame says it is
  // loading first, is drawn so, and the columns come the frame after.
  const [settledCategory, setSettledCategory] = useState(category);
  const switching = category !== settledCategory;
  useEffect(() => {
    if (!switching) return undefined;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettledCategory(category));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [category, switching]);
  // The question about location, while it is being asked: "ask" before the
  // reader has answered, "locating" while the browser does, and afterwards why
  // it came to nothing: "denied", "failed" or "insecure" (see locateFailure).
  const [gate, setGate] = useState(null);
  const lang = i18n.language;
  // Where the reader stands, which is the spot the panel beside the map is
  // about: where the plane put them down while they are away, otherwise where
  // the device says they are, and their country's capital where it will not
  // say. Looking around the map changes none of these — the panel stays with
  // the reader, and only the plane takes them anywhere.
  const region = useRegion();
  const [self, setSelf] = useState(null);
  useEffect(() => {
    // The capital is what stands in for a position that is not to be had, so
    // it is asked for whether or not the map itself needs it to open on.
    loadRegion();
    return onPosition((found) => setSelf(found));
  }, []);
  const stand = region.place ?? self ?? region.center ?? (region.ready ? DEFAULT_VIEW : null);
  // To about a hundred metres: a step that leaves the reader in the same place
  // does not ask about the place again.
  const standLatitude = stand ? Math.round(stand.latitude * 1000) / 1000 : null;
  const standLongitude = stand ? Math.round(stand.longitude * 1000) / 1000 : null;
  const spot = useMemo(
    () => (standLatitude === null ? null : { latitude: standLatitude, longitude: standLongitude }),
    [standLatitude, standLongitude],
  );
  // What that spot's area is called and the ground it covers — { name, within,
  // bbox } — or null where it has no name, and undefined until the first
  // answer.
  const [area, setArea] = useState(undefined);
  // Everything offered there: the items whose area has the spot inside it,
  // whether or not they have a pin. Null until the first answer.
  const [offered, setOffered] = useState(null);
  // While what is offered is being asked for — the first time, or again for
  // somewhere else. As lists the frame stands empty then, saying so.
  const [fetching, setFetching] = useState(false);

  // `query` is what is being looked for, typed in the box in the top bar (the
  // page holds it): a filter on what is already here — the list and the pins
  // alike — rather than a search somewhere else.
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Which category the pins are for: "" is all of them. "Other" is always
  // the last of the choices.
  const categoryChoices = categoriesOf(Boolean(user?.adult));
  // Each one leads with its own mark, the one its pins wear on the map.
  // `text` is what the search reads, since the label is no longer a plain
  // string.
  const withIcon = (slug, name) => (
    <span className={styles.categoryName}>
      <CategoryIcon category={slug} />
      {name}
    </span>
  );
  const allName = t("map.allCategories");
  const categoryOptions = [
    { value: "", name: allName, label: withIcon("", allName), text: allName },
    ...categoryChoices.map((slug) => ({
      value: slug,
      name: t(`category.${slug}`),
      label: withIcon(slug, t(`category.${slug}`)),
      text: `${t(`category.${slug}`)} ${slug}`,
    })),
  ];
  // What is typed over the categories, as lists: the ones whose name has
  // every word of it are the ones left to pick from.
  const [categoryQuery, setCategoryQuery] = useState("");
  const categoryWords = categoryQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // And they are set out by how much each has here: the categories with the
  // most offered in this area first, and the ones
  // with nothing after them, in the order they are always in. "All
  // categories" stays at the head, being none of them, and "other" at the
  // foot however much it has.
  const held = new Map();
  let heldAll = 0;
  for (const item of offered ?? []) {
    held.set(item.category, (held.get(item.category) ?? 0) + 1);
    heldAll += 1;
  }
  // The dropdowns' own rows: each with how many of it are offered here after
  // its name, in grey brackets — not in the closed box, which says only which
  // is picked — and set out by that number, the most first. "All categories"
  // stays at the head.
  const countOf = (slug) => (slug === "" ? heldAll : (held.get(slug) ?? 0));
  const menuOptions = categoryOptions
    .map((option, index) => ({ option, index }))
    .sort(
      (a, b) =>
        (a.option.value === "" ? -1 : 0) - (b.option.value === "" ? -1 : 0) ||
        countOf(b.option.value) - countOf(a.option.value) ||
        a.index - b.index,
    )
    .map(({ option }) => ({
      ...option,
      short: option.label,
      label: (
        <span className={styles.categoryName}>
          {option.label}
          {countOf(option.value) > 0 && <span className={styles.menuCount}>({countOf(option.value)})</span>}
        </span>
      ),
    }));
  const categoriesFound = (
    categoryWords.length
      ? categoryOptions.filter((option) => categoryWords.every((word) => option.text.toLowerCase().includes(word)))
      : categoryOptions
  )
    .map((option, index) => ({ option, index }))
    .sort(
      (a, b) =>
        (a.option.value === "" ? -1 : 0) - (b.option.value === "" ? -1 : 0) ||
        (a.option.value === "other" ? 1 : 0) - (b.option.value === "other" ? 1 : 0) ||
        (held.get(b.option.value) ?? 0) - (held.get(a.option.value) ?? 0) ||
        a.index - b.index,
    )
    .map(({ option }) => option);
  // As lists, an item's row can be carried onto a category and left there:
  // the item is then of that category. Only by an account that may change the
  // item — its own, somebody else's that was written down (`shared`), or any
  // at all for the admin — and the server is what says so in the end.
  const mayMove = (item) => Boolean(user && (item.shared || item.owner === user.username || isAdmin(user)));
  const carriedRef = useRef(null);
  const [dropOn, setDropOn] = useState(null);
  const carry = (item, event) => {
    if (!event) {
      carriedRef.current = null;
      setDropOn(null);
      return;
    }
    carriedRef.current = item;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.title);
    // What follows the pointer is the row's own contents, not the cell it
    // lies in: the cell is ruled off from the column beside it, and that rule
    // would be carried along with it.
    const inside = event.currentTarget.querySelector(".row-copy");
    if (inside) {
      const box = inside.getBoundingClientRect();
      event.dataTransfer.setDragImage(inside, event.clientX - box.left, event.clientY - box.top);
    }
  };
  // A category takes what is carried where it is one — not "all" — and not
  // the one the item is in already.
  const takes = (slug) => Boolean(slug && carriedRef.current && carriedRef.current.category !== slug);
  const drop = async (slug, name) => {
    const item = carriedRef.current;
    carriedRef.current = null;
    setDropOn(null);
    if (!item || !slug || item.category === slug) return;
    try {
      const { item: saved } = await api.updateItem(item.id, { category: slug });
      const swap = (list) => list && list.map((each) => (each.id === saved.id ? { ...each, ...saved } : each));
      setOffered(swap);
      setItems(swap);
      setFound(swap);
      showToast(t("map.categoryMoved", { name }), 2000);
    } catch (error) {
      showToast(error?.message || t("map.categoryMoveFailed"), 3000);
    }
  };

  // An item passes when it is of the category in force and every word typed
  // is somewhere in what it says about itself.
  const passes = (item) => {
    if (category && item.category !== category) return false;
    if (words.length === 0) return true;
    const text = [item.title, item.description, item.place, item.owner, item.category && t(`category.${item.category}`, item.category)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  };
  const filtering = Boolean(category || words.length);
  const shown = filtering ? items.filter(passes) : items;
  // Something looked for by name is looked for everywhere, not only in the
  // area the reader stands in: the box is in the bar, over the whole page, and
  // a title typed into it is expected to be found wherever the item is. So
  // while there is something typed, what the server finds for it anywhere is
  // listed after what is offered here — and then narrowed like the rest.
  const [found, setFound] = useState(null);
  const sought = query.trim();
  useEffect(() => {
    if (!sought) {
      setFound(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .searchItems(sought, { signal: controller.signal })
        .then((data) => setFound(data.items ?? []))
        .catch((error) => {
          // What is here is still searched; elsewhere is left out this once.
          if (error?.name !== "AbortError") setFound(null);
        });
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [sought]);
  const here = offered ?? (sought && found ? [] : null);
  const pool =
    here && sought && found ? [...here, ...found.filter((item) => !here.some((each) => each.id === item.id))] : here;
  const listed = pool && (filtering ? pool.filter(passes) : pool);
  // The one whose bubble is up: what the pointer is on, and failing that what
  // was chosen.
  const open =
    shown.find((item) => item.id === hoveredId) ?? shown.find((item) => item.id === selectedId) ?? null;

  const stay = useCallback(() => window.clearTimeout(leaveRef.current), []);
  const leave = useCallback(() => {
    window.clearTimeout(leaveRef.current);
    leaveRef.current = window.setTimeout(() => setHoveredId(null), LEAVE_MS);
  }, []);

  const fly = useCallback((spot, { animate = true } = {}) => {
    const map = mapRef.current;
    if (!map) return;
    const duration = animate ? 800 : 0;
    if (spot.bbox) {
      map.fitBounds(
        [
          [spot.bbox[0], spot.bbox[1]],
          [spot.bbox[2], spot.bbox[3]],
        ],
        { padding: 24, duration, maxZoom: 15 },
      );
    } else {
      map.flyTo({ center: [spot.longitude, spot.latitude], zoom: spot.zoom ?? 14, duration });
    }
  }, []);

  /* ---------------------------------------------------------------- the map */

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return undefined;
    // Where the map opens, before anything has been asked: where it was left
    // if the reader has been here this visit, and otherwise the country they
    // are taken to be in, if that is already known.
    // A journey begun on another page is waiting here. It is only looked at
    // for now, and taken when this map has loaded and can make it.
    const journey = waitingJourney();
    const kept = savedView();
    const view = kept ?? currentRegion().center ?? DEFAULT_VIEW;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [view.longitude, view.latitude],
      zoom: view.zoom,
      language: mapLanguage(i18n.language),
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    // The map draws to the size its box had when it last looked, and it only
    // looks when the window changes — not when the box does, which the list
    // beside it and the turn from a row to a column both bring about. Left
    // alone, the part of the box it has not drawn to shows the grey behind it.
    // Not while it is put away for the lists, when its box is no size at all.
    const sized = new ResizeObserver(() => {
      if (containerRef.current?.clientWidth) map.resize();
    });
    sized.observe(containerRef.current);

    // Where the reader is, as a dot among the pins.
    const hideSelf = showSelf(map);

    let timer = null;
    let controller = null;
    let cancelled = false;

    function ask() {
      const bounds = map.getBounds();
      // A window wider than the world is the whole of it; one that runs past
      // the antimeridian has its edges brought back into range, which leaves
      // west greater than east — the server reads that as a box that wraps.
      const whole = bounds.getEast() - bounds.getWest() >= 360;
      const wrap = (longitude) => mapboxgl.LngLat.convert([longitude, 0]).wrap().lng;
      controller?.abort();
      controller = new AbortController();
      api
        .getItems(
          {
            south: Math.max(-90, bounds.getSouth()),
            north: Math.min(90, bounds.getNorth()),
            west: whole ? -180 : wrap(bounds.getWest()),
            east: whole ? 180 : wrap(bounds.getEast()),
          },
          { signal: controller.signal },
        )
        .then((data) => {
          if (cancelled) return;
          setItems(data.items ?? []);
          setLoaded(true);
          setFailed(false);
        })
        .catch((error) => {
          if (cancelled || error?.name === "AbortError") return;
          setLoaded(true);
          setFailed(true);
        });
    }

    function settle() {
      window.clearTimeout(timer);
      timer = window.setTimeout(ask, SETTLE_MS);
      const center = map.getCenter().wrap();
      saveView({ latitude: center.lat, longitude: center.lng, zoom: map.getZoom() });
    }

    map.on("load", ask);
    map.on("moveend", settle);
    // A move the reader made carries the event that made it; one made by code
    // does not.
    map.on("movestart", (event) => {
      if (event.originalEvent) touchedRef.current = true;
    });
    // A press on bare ground puts the bubble away. The pins stop their own
    // presses from reaching this.
    map.on("click", () => setSelectedId(null));

    // The country the request came from, for when the reader's own position is
    // not to be had: the map goes to its capital.
    const toRegion = () =>
      loadRegion().then((region) => {
        if (cancelled || touchedRef.current || !region.center) return;
        map.jumpTo({ center: [region.center.longitude, region.center.latitude], zoom: region.center.zoom });
      });

    // Home, asked for by the Go-to sheet's way back: the reader's own position
    // where the browser gives it, and their country's capital where it does not.
    const goHome = async () => {
      touchedRef.current = false;
      const here = (await locationPermission()) === "granted" ? await locate() : null;
      if (cancelled) return;
      if (here) fly({ ...here, zoom: 13 });
      else toRegion();
    };

    if (journey?.home) {
      map.once("load", () => {
        // Unless a later one has been made in the meantime.
        if (takeJourney() === journey) goHome();
      });
    } else if (journey) {
      // Somewhere picked with the plane before the map was on screen.
      touchedRef.current = true;
      map.once("load", () => {
        if (takeJourney() === journey) fly(journey, { animate: false });
      });
    } else if (!kept) {
      // A fresh visit. Where the browser will say where the reader is, the map
      // opens there. Where it has to ask first, the question is put to them
      // (see the gate below) with the country's capital behind it meanwhile.
      // Where the answer is already no, the capital is where it stays.
      locationPermission().then(async (permission) => {
        if (cancelled) return;
        if (permission === "granted") {
          const here = await locate();
          if (cancelled || touchedRef.current) return;
          if (here) map.jumpTo({ center: [here.longitude, here.latitude], zoom: 13 });
          else toRegion();
          return;
        }
        toRegion();
        if (permission === "prompt" && !gateDismissed()) setGate("ask");
      });
    }

    const stopListening = onTravel((place) => {
      takeJourney();
      setGate(null);
      if (place.home) return goHome();
      touchedRef.current = true;
      fly(place);
    });

    return () => {
      cancelled = true;
      stopListening();
      window.clearTimeout(timer);
      window.clearTimeout(leaveRef.current);
      controller?.abort();
      hideSelf();
      for (const { marker } of markersRef.current.values()) marker.remove();
      markersRef.current.clear();
      popupRef.current?.remove();
      popupRef.current = null;
      sized.disconnect();
      mapRef.current = null;
      map.remove();
    };
    // Made once. The language it was made in is kept current below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setLanguage?.(mapLanguage(lang));
  }, [lang]);

  /* --------------------------------------------------------------- the area */

  // What the place the reader stands in is called, in the language the page is
  // in — switching language re-reads it, as it relabels the map.
  const placeLang = lang;
  // Somewhere else, what is offered is loading from the moment the reader
  // goes there — not only once the place has been named and the items are
  // asked for — so the old place's list is not shown under the new place's
  // name meanwhile. The items are always asked for again then (see below),
  // which ends it; a name only re-read in another language is not a move.
  const spotBefore = useRef(null);
  useEffect(() => {
    if (!spot) return undefined;
    if (spotBefore.current !== spot) {
      // The old place's name and ground go too: its name would stand over
      // the new place meanwhile, and the items would be asked for inside its
      // ground before the new one is known (the heading waits, as at first).
      if (spotBefore.current) setArea(undefined);
      spotBefore.current = spot;
      setFetching(true);
    }
    const controller = new AbortController();
    areaAt(spot.latitude, spot.longitude, placeLang, controller.signal)
      .then((found) => setArea(found ? { name: found.name, locality: found.locality, within: found.within, bbox: found.bbox } : null))
      .catch((error) => {
        if (error?.name !== "AbortError") setArea(null);
      });
    return () => controller.abort();
  }, [spot, placeLang]);

  // And everything offered there: asked once the area is known, since the
  // items standing inside it are part of the answer.
  const box = area?.bbox?.join(",") ?? "";
  useEffect(() => {
    if (!spot || area === undefined) return undefined;
    const controller = new AbortController();
    setFetching(true);
    api
      .getItemsAt(spot, area?.bbox ?? null, { signal: controller.signal })
      .then((data) => {
        setOffered(data.items ?? []);
        setFetching(false);
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setOffered([]);
        setFetching(false);
      });
    return () => controller.abort();
    // The area is watched by its box: a name re-read in another language is
    // the same ground.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, box, area === undefined]);

  /* --------------------------------------------------------------- the pins */

  // The pins follow the list: one per item in the window, kept where it is
  // while its item is still there, so a drag does not blink every pin on it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const present = new Set(shown.map((item) => item.id));
    for (const [id, entry] of markers) {
      if (present.has(id)) continue;
      entry.marker.remove();
      markers.delete(id);
    }
    for (const item of shown) {
      let entry = markers.get(item.id);
      if (!entry) {
        const element = pinElement();
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          setSelectedId((current) => (current === item.id ? null : item.id));
        });
        if (HOVERS) {
          element.addEventListener("mouseenter", () => {
            stay();
            setHoveredId(item.id);
          });
          element.addEventListener("mouseleave", leave);
        }
        const marker = new mapboxgl.Marker({ element, anchor: "bottom" })
          .setLngLat([item.longitude, item.latitude])
          .addTo(map);
        entry = { marker, element };
        markers.set(item.id, entry);
      }
      entry.marker.setLngLat([item.longitude, item.latitude]);
      entry.element.setAttribute("aria-label", item.title);
      // What category it is, said in the pin's head. Written only when it
      // has changed, so a drag that keeps a pin does not redraw it.
      const mark = item.category ?? "";
      if (entry.mark !== mark) {
        entry.element.querySelector(`.${styles.glyph}`).innerHTML = iconMarkup(item.category);
        entry.mark = mark;
      }
      setPinPhoto(entry.element, item.pin ?? item.thumb);
    }
    // `shown` is derived afresh each render; what it is derived from is what
    // is watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, category, query]);

  useEffect(() => {
    for (const [id, entry] of markersRef.current) {
      entry.element.classList.toggle(styles.pinChosen, id === selectedId);
      entry.element.classList.toggle(styles.pinPointed, id === pointedId);
    }
  }, [selectedId, pointedId, items, category, query]);

  // The item being looked at on a sheet over the list, by its id, and the row
  // it was opened from — which is given the keyboard back when the sheet is
  // put away, so the arrows carry on from where they were.
  const [previewId, setPreviewId] = useState(null);
  const lookedFrom = useRef(null);
  const look = (item, from) => {
    lookedFrom.current = from ?? null;
    setPreviewId(item.id);
  };
  const lookAway = () => {
    setPreviewId(null);
    lookedFrom.current?.focus?.();
  };

  // A row picked with the keys or the wheel, rather than with the pointer: it
  // is given the keyboard, and is from then on the one row marked — the row
  // the pointer happens to be lying on is no longer marked for that (see
  // data-keyed in the styles) until the pointer is moved again. Beside the
  // map the row picked is the item chosen on it as well: the map goes to its
  // pin and puts its bubble up, or puts the bubble away for one with no pin.
  // As lists, the item whose row was picked last — by the keys, the wheel or
  // a first press — which a second press opens. Kept aside rather than in
  // state: picking is done a row to every notch of the wheel, and drawing all
  // the thousands of rows again for each would make the wheel stutter. The
  // row picked has the keyboard, and is marked by that (see :focus-within).
  const tileChosen = useRef(null);

  // The columns drawn sideways until `row` stands whole inside the frame,
  // a little of the way left to go at every frame. Asked again before they
  // are there — the wheel spun fast, a column a notch — the way is only made
  // longer, and they carry on at the speed they had: the browser's own smooth
  // scrolling starts slow again each time it is asked, and a fast wheel reads
  // as a stutter of starts.
  const glide = useRef({ target: null, frame: 0 });
  const glideTo = (list, row) => {
    const state = glide.current;
    const from = state.frame ? state.target : list.scrollLeft;
    const frame = list.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    const start = box.left - frame.left - list.clientLeft + list.scrollLeft;
    const end = start + box.width;
    let target = from;
    if (start < target) target = start;
    else if (end > target + list.clientWidth) target = end - list.clientWidth;
    target = Math.max(0, Math.min(target, list.scrollWidth - list.clientWidth));
    state.target = target;
    if (state.frame || Math.abs(target - list.scrollLeft) < 1) return;
    const step = () => {
      const left = state.target - list.scrollLeft;
      if (Math.abs(left) < 1) {
        list.scrollLeft = state.target;
        state.frame = 0;
        return;
      }
      list.scrollLeft += left * 0.3;
      state.frame = requestAnimationFrame(step);
    };
    state.frame = requestAnimationFrame(step);
  };
  // Drawn sideways by hand meanwhile, the columns are left where the hand
  // puts them.
  const stopGlide = () => {
    cancelAnimationFrame(glide.current.frame);
    glide.current.frame = 0;
  };
  // Where nothing has been picked yet — or what was picked is no longer
  // listed — the first row is: it is given the keyboard, so the keys and the
  // wheel go on from it and a press opens it. Except while something is
  // being typed, which keeps the keyboard; the row is marked as chosen then
  // instead, until a row is picked.
  // The columns are laid out afresh after they stood aside for the word that
  // they were loading (see switching): the row picked before is picked again
  // then, if it is still listed.
  const [firstChosenId, setFirstChosenId] = useState(null);
  const laidOut = useRef(null);
  useEffect(() => {
    // Back on the map the pick is forgotten: the list comes back to its first.
    if (!listing) tileChosen.current = null;
    if (!listing || !listed?.length) return;
    const list = tileRows.current;
    if (!list?.firstElementChild) return;
    const fresh = laidOut.current !== list;
    laidOut.current = list;
    let at = listed.findIndex((item) => item.id === tileChosen.current);
    if (at >= 0 && !fresh) return;
    if (at < 0) at = 0;
    const row = list.children[at];
    tileChosen.current = listed[at].id;
    const held = document.activeElement;
    const typing = held instanceof HTMLElement && (held.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(held.tagName));
    if (typing || document.querySelector("[data-modal]")) {
      setFirstChosenId(listed[at].id);
      return;
    }
    row.querySelector("a")?.focus({ preventScroll: true });
    if (at === 0) list.scrollLeft = 0;
    else glideTo(list, row);
  }, [listing, listed, switching, fetching]);
  const pick = (list, row) => {
    if (!row) return;
    // Marked only when it is not already: the mark changes how every one of
    // the thousands of rows is drawn, and setting it again, though to the
    // same, has them all looked over again — a stutter at every notch.
    if (!("keyed" in list.dataset)) list.dataset.keyed = "";
    jogged.current = 0;
    // The whole row is brought into view, margins and all — focusing its link
    // would bring only the link, and leave the row cut by the frame's edge.
    row.querySelector("a")?.focus({ preventScroll: true });
    // As lists, a row picked off the edge brings a column in, and it is glided
    // to rather than jumped to (see glideTo); the list beside the map is
    // brought along as browsers bring things into view.
    if (list === tileRows.current) glideTo(list, row);
    else row.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    if (listing) {
      tileChosen.current = listed?.[[...list.children].indexOf(row)]?.id ?? null;
      // Null already at every notch but the first, which draws nothing.
      setFirstChosenId(null);
      return;
    }
    const item = listed?.[[...list.children].indexOf(row)];
    if (!item?.located) {
      setSelectedId(null);
      return;
    }
    touchedRef.current = true;
    setSelectedId(item.id);
    const map = mapRef.current;
    map?.flyTo({ center: [item.longitude, item.latitude], zoom: Math.max(map.getZoom(), 14), duration: 500 });
  };
  // Only for the pointer really moved: the browser also says the mouse has
  // moved when the rows have moved under a pointer at rest, as the wheel
  // carries them along, and taking the mark off then — for the next notch to
  // put it back — would have every row drawn afresh twice a notch. Nor for
  // the pixel or two a hand on the wheel jogs the mouse by: a few pixels'
  // way, gathered up since the mark was put on, is a move.
  const jogged = useRef(0);
  const unkey = (event) => {
    const list = event.currentTarget;
    if (!("keyed" in list.dataset)) {
      jogged.current = 0;
      return;
    }
    jogged.current += Math.abs(event.movementX) + Math.abs(event.movementY);
    if (jogged.current < 6) return;
    jogged.current = 0;
    delete list.dataset.keyed;
  };

  // The row a key leads to from `row`: the arrows go to the row above or
  // below — and, where the rows stand in columns, to the nearest row in the
  // column beside. h, j, k and l are the arrows left, down, up and right, as
  // they are in vi. Undefined for any other key; null where there is no row
  // that way.
  const rowToward = (list, row, pressed) => {
    const key = VI_KEYS[pressed] ?? pressed;
    const rows = [...list.children];
    const at = rows.indexOf(row);
    if (key === "ArrowUp") return rows[at - 1] ?? null;
    if (key === "ArrowDown") return rows[at + 1] ?? null;
    if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;
    const side = key === "ArrowLeft" ? -1 : 1;
    const here = row.getBoundingClientRect();
    // The rows of the nearest column on that side, and of them the one
    // level with this one, or the nearest to level there is.
    const beside = rows
      .map((each) => ({ each, box: each.getBoundingClientRect() }))
      .filter(({ box }) => (box.left - here.left) * side > 1);
    const nearest = Math.min(...beside.map(({ box }) => Math.abs(box.left - here.left)));
    return (
      beside
        .filter(({ box }) => Math.abs(Math.abs(box.left - here.left) - nearest) < 1)
        .sort((a, b) => Math.abs(a.box.top - here.top) - Math.abs(b.box.top - here.top))[0]?.each ?? null
    );
  };

  // The keys a list of rows answers to, heard on the list from whichever row
  // has the keyboard: the arrows and h, j, k, l move among the rows (see
  // rowToward), and the space bar opens the row's item on the sheet, or puts
  // the sheet away.
  const rowKeys = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const list = event.currentTarget;
    const row = event.target.closest?.("li");
    if (!row || row.parentElement !== list) return;
    if (event.key === " ") {
      event.preventDefault();
      const at = [...list.children].indexOf(row);
      if (previewId) lookAway();
      else if (listed?.[at]) look(listed[at], row.querySelector("a"));
      return;
    }
    if (previewId) return;
    const next = rowToward(list, row, event.key);
    if (next === undefined) return;
    event.preventDefault();
    pick(list, next);
  };

  // h, j, k and l pressed where no row has the keyboard yet — anywhere on the
  // page that is not being typed into, with no sheet open over it — start
  // among the rows: from the row chosen on the map where there is one, and
  // otherwise at the first. From then on the list hears them itself.
  const sideRows = useRef(null);
  const tileRows = useRef(null);
  useEffect(() => {
    const start = (event) => {
      if (!(event.key in VI_KEYS) || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const at = event.target;
      if (at instanceof HTMLElement && (at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName))) return;
      if (document.querySelector("[data-modal]")) return;
      const list = listing ? tileRows.current : sideRows.current;
      // Not a list put away at this width; and one whose row has the keyboard
      // has heard the key already.
      if (!list || list.offsetParent === null || list.contains(at)) return;
      const chosen = list.querySelector(".row-chosen");
      const next = chosen ? (rowToward(list, chosen, event.key) ?? chosen) : list.firstElementChild;
      event.preventDefault();
      pick(list, next);
    };
    window.addEventListener("keydown", start);
    return () => window.removeEventListener("keydown", start);
  });

  // The wheel over the columns of items, turned up or down, picks among them:
  // it steps from the row that has the keyboard to the next or the one before,
  // a row to every notch, however quickly they follow one another — what a
  // trackpad sends in crumbs is a row to every notch's worth — and the
  // columns glide after the row. Where no row
  // has the keyboard yet, the first notch gives it to the row under the
  // pointer, or to the first. With Shift held the wheel, whichever way it is
  // turned, steps to the nearest row in the column beside instead, as the
  // left and right arrows do — and the page is not scrolled sideways for it.
  // A wheel turned sideways without Shift draws the columns sideways, as it
  // always did.
  const wheeled = useRef({ sum: 0, at: 0, acrossAt: 0, pending: 0, across: false, under: null, frame: 0 });
  const rowWheel = (event, list) => {
    if (!list || previewId) return;
    const across = event.shiftKey;
    const sideways = across && Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const delta = sideways ? event.deltaX : event.deltaY;
    // A wheel's notch comes as one event of its own, a trackpad's swipe as a
    // run of crumbs. Browsers give a trackpad's away by its old wheelDelta
    // being exactly three times the new delta, the other way round; a notch's
    // is a whole turn of 120 whatever the delta is.
    const old = sideways ? event.wheelDeltaX : event.wheelDeltaY;
    const notch = event.deltaMode !== 0 || (old !== undefined && old !== 0 && old !== -3 * delta);
    if (!across && Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      if (event.deltaX) stopGlide();
      return;
    }
    if (across) event.preventDefault();
    const saved = wheeled.current;
    let steps;
    if (notch) {
      // Every notch is a row, however fast they come: turned five times, the
      // wheel goes five rows.
      steps = Math.sign(delta);
    } else if (across) {
      // Turned with Shift, a wheel's notch is sent on as a sideways scroll,
      // and some systems send it as small as a trackpad's crumb — so small
      // that a notch's worth would take several notches. Sideways, then, every
      // event is a column, as every notch is; only not faster than a column
      // in a few frames, for a trackpad swiped with Shift held sends dozens.
      if (!delta || event.timeStamp - saved.acrossAt < 50) return;
      saved.acrossAt = event.timeStamp;
      steps = Math.sign(delta);
    } else {
      // Crumbs from a turn that stopped a while ago are not part of this one.
      if (event.timeStamp - saved.at > 250) saved.sum = 0;
      saved.at = event.timeStamp;
      saved.sum += delta;
      // A row for every notch's worth, and what is over kept for the next:
      // a swipe goes on evenly, a row at a time, as far as it carries.
      steps = Math.trunc(saved.sum / 40);
      saved.sum -= steps * 40;
    }
    if (!steps) return;
    // The steps of one frame are taken together, at the frame: a wheel spun
    // fast sends several between two frames, and laying the page out again
    // for each, to be drawn once, is only time lost.
    if (saved.across !== across) saved.pending = 0;
    saved.across = across;
    saved.pending += steps;
    if (!saved.under) saved.under = event.target.closest?.("li");
    if (saved.frame) return;
    saved.frame = requestAnimationFrame(() => {
      const { pending, under } = saved;
      saved.frame = 0;
      saved.pending = 0;
      saved.under = null;
      const held = document.activeElement?.closest?.("li");
      let row = held?.parentElement === list ? held : null;
      let left = Math.abs(pending);
      // Where no row has the keyboard yet, the first step is to the row
      // under the pointer, or to the first.
      if (!row) {
        row = under?.parentElement === list ? under : list.firstElementChild;
        left -= 1;
      }
      for (; left > 0 && row; left -= 1) {
        const next = across
          ? rowToward(list, row, pending > 0 ? "ArrowRight" : "ArrowLeft")
          : pending > 0
            ? row.nextElementSibling
            : row.previousElementSibling;
        if (!next) break;
        row = next;
      }
      pick(list, row);
    });
  };

  // Heard natively rather than through React, whose wheel listeners are
  // passive and so cannot keep Shift and the wheel from scrolling the page.
  const rowWheelNow = useRef(rowWheel);
  rowWheelNow.current = rowWheel;
  useEffect(() => {
    const list = tileRows.current;
    if (!list) return;
    const hear = (event) => rowWheelNow.current(event, list);
    list.addEventListener("wheel", hear, { passive: false });
    return () => list.removeEventListener("wheel", hear);
  });

  // The list beside the map is not picked among by the wheel: it is a list
  // that scrolls up and down itself, and the wheel over it scrolls it.

  // A row of the list pressed, for an item that stands on the map: the first
  // press goes to its pin — the map moves there and its bubble is put up — and
  // keeps the row from going to the item's page; pressed again, with its
  // bubble up, the row goes there as it always did. An item with no pin has
  // nowhere on the map to go to, and its row goes to the page at once.
  //
  // As lists there is no map to go to, and an item with no pin has nowhere on
  // one: those rows open the item on a sheet over the list instead (see
  // ItemPreview), from which its page is one press further. As lists the
  // first press only picks the row, as the keys and the wheel do; pressed
  // again, picked, it opens the sheet.
  const pressRow = (item, event) => {
    // A press meant for a new tab or window is left to be one.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (listing && tileChosen.current !== item.id) {
      event.preventDefault();
      const row = event.currentTarget.closest("li");
      pick(row.parentElement, row);
      return;
    }
    if (listing || !item.located) {
      event.preventDefault();
      look(item, event.currentTarget);
      return;
    }
    if (selectedId === item.id) return;
    const map = mapRef.current;
    if (!map) return;
    event.preventDefault();
    touchedRef.current = true;
    setSelectedId(item.id);
    map.flyTo({ center: [item.longitude, item.latitude], zoom: Math.max(map.getZoom(), 14), duration: 800 });
  };

  // The bubble itself holds a borrowed bubble open while the pointer is in it.
  useEffect(() => {
    if (!HOVERS) return undefined;
    popupNode.addEventListener("mouseenter", stay);
    popupNode.addEventListener("mouseleave", leave);
    return () => {
      popupNode.removeEventListener("mouseenter", stay);
      popupNode.removeEventListener("mouseleave", leave);
    };
  }, [popupNode, stay, leave]);

  // The bubble over the pin being looked at. One popup, moved rather than remade; what
  // is in it is drawn by React through the portal below.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!open) {
      popupRef.current?.remove();
      return;
    }
    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        // The bubble opens under the pointer that asked for it; taking the
        // keyboard's focus as well would ring it like a field.
        focusAfterOpen: false,
        anchor: "bottom",
        // lo's offset: a pixel clear of the pin's head, whatever the pin. The
        // bubble stands on its pin, which puts it where the small photograph
        // was — the same picture, opened out — rather than above it.
        offset: POPUP_OFFSET,
        maxWidth: "none",
      }).setDOMContent(popupNode);
    }
    popupRef.current.setLngLat([open.longitude, open.latitude]).addTo(map);
  }, [open, popupNode]);

  /* -------------------------------------------------------------- the tools */

  async function goToMe() {
    const here = await locate({ timeout: 12000 });
    if (here) {
      touchedRef.current = true;
      fly({ ...here, zoom: 14 });
    } else {
      setGate(locateFailure() ?? "failed");
    }
  }

  async function allow() {
    setGate("locating");
    const here = await locate({ timeout: 15000 });
    if (here) {
      touchedRef.current = true;
      fly({ ...here, zoom: 13 });
      setGate(null);
    } else {
      setGate(locateFailure() ?? "failed");
    }
  }

  function dismiss() {
    try {
      sessionStorage.setItem(GATE_KEY, "1");
    } catch {
      // Asked again on the next page, which is the worst this costs.
    }
    setGate(null);
  }

  if (!MAPBOX_TOKEN) {
    return (
      <section className={styles.frame}>
        <p className={styles.noToken}>{t("map.noToken")}</p>
      </section>
    );
  }

  return (
    <div className={listing ? `${styles.layout} ${styles.listing}` : styles.layout}>
      {/* Beside the map, where the reader is: the name of the area they stand
          in, and under it everything offered there — the items with pins and
          the ones without. It does not follow the map as it is moved. */}
      <aside className={styles.side} aria-label={t("map.area")}>
        <header className={styles.sideHead}>
          <h1 className={styles.areaName}>
            {area === undefined ? <span className={styles.pending} aria-hidden="true" /> : area?.name || t("map.areaUnknown")}
          </h1>
          {/* The line stands whether or not there is anything on it, so the
              list under it does not jump when the name arrives. */}
          <p className={styles.areaWithin}>
            {/* As lo's strip has it: the ward, then the prefecture. */}
            <span>{[area?.locality, area?.within].filter(Boolean).join(" · ")}</span>
            {listed && <span>{t("map.areaCount", { count: listed.length })}</span>}
          </p>
        </header>
        {/* The box that narrows the list: in the top bar where there is room
            (see Header), and here on a phone. */}
        <FilterBox slash className={styles.sideFilter} value={query} onChange={onQuery} placeholder={t("search.placeholder")} />
        {/* As lists, the column is what narrows them: the categories. */}
        {listing && (
          <div className={styles.categoryRow} role="group" aria-label={t("item.category")}>
            {/* On a phone the list of categories is put away, and the
                category is picked from the dropdown the map has instead. */}
            <Select
              className={styles.category}
              fit
              label={t("item.category")}
              value={category}
              onChange={setCategory}
              options={menuOptions}
              searchPlaceholder={t("item.categorySearch")}
              emptyLabel={t("item.categoryNoMatch")}
            />
          </div>
        )}
        {/* Over the categories, the box that finds one among them. */}
        {listing && (
          <FilterBox
            className={styles.categoryFilter}
            value={categoryQuery}
            onChange={setCategoryQuery}
            placeholder={t("item.categorySearch")}
          />
        )}
        {/* The categories, as a list of short rows: the
            one pressed is the one the items are narrowed to. */}
        {listing && (
          <ul className={styles.choices} aria-label={t("item.category")}>
            {categoriesFound.length === 0 && <li className={styles.choiceNone}>{t("item.categoryNoMatch")}</li>}
            {categoriesFound.map((option) => (
              <li
                key={option.value}
                onDragOver={(event) => {
                  if (!takes(option.value)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dropOn !== option.value) setDropOn(option.value);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setDropOn((current) => (current === option.value ? null : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  drop(option.value, option.name);
                }}
              >
                <button
                  type="button"
                  className={[styles.choice, category === option.value && styles.choiceChosen, dropOn === option.value && styles.choiceDrop]
                    .filter(Boolean)
                    .join(" ")}
                  aria-pressed={category === option.value}
                  onClick={() => setCategory(option.value)}
                >
                  {option.label}
                  {/* How many of them are offered here, at the row's far end:
                      everything for "all", and nothing
                      written where there are none. */}
                  {(option.value === "" ? heldAll : held.get(option.value)) > 0 && (
                    <span className={styles.choiceCount}>{option.value === "" ? heldAll : held.get(option.value)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.sideList} hidden={listing}>
          {/* A search that found nothing says so. An area with nothing in
              it says so too, and asks for the first thing: the way to put
              one out, here where it is missing. */}
          {listed?.length === 0 &&
            (words.length > 0 ? (
              <p className={styles.sideEmpty}>{t("search.empty")}</p>
            ) : (
              <div className={styles.sideEmpty}>
                <p>{t("map.areaEmpty")}</p>
                <p>{t("map.areaEmptyAsk")}</p>
                <button type="button" className="small-button" onClick={() => window.dispatchEvent(new Event(LIST_EVENT))}>
                  {t("header.list")}
                </button>
              </div>
            ))}
          {listed?.length > 0 && (
            <ul ref={sideRows} className="row-list" onKeyDown={rowKeys} onMouseMove={unkey}>
              {listed.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  pin
                  chosen={item.id === selectedId}
                  onPress={(event) => pressRow(item, event)}
                  onPoint={item.located ? (on) => setPointedId((current) => (on ? item.id : current === item.id ? null : current)) : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* And the rest of the page: everything offered here, laid out in
          columns of the same width, as many as there are, read sideways. A
          wheel turned up or down picks among them, row by row (see
          rowWheel). */}
      {listing &&
        (!listed || fetching || switching ? (
          // Being brought: the frame the columns will stand in, and in the
          // middle of it word that they are coming.
          <div className={`${styles.sideEmpty} ${styles.tilesEmpty}`} role="status">
            <p>{t("common.loading")}</p>
          </div>
        ) : listed.length > 0 ? (
          <ul
            ref={tileRows}
            className={`row-list ${styles.tiles}`}
            onKeyDown={rowKeys}
            onMouseMove={unkey}
          >
            {listed.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                pin
                chosen={item.id === firstChosenId}
                onPress={(event) => pressRow(item, event)}
                onDrag={mayMove(item) ? (event) => carry(item, event) : undefined}
              />
            ))}
          </ul>
        ) : (
          <div className={`${styles.sideEmpty} ${styles.tilesEmpty}`}>
            {filtering ? (
              <p>{t("search.empty")}</p>
            ) : (
              <>
                <p>{t("map.areaEmpty")}</p>
                <p>{t("map.areaEmptyAsk")}</p>
                <button type="button" className="small-button" onClick={() => window.dispatchEvent(new Event(LIST_EVENT))}>
                  {t("header.list")}
                </button>
              </>
            )}
          </div>
        ))}

      <section className={`${styles.frame} map-frame`} aria-label={t("map.title")}>
        <div ref={containerRef} className={styles.container} />

        <MapTools
          onZoomIn={() => mapRef.current?.zoomIn()}
          onZoomOut={() => mapRef.current?.zoomOut()}
          onLocate={goToMe}
        />

        {/* Which category the pins are for: all of them unless one is
            picked. */}
        <div className={styles.filters} role="group" aria-label={t("item.category")}>
          <Select
            className={styles.category}
            fit
            label={t("item.category")}
            value={category}
            onChange={setCategory}
            options={menuOptions}
            searchPlaceholder={t("item.categorySearch")}
            emptyLabel={t("item.categoryNoMatch")}
          />
        </div>

        {/* How much there is to see in this window, said once it is known. */}
        {loaded && (
          <p className={styles.count}>
            {failed ? t("map.failed") : shown.length === 0 ? t("map.empty") : t("map.count", { count: shown.length })}
          </p>
        )}

        {/* The question a map of what is nearby has to ask: where is near. Put
            to the reader in words before the browser puts it in a dialog, so the
            dialog is the answer to something they have just been asked rather
            than the first thing the page does. */}
        {gate && (
          <div className={styles.gate}>
            <section className={styles.gateCard}>
              <h2 className="auth-logo">rab</h2>
              <p className="tagline">{t("gate.body")}</p>
              {/* Why it came to nothing, where it did: refused, no answer
                  from the device, or a page the browser will not locate for. */}
              {(gate === "denied" || gate === "failed" || gate === "insecure") && (
                <p className={styles.gateStatus} role="status">
                  <strong>{t(`gate.${gate}`)}</strong>
                  <span>{t(`gate.${gate}Hint`)}</span>
                </p>
              )}
              <button type="button" className="primary-button" onClick={allow} disabled={gate === "locating"}>
                {gate === "locating" ? t("gate.locating") : gate === "ask" ? t("gate.enable") : t("gate.retry")}
              </button>
              <button type="button" className={styles.gateSkip} onClick={dismiss}>
                {t("gate.skip")}
              </button>
            </section>
          </div>
        )}

        {open &&
          createPortal(
            <div className={styles.card}>
              {/* What it is, and the way to its page: everything above the two
                  buttons is one link. */}
              <Link className={styles.cardBody} to={`/i/${open.id}`}>
                {open.thumb && <img className={styles.cardPhoto} src={open.thumb} alt="" />}
                <strong className={styles.cardTitle}>{open.title}</strong>
                {open.what && <span className={styles.cardMeta}>{open.what}</span>}
                {/* What its owner wrote about it, as lo's Wikipedia bubble gives
                    an article's lead: the first three lines, the rest being what
                    the page is for. */}
                {open.description && <span className={styles.cardLead}>{open.description}</span>}
                {!open.store && <span className={styles.cardPrice}>{priceLine(open, lang, t)}</span>}
                <span className={styles.cardMeta}>
                  {dotted([sortLabel(open, t), open.place, open.owner && <UserName name={open.owner} inside />])}
                </span>
              </Link>
              {/* The two things to do about it, as lo's bubbles say theirs: small
                  grey underlined words at the foot, not boxes. Read its page, or
                  go straight to asking for it — the same page, opened on its
                  calendar. Nobody
                  asks to rent their own, so on those there is only the one. */}
              <span className={styles.cardActions}>
                <Link className={styles.cardLink} to={`/i/${open.id}`}>
                  {t("map.open")}
                </Link>
                {open.owner !== user?.username &&
                  // Something booked by asking is asked for the way its
                  // owner said first: a phone number is called and an
                  // email address is written to, straight from here. Any
                  // other goes to the page, on its calendar or its address.
                  // Beside the word, the way its owner said first, drawn:
                  // a telephone, a letter, a message here.
                  (open.mode === "inquiry" && contactHref(open.contacts?.[0], open.title) ? (
                    <a className={styles.cardLink} href={contactHref(open.contacts[0], open.title)}>
                      {t("map.request")}
                      <ContactIcon type={open.contacts[0].type} />
                    </a>
                  ) : (
                    <Link className={styles.cardLink} to={`/i/${open.id}?book=1`}>
                      {t("map.request")}
                      <ContactIcon type={open.contacts?.[0]?.type} />
                    </Link>
                  ))}
              </span>
            </div>,
            popupNode,
          )}
      </section>

      {/* An item opened from its row, on a sheet over the list. */}
      <ItemPreview
        id={previewId}
        onClose={lookAway}
        // Deleted or switched off on the sheet, it is taken out of what is
        // listed and pinned here at once, rather than left until the next
        // time the lists are asked for.
        onGone={(gone) => {
          const without = (list) => list?.filter((item) => item.id !== gone) ?? list;
          setOffered(without);
          setItems(without);
          setFound(without);
          setSelectedId((current) => (current === gone ? null : current));
        }}
      />
    </div>
  );
}
