import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import * as api from "../../api.js";
import { Link, Select, showToast, useLocation, useNavigate, useSearchParams } from "../../ui/index.js";
import { iconMarkup, markOf } from "../../utils/categoryIcons.js";
import { priceLine, requestBudget, requestDates } from "../../utils/format.js";
import { contactHref } from "../../utils/dialing.js";
import { directionsLink } from "../../utils/maps.js";
import { CATEGORY_GROUPS, groupsFor, homeFilter, homePath, sortLabel, categoriesOfItem } from "../../utils/categories.js";
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
import { loginPath, useAuth } from "../AuthProvider/index.js";
import { HOME_EVENT, LIST_EVENT, NEED_EVENT, REQUESTED_EVENT } from "../Header/Header.jsx";
import RequestModal, { RequestView } from "../RequestModal/index.js";
import ItemModal from "../ItemModal/index.js";
import { categoriesOf } from "../CategoryFilter/index.js";
import CategoryIcon from "../CategoryIcon/index.js";
import FilterBox from "../FilterBox/index.js";
import { setListed } from "../../utils/seek.js";
import ItemPreview from "../ItemPreview/index.js";
import MessageModal from "../MessageModal/index.js";
import { itemPath } from "../../utils/spots.js";
import UserName, { dotted } from "../UserName/index.js";
import styles from "./map.module.css";


// The scale the map opens on where it knows where the reader is — and the
// widest one "my position" leaves it at.
const DEFAULT_ZOOM = 13;
// How long the map has to have stopped moving before the items in its window
// are asked for, so a drag is one request rather than one per frame of it.
const SETTLE_MS = 250;
// The rows of a list drawn at a time, and how near its last drawn row the keys
// or the wheel come before more are drawn (see drawn).
const ROWS_STEP = 200;
const ROWS_NEAR = 40;

// How much ground past the window is asked for with it, as a share of the
// window's own width and height on each side: half a window all round, so a
// drag of up to half a screen finds its pins already there. A zoom of this
// much or more from the one last asked at asks again even inside that ground —
// in, for a smaller box than the one held; out, since it has outgrown it.
const FETCH_MARGIN = 0.5;
const REFETCH_ZOOM = 1;

const wrapLongitude = (longitude) => mapboxgl.LngLat.convert([longitude, 0]).wrap().lng;

// Whether a spot is inside the window, whose longitudes may run past ±180.
function inView(view, item) {
  if (!view || item.latitude == null || item.longitude == null) return false;
  if (item.latitude < view.south || item.latitude > view.north) return false;
  if (view.east - view.west >= 360) return true;
  const west = wrapLongitude(view.west);
  const east = wrapLongitude(view.east);
  return west <= east
    ? item.longitude >= west && item.longitude <= east
    : item.longitude >= west || item.longitude <= east;
}

// How much ground past the window keeps its pins on the map, as a share of the
// window's width and height on each side. Only those are attached: the map
// moves every attached pin on every frame of a drag, and the items held reach
// far past the window (see FETCH_MARGIN), so attaching all of them makes a
// drag stutter. A little past the edge, so a pin and the photograph above it
// are there before they slide in.
const PIN_MARGIN = 0.25;

// Attaches the pins near the window and takes the rest off the map. Their
// elements are kept, photographs loaded and all, for when they come back.
function cullPins(map, markers) {
  if (!map || markers.size === 0) return;
  const bounds = map.getBounds();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const padX = (east - west) * PIN_MARGIN;
  const padY = (north - south) * PIN_MARGIN;
  const top = north + padY;
  const bottom = south - padY;
  const whole = east - west + padX * 2 >= 360;
  const left = wrapLongitude(west - padX);
  const right = wrapLongitude(east + padX);
  for (const entry of markers.values()) {
    const { latitude, longitude } = entry.item;
    const near =
      latitude >= bottom &&
      latitude <= top &&
      (whole || (left <= right ? longitude >= left && longitude <= right : longitude >= left || longitude <= right));
    if (near && !entry.attached) entry.marker.addTo(map);
    else if (!near && entry.attached) entry.marker.remove();
    entry.attached = near;
  }
}

// How long a row has to be held still, as lists, before a drag carries it to
// a category rather than drawing the columns sideways.
const HOLD_MS = 300;

// How far above the spot a bubble sits: the pin's own height (25.2px) and a
// pixel, as in lo.
const POPUP_OFFSET = 26;

// Whether the reader has already been asked for their location this visit and
// said not now. Kept for the tab's life only: the next visit asks again, since
// a map of what is nearby has one question worth asking twice.
const GATE_KEY = "rab:gate-dismissed";

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
    // The frame stands over the pin only once its picture is there: an empty
    // white square while it loads, or for one that never does, says nothing.
    image.addEventListener("load", () => frame.classList.add(styles.pinPhotoLoaded));
    image.addEventListener("error", () => frame.classList.remove(styles.pinPhotoLoaded));
    frame.append(image);
    element.append(frame);
  }
  const image = frame.firstChild;
  if (image.getAttribute("src") !== src) {
    frame.classList.remove(styles.pinPhotoLoaded);
    image.src = src;
    if (image.complete && image.naturalWidth > 0) frame.classList.add(styles.pinPhotoLoaded);
  }
}

// What a request says, in a small box over its pin where it has no
// photograph to stand there: a request is told by its words. `text` empty
// takes the box away.
function setPinLabel(element, text) {
  let label = element.querySelector(`.${styles.pinLabel}`);
  if (!text) {
    label?.remove();
    return;
  }
  if (!label) {
    label = document.createElement("span");
    label.className = styles.pinLabel;
    element.append(label);
  }
  if (label.textContent !== text) label.textContent = text;
}

