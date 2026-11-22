import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import * as api from "../../api.js";
import { Link, Select } from "../../ui/index.js";
import { iconMarkup } from "../../utils/categoryIcons.js";
import { priceLine } from "../../utils/format.js";
import { CATEGORIES, KINDS } from "../../utils/kinds.js";
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
  saveView,
  savedView,
} from "../../utils/mapbox.js";
import { currentRegion, loadRegion, onTravel, takeJourney } from "../../utils/region.js";
import { MapTools } from "../MapParts/index.js";
import { ItemRow } from "../Rows/index.js";
import { useAuth } from "../AuthProvider/index.js";
import CategoryIcon from "../CategoryIcon/index.js";
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
export default function MapView() {
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
  const leaveRef = useRef(null);
  const [kind, setKind] = useState(null);
  // The question about location, while it is being asked: "ask" before the
  // reader has answered, "locating" while the browser does, and afterwards why
  // it came to nothing: "denied", "failed" or "insecure" (see locateFailure).
  const [gate, setGate] = useState(null);
  const lang = i18n.language;
  // The middle of the map, once it has stopped: the spot the panel beside it is
  // about.
  const [spot, setSpot] = useState(null);
  // What that spot's area is called and the ground it covers — { name, within,
  // bbox } — or null where it has no name, and undefined until the first
  // answer.
  const [area, setArea] = useState(undefined);
  // Everything offered there: the items whose area has the spot inside it,
  // whether or not they have a pin. Null until the first answer.
  const [offered, setOffered] = useState(null);

  // What is being looked for, typed over the list: a filter on what is already
  // here — the list and the pins alike — rather than a search somewhere else.
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Which category the pins are for, within the kind in force: "" is all of
  // them. The choices are that kind's categories, or every kind's where no
  // kind is chosen ("other" is in all three, and is listed once).
  const [category, setCategory] = useState("");
  const categoryChoices = [...new Set((kind ? [kind] : KINDS).flatMap((each) => CATEGORIES[each]))];
  // Each one leads with its own mark, the one its pins wear on the map — and
  // the kind's mark where the category has none of its own. `text` is what
  // the search reads, since the label is no longer a plain string.
  const withIcon = (slug, name) => (
    <span className={styles.categoryName}>
      <CategoryIcon kind={kind} category={slug} />
      {name}
    </span>
  );
  const categoryOptions = [
    { value: "", label: withIcon("", t("map.allCategories")), text: t("map.allCategories") },
    ...categoryChoices.map((slug) => ({
      value: slug,
      label: withIcon(slug, t(`category.${slug}`)),
      text: `${t(`category.${slug}`)} ${slug}`,
    })),
  ];
  // A category belongs to a kind: one the newly chosen kind does not have is
  // let go of rather than left filtering everything out.
  const chooseKind = (next) => {
    setKind(next);
    if (next && category && !CATEGORIES[next].includes(category)) setCategory("");
  };
  // An item passes when it is of the kind and the category in force and every
  // word typed is somewhere in what it says about itself.
  const passes = (item) => {
    if (kind && item.kind !== kind) return false;
    if (category && item.category !== category) return false;
    if (words.length === 0) return true;
    const text = [item.title, item.description, item.place, item.owner, t(`kind.${item.kind}`)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  };
  const filtering = Boolean(kind || category || words.length);
  const shown = filtering ? items.filter(passes) : items;
  const listed = offered && (filtering ? offered.filter(passes) : offered);
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
    const journey = takeJourney();
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
    const sized = new ResizeObserver(() => map.resize());
    sized.observe(containerRef.current);

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

    // Where the map is looking, to about a hundred metres: a nudge that leaves
    // it in the same place does not ask about the place again.
    function mark() {
      const center = map.getCenter().wrap();
      const latitude = Math.round(center.lat * 1000) / 1000;
      const longitude = Math.round(center.lng * 1000) / 1000;
      setSpot((current) =>
        current?.latitude === latitude && current?.longitude === longitude ? current : { latitude, longitude },
      );
    }

    function settle() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        ask();
        mark();
      }, SETTLE_MS);
      const center = map.getCenter().wrap();
      saveView({ latitude: center.lat, longitude: center.lng, zoom: map.getZoom() });
    }

    map.on("load", () => {
      ask();
      mark();
    });
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
      map.once("load", goHome);
    } else if (journey) {
      // Somewhere picked with the plane before the map was on screen.
      touchedRef.current = true;
      map.once("load", () => fly(journey, { animate: false }));
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

  // What the spot in the middle of the map is called, in the reader's language.
  useEffect(() => {
    if (!spot) return undefined;
    const controller = new AbortController();
    areaAt(spot.latitude, spot.longitude, lang, controller.signal)
      .then((found) => setArea(found ? { name: found.name, locality: found.locality, within: found.within, bbox: found.bbox } : null))
      .catch((error) => {
        if (error?.name !== "AbortError") setArea(null);
      });
    return () => controller.abort();
  }, [spot, lang]);

  // And everything offered there: asked once the area is known, since the
  // items standing inside it are part of the answer.
  const box = area?.bbox?.join(",") ?? "";
  useEffect(() => {
    if (!spot || area === undefined) return undefined;
    const controller = new AbortController();
    api
      .getItemsAt(spot, area?.bbox ?? null, { signal: controller.signal })
      .then((data) => setOffered(data.items ?? []))
      .catch((error) => {
        if (error?.name !== "AbortError") setOffered([]);
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
      // What kind of thing it is, said in the pin's head. Written only when it
      // has changed, so a drag that keeps a pin does not redraw it.
      const mark = `${item.kind}/${item.category}`;
      if (entry.mark !== mark) {
        entry.element.querySelector(`.${styles.glyph}`).innerHTML = iconMarkup(item.kind, item.category);
        entry.mark = mark;
      }
      setPinPhoto(entry.element, item.thumb);
    }
    // `shown` is derived afresh each render; what it is derived from is what
    // is watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, kind, category, query]);

  useEffect(() => {
    for (const [id, entry] of markersRef.current) {
      entry.element.classList.toggle(styles.pinChosen, id === selectedId);
    }
  }, [selectedId, items, kind, category, query]);

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
    <div className={styles.layout}>
      {/* Beside the map, what it is looking at: the name of the area in its
          middle, and under it everything offered there — the items with pins
          and the ones without. */}
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
        {/* Over the list, the box that narrows it: what is typed here is looked
            for in the items already on the page. */}
        <div className={styles.filter} role="search">
          <svg className={styles.filterGlass} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6" />
            <path d="m20 20-4.5-4.5" />
          </svg>
          <input
            className={styles.filterInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.stopPropagation();
                setQuery("");
              }
            }}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button type="button" className={styles.filterClear} onClick={() => setQuery("")} aria-label={t("map.searchClear")}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>
        <div className={styles.sideList}>
          {listed?.length === 0 && <p className={styles.sideEmpty}>{words.length ? t("search.empty") : t("map.areaEmpty")}</p>}
          {listed?.length > 0 && (
            <ul className="row-list">
              {listed.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className={`${styles.frame} map-frame`} aria-label={t("map.title")}>
        <div ref={containerRef} className={styles.container} />

        <MapTools
          onZoomIn={() => mapRef.current?.zoomIn()}
          onZoomOut={() => mapRef.current?.zoomOut()}
          onLocate={goToMe}
        />

        {/* Which kind of thing the pins are for: all of them, or one of the
            three. */}
        <div className={styles.kinds} role="group" aria-label={t("item.kind")}>
          {[null, ...KINDS].map((each) => (
            <button
              key={each ?? "all"}
              type="button"
              className={kind === each ? `${styles.kind} ${styles.kindChosen}` : styles.kind}
              aria-pressed={kind === each}
              onClick={() => chooseKind(each)}
            >
              {/* Each kind leads with its own mark; "all" is no kind and has none. */}
              {each && <CategoryIcon kind={each} />}
              {each ? t(`kind.${each}`) : t("kind.all")}
            </button>
          ))}
          {/* And which category within it: all of them unless one is picked. */}
          <Select
            className={styles.category}
            fit
            label={t("item.category")}
            value={category}
            onChange={setCategory}
            options={categoryOptions}
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
                {/* What its owner wrote about it, as lo's Wikipedia bubble gives
                    an article's lead: the first three lines, the rest being what
                    the page is for. */}
                {open.description && <span className={styles.cardLead}>{open.description}</span>}
                <span className={styles.cardPrice}>{priceLine(open, lang, t)}</span>
                <span className={styles.cardMeta}>
                  {dotted([t(`kind.${open.kind}`), open.place, open.owner && <UserName name={open.owner} inside />])}
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
                {open.owner !== user?.username && (
                  <Link className={styles.cardLink} to={`/i/${open.id}?book=1`}>
                    {t("map.request")}
                  </Link>
                )}
              </span>
            </div>,
            popupNode,
          )}
      </section>
    </div>
  );
}