// The map the site opens on: everything out for rent in the window being
// looked at, each standing where it is picked up.
// What the bubble holds: the node React draws its card into, wrapped in one
// that sorts out the presses on it now that it stands on the map's ground
// (see where the popup is added), where the map hears them too. A press is
// not the map's — it would put the bubble away as a press on bare ground —
// and a drag that started on the card and moved the map is not a press on
// the link it ended over.
function bubbleNode(content) {
  const wrapper = document.createElement("div");
  wrapper.append(content);
  let from = null;
  wrapper.addEventListener("pointerdown", (event) => {
    from = { x: event.clientX, y: event.clientY };
  });
  wrapper.addEventListener(
    "click",
    (event) => {
      const moved = from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > 4;
      from = null;
      if (!moved) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  wrapper.addEventListener("click", (event) => event.stopPropagation());
  return wrapper;
}

// A row of the list beside the map, drawn again only when its item or
// whether it is chosen changes — so choosing another item redraws two rows,
// not thousands. What it does when pressed or pointed at is left out of the
// comparison: those look up what to do when they are called (see sideList),
// so the ones it was first given still do the right thing.
const SideRow = memo(
  ItemRow,
  (before, after) => before.item === after.item && before.chosen === after.chosen && before.pin === after.pin,
);

// Which the map shows: what is offered, or what people are asking for. Kept
// for the tab's life, as the view is.
const KIND_KEY = "rab:home-kind";
function keptKind() {
  try {
    return sessionStorage.getItem(KIND_KEY) === "requests" ? "requests" : "offers";
  } catch {
    return "offers";
  }
}
// How far from where the reader stands a request is listed beside the map,
// where the area's own ground is not known: about thirty kilometres.
const REQUEST_NEAR = 0.3;

export default function MapView({ view = "map", query = "", onQuery, active = true }) {
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
  const [itemsOf, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  // The row of the list the pointer is resting on: its pin is lit for as long
  // as it rests there, and no bubble is put up for it.
  const [pointedId, setPointedId] = useState(null);
  // Which category the pins are for is in the address — /c/camera — so the
  // page can be sent to somebody as it stands. Changing it changes the
  // address in place: no new entry to step back
  // through, and what the entry carries (see utils/back.js) is kept.
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { category } = homeFilter(pathname) ?? { category: "" };
  // And which theme the categories are narrowed to (see CATEGORY_GROUPS) is
  // beside it, as `?g=music`: the categories to pick from are then the
  // theme's, and "all categories" is all of those.
  const [searchParams] = useSearchParams();
  const wantedGroup = searchParams.get("g") ?? "";
  // The grown-up theme is one only for whoever may see its category.
  const themes = groupsFor(Boolean(user?.adult));
  const group = themes.includes(wantedGroup) ? wantedGroup : "";
  const groupSlugs = group ? CATEGORY_GROUPS[group] : null;
  const inGroup = (item) => !groupSlugs || categoriesOfItem(item).some((slug) => groupSlugs.includes(slug));
  const goTo = (slug, theme) =>
    navigate(`${homePath(slug)}${theme ? `?g=${theme}` : ""}`, { replace: true, scroll: false, state: window.history.state });
  const setCategory = (slug) => goTo(slug, group);
  // Pressed again, the theme in force is let go of. A category that is not
  // of the theme picked is let go of with it.
  // Letting go of the theme altogether ("none") lets go of the category too:
  // back to all categories.
  const setGroup = (theme) => {
    if (!theme) return goTo("", "");
    const next = theme === group ? "" : theme;
    goTo(next && category && !CATEGORY_GROUPS[next].includes(category) ? "" : category, next);
  };
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
  // Whether the device has been asked where the reader is and has answered,
  // one way or the other — or was never going to be asked.
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    // The capital is what stands in for a position that is not to be had, so
    // it is asked for whether or not the map itself needs it to open on.
    loadRegion();
    // And the capital waits its turn where the device is about to say where
    // the reader is: named meanwhile, it would be the wrong place's name and
    // list, shown for as long as the device takes.
    let gone = false;
    locationPermission()
      .then((permission) => (permission === "granted" ? locate() : null))
      .catch(() => null)
      .then(() => {
        if (!gone) setAsked(true);
      });
    const stop = onPosition((found) => setSelf(found));
    return () => {
      gone = true;
      stop();
    };
  }, []);
  const fallback = asked ? (region.center ?? (region.ready ? DEFAULT_VIEW : null)) : null;
  const stand = region.place ?? self ?? fallback;
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
  const [offeredOf, setOffered] = useState(null);
  // While what is offered is being asked for — the first time, or again for
  // somewhere else. As lists the frame stands empty then, saying so.
  const [fetching, setFetching] = useState(false);

  // Offers or requests: the switch at the map's left. Requests are few, and
  // are asked for whole when the switch is first turned to them; the pins are
  // all of them, and the list beside the map the ones in the reader's area.
  const [kind, setKindState] = useState(keptKind);
  const requesting = kind === "requests";
  const setKind = (next) => {
    setKindState(next);
    setSelectedId(null);
    try {
      sessionStorage.setItem(KIND_KEY, next);
    } catch {
      // Opens on what is offered next time.
    }
  };
  const [requests, setRequests] = useState(null);
  useEffect(() => {
    if (!requesting) return undefined;
    const controller = new AbortController();
    api
      .getRequests({ signal: controller.signal })
      .then((data) => setRequests(data.requests ?? []))
      .catch((error) => {
        if (error?.name !== "AbortError") setRequests((current) => current ?? []);
      });
    return () => controller.abort();
  }, [requesting]);
  // One just posted from the bar stands on the map at once, which turns to
  // requests to show it.
  useEffect(() => {
    const posted = (event) => {
      const request = event.detail;
      if (!request) return;
      setRequests((current) => [request, ...(current ?? []).filter((each) => each.id !== request.id)]);
      setKind("requests");
      setSelectedId(request.id);
      if (request.located !== false) mapRef.current?.flyTo({ center: [request.longitude, request.latitude], zoom: Math.max(mapRef.current.getZoom(), 14), duration: 800 });
    };
    window.addEventListener(REQUESTED_EVENT, posted);
    return () => window.removeEventListener(REQUESTED_EVENT, posted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The wordmark pressed: home is what is offered, so the map turns back to
  // offers.
  useEffect(() => {
    const home = () => setKind("offers");
    window.addEventListener(HOME_EVENT, home);
    return () => window.removeEventListener(HOME_EVENT, home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The request whose maker is being written to, from its card.
  const [writingAbout, setWritingAbout] = useState(null);
  // The request being read on a sheet.
  const [viewing, setViewing] = useState(null);
  // What its maker is changing, from the bubble's "Edit": a request, on the
  // form it was asked on, or an item or a spot, on the form it was put out on
  // — which wants the whole of it and its calendar, asked for first.
  const [editingRequest, setEditingRequest] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const isMine = (item) => Boolean(user && (item.kind === "request" ? (item.mine ?? item.owner === user.username) : item.owner === user.username));
  const edit = async (item) => {
    if (item.kind === "request") return setEditingRequest(item);
    try {
      const data = await api.getItem(item.id);
      setEditingItem({ item: data.item, calendar: data.calendar });
    } catch (error) {
      showToast(error.message, 3000);
    }
  };
  const requestsHere = useMemo(() => {
    if (!requests || !spot) return requests;
    const bbox = area?.bbox;
    // One asked in an area the reader stands in is listed too, wherever in
    // it its own spot is — as an item is by the area it is offered in.
    const inside = (box) => box && spot.latitude >= box[1] && spot.latitude <= box[3] && spot.longitude >= box[0] && spot.longitude <= box[2];
    // One with no spot of its own is found by its area alone.
    return requests.filter(
      (request) =>
        inside(request.region?.bbox) ||
        (request.located === false
          ? false
          : bbox
          ? request.latitude >= bbox[1] && request.latitude <= bbox[3] && request.longitude >= bbox[0] && request.longitude <= bbox[2]
          : Math.abs(request.latitude - spot.latitude) < REQUEST_NEAR && Math.abs(request.longitude - spot.longitude) < REQUEST_NEAR),
    );
  }, [requests, spot, area]);
  // What the pins and the list are drawn from: the items, or the requests.
  // Only a request with a spot of its own has a pin.
  const pinnedRequests = useMemo(() => (requests ?? []).filter((request) => request.located !== false), [requests]);
  const items = requesting ? pinnedRequests : itemsOf;
  const offered = requesting ? requestsHere : offeredOf;

  // `query` is what is being looked for, typed in the box in the top bar (the
  // page holds it): a filter on what is already here — the list and the pins
  // alike — rather than a search somewhere else.
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Which category the pins are for: "" is all of them. "Other" is always
  // the last of the choices.
  const categoryChoices = categoriesOf(Boolean(user?.adult)).filter((slug) => !groupSlugs || groupSlugs.includes(slug));
  // Each one leads with its own mark, the one its pins wear on the map.
  // `text` is what the search reads, since the label is no longer a plain
  // string.
  const withIcon = (slug, name) => (
    <span className={styles.categoryName}>
      <CategoryIcon category={slug} />
      {name}
    </span>
  );
  const allName = group ? t("map.allCategoriesIn", { group: t(`group.${group}`) }) : t("map.allCategories");
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
    // A spot with no category of its own counts under each of its items'.
    const kinds = categoriesOfItem(item);
    for (const kind of kinds.length ? kinds : [item.category]) held.set(kind, (held.get(kind) ?? 0) + 1);
    // "All" of a theme is what is in any of its categories.
    if (inGroup(item)) heldAll += 1;
  }
  // The themes, as a dropdown beside the categories': closed, it says the
  // theme in force, or just what it is a list of where there is none.
  const groupOptions = ["", ...themes].map((theme) => {
    const name = theme ? t(`group.${theme}`) : t("group.none");
    const named = (words) => (
      <span className={styles.categoryName}>
        <CategoryIcon group={theme} />
        {words}
      </span>
    );
    return { value: theme, label: named(name), short: named(theme ? name : t("group.label")), text: name };
  });
  const groupSelect = (
    <Select
      className={styles.category}
      fit
      label={t("group.label")}
      value={group}
      onChange={(theme) => theme !== group && setGroup(theme)}
      options={groupOptions}
    />
  );
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
  const mayMove = (item) => Boolean(user && item.kind !== "request" && (item.shared || item.owner === user.username || isAdmin(user)));
  const carriedRef = useRef(null);
  // A drag over the columns with the mouse, as lists: `held` once a row that
  // can be carried has been held still long enough (HOLD_MS) to be picked up.
  // `coast`, the frame of the glide a drag let go while moving carries on in.
  const swipe = useRef({ held: false, bound: null, coast: 0 });
  const [dropOn, setDropOn] = useState(null);
  const carry = (item, event) => {
    if (!event) {
      carriedRef.current = null;
      swipe.current.held = false;
      setDropOn(null);
      return;
    }
    // Only a row held a moment first is picked up: a drag straight away
    // draws the columns sideways instead (see the swipe below), and the
    // browser's carrying is called off for it.
    if (!swipe.current.held) {
      event.preventDefault();
      return;
    }
    carriedRef.current = item;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.title);
    // What follows the pointer is the whole card, in the black frame it was
    // given when the press had been held long enough (see data-held).
    // The column's rule, which each card draws down from its side, is taken
    // off for the moment the browser takes the picture, and put back after.
    const card = event.currentTarget;
    const box = card.getBoundingClientRect();
    card.dataset.lifting = "";
    event.dataTransfer.setDragImage(card, event.clientX - box.left, event.clientY - box.top);
    window.setTimeout(() => delete card.dataset.lifting, 0);
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
    if (category && !categoriesOfItem(item).includes(category)) return false;
    if (!category && !inGroup(item)) return false;
    if (words.length === 0) return true;
    const text = [item.title, item.description, item.place, item.owner, item.category && t(`category.${item.category}`, item.category)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  };
  const filtering = Boolean(category || group || words.length);
  const shown = filtering ? items.filter(passes) : items;
  // Of those, the ones inside the window itself, which is what the count says.
  const [viewBox, setViewBox] = useState(null);
  const inWindow = shown.filter((item) => inView(viewBox, item)).length;
  // Something looked for by name is looked for everywhere, not only in the
  // area the reader stands in: the box is in the bar, over the whole page, and
  // a title typed into it is expected to be found wherever the item is. So
  // while there is something typed, what the server finds for it anywhere is
  // listed after what is offered here — and then narrowed like the rest.
  const [foundOf, setFound] = useState(null);
  const sought = query.trim();
  // Requests are only narrowed among themselves, not looked for elsewhere.
  const found = requesting ? null : foundOf;
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
  // Worked out again only when what it comes from changes — not when the map
  // is moved, or its pins arrive — so the list drawn from it (see sideList)
  // can be kept as it is meanwhile.
  const listed = useMemo(() => {
    const here = offered ?? (sought && found ? [] : null);
    const pool =
      here && sought && found ? [...here, ...found.filter((item) => !here.some((each) => each.id === item.id))] : here;
    return pool && (filtering ? pool.filter(passes) : pool);
    // `passes` and `filtering` are derived afresh each render from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offered, found, sought, category, group, query, t]);
  // What is listed is also what the bar's "Ask AI" chooses from, when asked
  // to pick one (see seek.js) — while this is the page in front.
  useEffect(() => {
    if (!active) return undefined;
    setListed(
      listed,
      filtering,
      spot && {
        ...spot,
        name: [area?.name, area?.locality, area?.within].filter(Boolean).join(", "),
        // The device's own word for where they are, and not the plane's or
        // the capital's.
        exact: Boolean(self && !region.place),
        away: Boolean(region.place),
      },
    );
    return () => setListed([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listed, active, spot, area, self, region.place]);
  // As lists, the item whose row was picked last — by the keys, the wheel or
  // a first press — which a second press opens. Kept aside rather than in
  // state: picking is done a row to every notch of the wheel, and drawing all
  // the thousands of rows again for each would make the wheel stutter. The
  // row picked has the keyboard, and is marked by that (see :focus-within).
  const tileChosen = useRef(null);
  // Of those listed, the rows drawn so far: an area can have tens of
  // thousands, and drawing them all at once is what keeps the page waiting.
  // The first few hundred are drawn at once, and more as the list is scrolled
  // — or stepped through with the keys or the wheel — towards its end.
  // Counted and narrowed is still the whole of it. A list worked out afresh
  // starts over — drawn as far as the row picked in it, where that is still
  // listed, for it to be picked again (see firstChosenId).
  const [drawn, setDrawn] = useState(ROWS_STEP);
  const [drawnOf, setDrawnOf] = useState(listed);
  if (drawnOf !== listed) {
    setDrawnOf(listed);
    const at = listed?.findIndex((item) => item.id === tileChosen.current) ?? -1;
    setDrawn(Math.max(ROWS_STEP, at + ROWS_NEAR + ROWS_STEP));
  }
  const drawnRows = useMemo(() => listed?.slice(0, drawn), [listed, drawn]);
  // Drawn at least as far as the row at `at`, and a step beyond it. Nothing
  // asked of React otherwise: the wheel picks a row every notch, and each ask
  // has the page drawn again.
  const drawTo = (at) => {
    if (at + ROWS_NEAR < drawn) return;
    setDrawn((now) => (at + ROWS_NEAR >= now ? at + ROWS_NEAR + ROWS_STEP : now));
  };
  // More rows wherever the list scrolled is within two of its frames of the
  // last row drawn: down beside the map, sideways as columns.
  const drawMore = (scroller, sideways) => {
    if (!scroller || !listed || drawn >= listed.length) return;
    const frame = sideways ? scroller.clientWidth : scroller.clientHeight;
    if (!frame) return;
    const left = sideways
      ? scroller.scrollWidth - scroller.scrollLeft - frame
      : scroller.scrollHeight - scroller.scrollTop - frame;
    if (left < frame * 2) setDrawn((now) => now + ROWS_STEP);
  };
  // The one whose bubble is up: the pin that was pressed. Resting the pointer
  // on a pin only lights it; the bubble waits for a press.
  const open = shown.find((item) => item.id === selectedId) ?? null;

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

    // The box last asked for, wider than the window by FETCH_MARGIN all round,
    // and the zoom it was asked at. A move that stays inside it at much the
    // same zoom has its pins already, so a drag shows them as it goes rather
    // than after it stops.
    let fetched = null;

    function ask() {
      const bounds = map.getBounds();
      const view = { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() };
      const zoom = map.getZoom();
      if (
        fetched &&
        Math.abs(zoom - fetched.zoom) < REFETCH_ZOOM &&
        view.south >= fetched.south &&
        view.north <= fetched.north &&
        view.west >= fetched.west &&
        view.east <= fetched.east
      ) {
        return;
      }
      const width = view.east - view.west;
      const height = view.north - view.south;
      const box = {
        south: Math.max(-90, view.south - height * FETCH_MARGIN),
        north: Math.min(90, view.north + height * FETCH_MARGIN),
        west: view.west - width * FETCH_MARGIN,
        east: view.east + width * FETCH_MARGIN,
      };
      // A box wider than the world is the whole of it; one that runs past
      // the antimeridian has its edges brought back into range, which leaves
      // west greater than east — the server reads that as a box that wraps.
      const whole = box.east - box.west >= 360;
      controller?.abort();
      controller = new AbortController();
      api
        .getItems(
          {
            south: box.south,
            north: box.north,
            west: whole ? -180 : wrapLongitude(box.west),
            east: whole ? 180 : wrapLongitude(box.east),
          },
          { signal: controller.signal },
        )
        .then((data) => {
          if (cancelled) return;
          fetched = whole ? { ...box, west: -Infinity, east: Infinity, zoom } : { ...box, zoom };
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

    // The window as it now stands, for the count of what is in it: the items
    // held reach past it.
    function look() {
      const bounds = map.getBounds();
      setViewBox({ south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() });
    }

    function settle() {
      window.clearTimeout(timer);
      timer = window.setTimeout(ask, SETTLE_MS);
      look();
      const center = map.getCenter().wrap();
      saveView({ latitude: center.lat, longitude: center.lng, zoom: map.getZoom() });
    }

    // The style comes with fog, which nobody sees on a map that never tilts —
    // but while it is there the map works out how far into it each pin
    // stands, every one of them, after every move. Taken off whenever the
    // style is (re)loaded.
    map.on("style.load", () => map.setFog(null));
    map.on("load", () => {
      look();
      ask();
    });
    map.on("move", () => cullPins(map, markersRef.current));
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
      if (here) fly({ ...here, zoom: DEFAULT_ZOOM });
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
          if (here) map.jumpTo({ center: [here.longitude, here.latitude], zoom: DEFAULT_ZOOM });
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
        // Attached by cullPins below, and only while it is near the window.
        const marker = new mapboxgl.Marker({ element, anchor: "bottom" }).setLngLat([item.longitude, item.latitude]);
        entry = { marker, element, attached: false };
        markers.set(item.id, entry);
      }
      entry.item = item;
      entry.marker.setLngLat([item.longitude, item.latitude]);
      entry.element.setAttribute("aria-label", item.title);
      // What category it is, said in the pin's head. Written only when it
      // has changed, so a drag that keeps a pin does not redraw it.
      const mark = markOf(item) ?? "";
      if (entry.mark !== mark) {
        entry.element.querySelector(`.${styles.glyph}`).innerHTML = iconMarkup(mark);
        entry.mark = mark;
      }
      const photo = item.pin ?? item.thumb;
      setPinPhoto(entry.element, photo);
      setPinLabel(entry.element, item.kind === "request" && !photo ? item.title : "");
    }
    cullPins(map, markers);
    // `shown` is derived afresh each render; what it is derived from is what
    // is watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, category, group, query]);

  useEffect(() => {
    for (const [id, entry] of markersRef.current) {
      entry.element.classList.toggle(styles.pinChosen, id === selectedId);
      entry.element.classList.toggle(styles.pinPointed, id === pointedId);
    }
  }, [selectedId, pointedId, items, category, group, query]);

  // The item being looked at on a sheet over the list, by its id, and the row
  // it was opened from — which is given the keyboard back when the sheet is
  // put away, so the arrows carry on from where they were.
  const [previewId, setPreviewId] = useState(null);
  const lookedFrom = useRef(null);
  const look = (item, from) => {
    if (item.kind === "request") {
      setViewing(item);
      return;
    }
    lookedFrom.current = from ?? null;
    setPreviewId(item.id);
  };
  const lookAway = () => {
    setPreviewId(null);
    lookedFrom.current?.focus?.();
  };
  // The bubble's View, and the rest of it that is the same link: the item on
  // the sheet, over the map, rather than its page — its page being one press
  // further, from the sheet. A press meant for a new tab or window is left to
  // be one, to the page.
  const preview = (item, event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    look(item, null);
  };

  // A row picked with the keys or the wheel, rather than with the pointer: it
  // is given the keyboard, and is from then on the one row marked — the row
  // the pointer happens to be lying on is no longer marked for that (see
  // data-keyed in the styles) until the pointer is moved again. Beside the
  // map the row picked is the item chosen on it as well: the map goes to its
  // pin and puts its bubble up, or puts the bubble away for one with no pin.

  // The columns drawn sideways until `row` stands whole inside the frame,
  // a little of the way left to go at every frame. Asked again before they
  // are there — the wheel spun fast, a column a notch — the way is only made
  // longer, and they carry on at the speed they had: the browser's own smooth
  // scrolling starts slow again each time it is asked, and a fast wheel reads
  // as a stutter of starts.
  const glide = useRef({ target: null, frame: 0 });
  const glideTo = (list, row) => {
    // A drag's glide gives way to the row picked.
    cancelAnimationFrame(swipe.current.coast);
    swipe.current.coast = 0;
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
  // And so is a glide left over from a drag let go (see the swipe).
  const stopGlide = () => {
    cancelAnimationFrame(glide.current.frame);
    glide.current.frame = 0;
    cancelAnimationFrame(swipe.current.coast);
    swipe.current.coast = 0;
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
    let at = listed.findIndex((item) => item.id === tileChosen.current);
    if (at >= 0 && !fresh) return;
    if (at < 0) at = 0;
    // Drawn already, as far as the row picked (see drawn).
    const row = list.children[at];
    if (!row) return;
    laidOut.current = list;
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
    // Near the last row drawn, more are drawn, for the next step to go to.
    drawTo([...list.children].indexOf(row));
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

  // The columns drawn sideways by dragging them with the mouse, as a finger
  // draws them on a screen (which the browser does by itself). A row that can
  // be carried to a category is picked up only once it has been held still a
  // moment; a drag begun at once draws the columns. A drag that drew them is
  // not a press on the row it ends over.
  useEffect(() => {
    const list = tileRows.current;
    const state = swipe.current;
    // Heard on the list itself, once for each list drawn; the gesture is
    // followed on the window, so a page drawn again in the middle of one does
    // not cut it short.
    if (!list || state.bound === list) return;
    state.bound = list;
    let start = null;
    let row = null;
    let timer = 0;
    let moved = false;
    let swallow = false;
    // Where the mouse has been over the last moments, for how fast the
    // columns were going when let go; and the frame the next position is
    // written at, so a mouse that reports many times a frame moves them once.
    let trail = [];
    let frame = 0;
    let at = 0;
    const cover = document.createElement("div");
    cover.className = styles.swipeCover;
    const letGo = () => {
      window.clearTimeout(timer);
      if (row) delete row.dataset.held;
    };
    const move = (event) => {
      if (!start || state.held) return;
      const dx = event.clientX - start.x;
      if (!moved) {
        if (Math.hypot(dx, event.clientY - start.y) < 4) return;
        moved = true;
        letGo();
        stopGlide();
        document.body.append(cover);
        window.getSelection()?.removeAllRanges();
      }
      at = start.left - dx;
      trail.push({ time: event.timeStamp, x: event.clientX });
      while (trail.length > 2 && event.timeStamp - trail[0].time > 100) trail.shift();
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          list.scrollLeft = at;
        });
      }
    };
    // Let go while moving, the columns carry on the way they were going and
    // slow to a stop, as they do under a finger.
    const coast = (speed) => {
      let last = performance.now();
      const step = (now) => {
        const elapsed = Math.min(now - last, 50);
        last = now;
        const before = list.scrollLeft;
        list.scrollLeft = before - speed * elapsed;
        speed *= 0.95 ** (elapsed / 16);
        if (Math.abs(speed) < 0.02 || list.scrollLeft === before) {
          state.coast = 0;
          return;
        }
        state.coast = requestAnimationFrame(step);
      };
      state.coast = requestAnimationFrame(step);
    };
    const up = (event) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      letGo();
      cover.remove();
      if (moved) {
        swallow = true;
        cancelAnimationFrame(frame);
        frame = 0;
        list.scrollLeft = at;
        // How fast, over the last tenth of a second — nothing if the mouse
        // was held still before it was let go.
        const first = trail[0];
        const last = trail[trail.length - 1];
        const span = last && last.time - first.time;
        if (span > 0 && event.timeStamp - last.time < 60) {
          const speed = (last.x - first.x) / span;
          if (Math.abs(speed) > 0.1) coast(speed);
        }
      }
      trail = [];
      start = null;
    };
    list.addEventListener("mousedown", (event) => {
      swallow = false;
      cancelAnimationFrame(state.coast);
      state.coast = 0;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const under = event.target.closest?.("li");
      row = under?.parentElement === list ? under : null;
      start = { x: event.clientX, y: event.clientY, left: list.scrollLeft };
      moved = false;
      state.held = false;
      window.clearTimeout(timer);
      if (row?.draggable) {
        const held = row;
        timer = window.setTimeout(() => {
          state.held = true;
          held.dataset.held = "";
        }, HOLD_MS);
      }
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
    list.addEventListener(
      "click",
      (event) => {
        if (!swallow) return;
        swallow = false;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
    // Carried and put down: the mouse's own let-go is not heard meanwhile.
    list.addEventListener("dragend", () => {
      letGo();
      state.held = false;
      start = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    });
  });

  // The list beside the map is not picked among by the wheel: it is a list
  // that scrolls up and down itself, and the wheel over it scrolls it.

  // A row of the list pressed, for an item that stands on the map: the first
  // press goes to its pin — the map moves there and its bubble is put up — and
  // keeps the row from going to the item's page; pressed again, with its
  // bubble up, the row opens the item on a sheet over the list (see
  // ItemPreview), from which its page is one press further. An item with no
  // pin has nowhere on the map to go to, and its row opens the sheet at once.
  //
  // As lists there is no map to go to: those rows open the sheet too. As lists the
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
    if (listing || !item.located || selectedId === item.id) {
      event.preventDefault();
      look(item, event.currentTarget);
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    event.preventDefault();
    touchedRef.current = true;
    setSelectedId(item.id);
    map.flyTo({ center: [item.longitude, item.latitude], zoom: Math.max(map.getZoom(), 14), duration: 800 });
  };

  // The bubble over the pin being looked at. One popup, moved rather than remade; what
  // is in it is drawn by React through the portal below. Put up before the
  // page is painted, so it comes in the same frame as the press.
  useLayoutEffect(() => {
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
      }).setDOMContent(bubbleNode(popupNode));
    }
    popupRef.current.setLngLat([open.longitude, open.latitude]).addTo(map);
    // The map puts its bubbles beside the ground rather than on it, where a
    // drag that starts on one moves nothing. Set on the ground with the pins,
    // a drag over the bubble moves the map as a drag over a pin does. Made
    // afresh at every addTo, so moved at every one.
    const element = popupRef.current.getElement();
    if (element && element.parentNode !== map.getCanvasContainer()) map.getCanvasContainer().append(element);
  }, [open, popupNode]);

  // Shown again after standing out of sight under an item's page (see App):
  // the map measures its box afresh, which was nothing while it was hidden.
  useEffect(() => {
    if (!active) return undefined;
    const frame = requestAnimationFrame(() => mapRef.current?.resize());
    return () => cancelAnimationFrame(frame);
  }, [active]);

  /* -------------------------------------------------------------- the tools */

  async function goToMe() {
    const here = await locate({ timeout: 12000 });
    if (here) {
      touchedRef.current = true;
      // Only moved there, at the scale it is at — unless that takes in more
      // than the map opens on, which is then the scale it comes to.
      const now = mapRef.current?.getZoom() ?? DEFAULT_ZOOM;
      fly({ latitude: here.latitude, longitude: here.longitude, zoom: Math.max(now, DEFAULT_ZOOM) });
    } else {
      setGate(locateFailure() ?? "failed");
    }
  }

  async function allow() {
    setGate("locating");
    const here = await locate({ timeout: 15000 });
    if (here) {
      touchedRef.current = true;
      fly({ ...here, zoom: DEFAULT_ZOOM });
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

  // The list beside the map, drawn again only when what is listed or the item
  // chosen changes. Every move of the map ends by redrawing the page (the
  // count in the corner), and a fetch of pins does too; redrawing thousands
  // of rows each time is the stutter felt when the map is caught mid-glide
  // and dragged again. What the rows do is looked up when they do it, so a
  // list kept from an earlier drawing still does what this one would.
  const latest = useRef(null);
  latest.current = { pressRow, rowKeys, unkey };
  // The row of the item chosen is marked a moment after the bubble is up,
  // not with it: a pin pressed puts its bubble up at once, and the list
  // catches up behind it.
  const listChosenId = useDeferredValue(selectedId);
  // A pin chosen whose row is further on than the list is drawn: drawn to it,
  // for the row to be marked.
  useEffect(() => {
    if (!listChosenId || !listed) return;
    const at = listed.findIndex((item) => item.id === listChosenId);
    if (at >= 0) drawTo(at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listChosenId, listed]);
  // More rows while the list showing does not yet reach two of its frames past
  // what is in view — on a tall or wide screen the first few hundred may not.
  const sideScroller = useRef(null);
  useEffect(() => {
    if (listing) drawMore(tileRows.current, true);
    else drawMore(sideScroller.current, false);
  });
  const sideList = useMemo(
    () =>
      drawnRows?.length > 0 && (
        <ul
          ref={sideRows}
          className="row-list"
          onKeyDown={(event) => latest.current.rowKeys(event)}
          onMouseMove={(event) => latest.current.unkey(event)}
        >
          {drawnRows.map((item) => (
            <SideRow
              key={item.id}
              item={item}
              pin
              chosen={item.id === listChosenId}
              onPress={(event) => latest.current.pressRow(item, event)}
              onPoint={item.located ? (on) => setPointedId((current) => (on ? item.id : current === item.id ? null : current)) : undefined}
            />
          ))}
        </ul>
      ),
    [drawnRows, listChosenId],
  );

  // What is shown: what is offered, or what people need.
  const kindSwitch = (
    <div className={styles.kinds} role="group" aria-label={t("map.kind")}>
      {["offers", "requests"].map((each) => (
        <button
          key={each}
          type="button"
          className={kind === each ? styles.kindOn : styles.kind}
          aria-pressed={kind === each}
          onClick={() => setKind(each)}
        >
          {t(`map.kinds.${each}`)}
        </button>
      ))}
    </div>
  );

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
          {/* The name, and at its right what is shown under it and on the
              map: what is offered, or what people need. */}
          <div className={styles.areaTop}>
            <h1 className={styles.areaName}>
              {area === undefined ? <span className={styles.pending} aria-hidden="true" /> : area?.name || t("map.areaUnknown")}
            </h1>
            {kindSwitch}
          </div>
          {/* The line stands whether or not there is anything on it, so the
              list under it does not jump when the name arrives. */}
          <p className={styles.areaWithin}>
            {/* As lo's strip has it: the ward, then the prefecture. */}
            <span>{[area?.locality, area?.within].filter(Boolean).join(" · ")}</span>
            {/* At its right, how much is offered here: the items — on the
                spots, and the ones on none — and the spots they are at, one
                to a row of the list. */}
            {listed && (
              <span>
                {/* Requests are counted as what they are: there are no items
                    or spots among them. */}
                {requesting
                  ? t("map.requestTotals", { count: listed.length })
                  : t("map.areaTotals", {
                      items: listed.reduce((sum, item) => sum + (item.spot ? (item.count ?? 0) : 1), 0).toLocaleString(i18n.language),
                      spots: listed.length.toLocaleString(i18n.language),
                    })}
              </span>
            )}
          </p>
        </header>
        {/* The box that narrows the list: in the top bar where there is room
            (see Header), and here on a phone. */}
        <FilterBox slash className={styles.sideFilter} value={query} onChange={onQuery} placeholder={t("search.placeholder")} />
        {/* As lists, the column is what narrows them: the categories. */}
        {listing && (
          <div className={styles.categoryRow} role="group" aria-label={t("item.category")}>
            {/* On a phone the list of categories is put away, and the
                category is picked from the dropdown the map has instead —
                after the theme, which narrows what it has to pick from. */}
            {groupSelect}
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
        {/* The themes, as rows under their name: the one pressed is the one
            the categories under them are narrowed to. */}
        {listing && <h3 className={styles.sideLabel}>{t("group.label")}</h3>}
        {listing && (
          <ul className={styles.groups} aria-label={t("group.label")}>
            {/* At their head, none of them: every category to pick from. */}
            {["", ...themes].map((theme) => (
              <li key={theme}>
                <button
                  type="button"
                  className={[styles.choice, group === theme && styles.choiceChosen].filter(Boolean).join(" ")}
                  aria-pressed={group === theme}
                  onClick={() => group !== theme && setGroup(theme)}
                >
                  <span className={styles.categoryName}>
                    <CategoryIcon group={theme} />
                    {theme ? t(`group.${theme}`) : t("group.none")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {listing && <h3 className={styles.sideLabel}>{t("item.category")}</h3>}
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
        <div ref={sideScroller} className={styles.sideList} hidden={listing} onScroll={(event) => drawMore(event.currentTarget, false)}>
          {/* A search that found nothing says so. An area with nothing in
              it says so too, and asks for the first thing: the way to put
              one out, here where it is missing. */}
          {listed?.length === 0 &&
            (words.length > 0 ? (
              <p className={styles.sideEmpty}>{t("search.empty")}</p>
            ) : (
              <div className={styles.sideEmpty}>
                <p>{t(requesting ? "map.requestsEmpty" : "map.areaEmpty")}</p>
                {!requesting && <p>{t("map.areaEmptyAsk")}</p>}
                <button type="button" className="small-button" onClick={() => window.dispatchEvent(new Event(requesting ? NEED_EVENT : LIST_EVENT))}>
                  {t(requesting ? "header.need" : "header.list")}
                </button>
              </div>
            ))}
          {sideList}
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
            onScroll={(event) => drawMore(event.currentTarget, true)}
          >
            {drawnRows.map((item) => (
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
                <p>{t(requesting ? "map.requestsEmpty" : "map.areaEmpty")}</p>
                {!requesting && <p>{t("map.areaEmptyAsk")}</p>}
                <button type="button" className="small-button" onClick={() => window.dispatchEvent(new Event(requesting ? NEED_EVENT : LIST_EVENT))}>
                  {t(requesting ? "header.need" : "header.list")}
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
          {/* First the theme, which narrows what the categories' dropdown
              has to pick from. */}
          {groupSelect}
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
            {failed && !requesting
              ? t("map.failed")
              : inWindow === 0
                ? t(requesting ? "map.requestsNone" : "map.empty")
                : t(requesting ? "map.requestCount" : "map.count", { count: inWindow })}
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
              <Link className={styles.cardBody} to={itemPath(open)} draggable={false} onClick={(event) => preview(open, event)}>
                {open.thumb && <img className={styles.cardPhoto} src={open.thumb} alt="" draggable={false} />}
                <strong className={styles.cardTitle}>{open.title}</strong>
                {open.what && <span className={styles.cardMeta}>{open.what}</span>}
                {/* What its owner wrote about it, as lo's Wikipedia bubble gives
                    an article's lead: the first three lines, the rest being what
                    the page is for. */}
                {open.description && <span className={styles.cardLead}>{open.description}</span>}
                {/* A request says more here than an item does, having no page
                    of its own to say it on: what would be paid and when. The
                    pin already says where, and Contact how to reach its maker. */}
                {open.kind === "request" ? (
                  <span className={styles.cardFacts}>
                    {[
                      [t("request.budget"), open.budget != null ? requestBudget(open, lang, t) : t("request.budgetOpenShort")],
                      [t("request.when"), requestDates(open, lang) || t("request.anyTime")],
                      open.region?.name && [t("request.region"), open.region.name],
                    ]
                      .filter(Boolean)
                      .map(([label, value], index) => (
                        // The facts are in a fixed order and have no other identity.
                        // eslint-disable-next-line react/no-array-index-key
                        <span key={index} className={styles.cardFact}>
                          <span>{label}</span>
                          <span>{value}</span>
                        </span>
                      ))}
                  </span>
                ) : (
                  !open.spot && <span className={styles.cardPrice}>{priceLine(open, lang, t)}</span>
                )}
                <span className={styles.cardMeta}>
                  {/* No address: at the bubble's width it is cut off long
                      before it says anything. It is on the item's page. */}
                  {/* Beside what a spot is of, how many things are on it. */}
                  {dotted([
                    sortLabel(open, t),
                    open.spot && t("spot.count", { count: open.count ?? 0 }),
                    open.owner && <UserName name={open.owner} inside />,
                    open.kind === "request" && open.anonymous && !open.owner && t("request.anonymousName"),
                  ])}
                </span>
              </Link>
              {/* The two things to do about it, as lo's bubbles say theirs: small
                  grey underlined words at the foot, not boxes. Read its page, or
                  go straight to asking for it — the same page, opened on its
                  calendar. Nobody
                  asks to rent their own, so on those there is only the one. */}
              <span className={styles.cardActions}>
                {/* First, at the left, as lo's bubbles have it: the way there,
                    handed to Google Maps — the question a pin raises before
                    any other. */}
                {open.located && (
                  <a className={styles.cardLink} {...directionsLink(open)} draggable={false}>
                    {t("map.nav")}
                  </a>
                )}
                {/* Then the way to look at it: an item's sheet, or a
                    request's. */}
                <Link className={styles.cardLink} to={itemPath(open)} draggable={false} onClick={(event) => preview(open, event)}>
                  {t("map.open")}
                </Link>
                {/* A request is answered by the way its maker wrote first: a
                    phone number is called and an address written to,
                    straight from here; a message here — or a way that cannot
                    be pressed — is a message, written in the inbox. Nobody
                    answers their own. */}
                {open.kind === "request" &&
                  !isMine(open) &&
                  (contactHref(open.contacts?.[0], open.title) ? (
                    <a className={styles.cardLink} href={contactHref(open.contacts[0], open.title)} draggable={false}>
                      {t("request.contact")}
                    </a>
                  ) : (
                    (open.owner || open.anonymous) && (
                      <button type="button" className={`${styles.cardLink} ${styles.cardButton}`} onClick={() => (user ? setWritingAbout(open) : navigate(loginPath()))}>
                        {t("request.contact")}
                      </button>
                    )
                  ))}
                {open.kind !== "request" && open.owner !== user?.username &&
                  // Something booked by asking is asked for the way its
                  // owner said first: a phone number is called and an
                  // email address is written to, straight from here. Any
                  // other goes to the page, on its calendar or its address.
                  (open.mode === "inquiry" && contactHref(open.contacts?.[0], open.title) ? (
                    <a className={styles.cardLink} href={contactHref(open.contacts[0], open.title)} draggable={false}>
                      {t("map.request")}
                    </a>
                  ) : (
                    <Link className={styles.cardLink} to={`${itemPath(open)}?book=1`} draggable={false}>
                      {t("map.request")}
                    </Link>
                  ))}
                {/* Its maker's own way to change it, apart at the right. */}
                {isMine(open) && (
                  <button type="button" className={`${styles.cardLink} ${styles.cardEdit}`} onClick={() => edit(open)}>
                    {t("map.edit")}
                  </button>
                )}
              </span>
            </div>,
            popupNode,
          )}
      </section>

      {/* An item opened from its row, on a sheet over the list. */}
      <ItemPreview
        id={previewId}
        onClose={lookAway}
        // Saved from the form opened on the sheet: the sheet again.
        onOpen={setPreviewId}
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

      {/* Changed from its bubble: the request as saved takes the old one's
          place among the pins and in the list. */}
      <RequestModal
        isOpen={Boolean(editingRequest)}
        request={editingRequest}
        onClose={() => setEditingRequest(null)}
        onSaved={(saved) => {
          setEditingRequest(null);
          setRequests((current) => current?.map((request) => (request.id === saved.id ? saved : request)) ?? current);
        }}
      />
      {editingItem && (
        <ItemModal
          isOpen
          item={editingItem.item}
          calendar={editingItem.calendar}
          onClose={() => setEditingItem(null)}
          onSaved={(item, spot) => {
            const id = editingItem.item.id;
            const saved = [item, spot].find((each) => each?.id === id);
            setEditingItem(null);
            if (!saved) return;
            const renew = (list) => list?.map((each) => (each.id === id ? { ...each, ...saved } : each)) ?? list;
            setOffered(renew);
            setItems(renew);
            setFound(renew);
          }}
        />
      )}

      {/* Written to from a request's card: the inbox, on the exchange with
          its maker — by way of the request, where it was asked without a
          name — headed by a line that leads to the request. */}
      <MessageModal
        username={writingAbout ? (writingAbout.anonymous ? `~${writingAbout.id}` : writingAbout.owner) : null}
        about={writingAbout?.id ?? null}
        aboutTitle={writingAbout?.title ?? ""}
        onClose={() => setWritingAbout(null)}
      />

      {/* A request opened from its pin or its row, on a sheet over the map. */}
      <RequestView
        request={viewing}
        onClose={() => setViewing(null)}
        // Changed from its sheet: the sheet is put away and the form opened.
        onEdit={(request) => {
          setViewing(null);
          setEditingRequest(request);
        }}
        onGone={(gone) => {
          setRequests((current) => current?.filter((request) => request.id !== gone) ?? current);
          setSelectedId((current) => (current === gone ? null : current));
          setViewing(null);
        }}
      />
    </div>
  );
}
