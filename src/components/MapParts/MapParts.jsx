import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "../../ui/index.js";
import mapboxgl from "mapbox-gl";
import { geocode, onPosition } from "../../utils/mapbox.js";
import { loadRegion, useRegion } from "../../utils/region.js";
import styles from "./parts.module.css";

const SEARCH_DELAY_MS = 350;

// The reader's own position on a map: a dot, where the browser says they are,
// moved as they move. Drawn only where the position is already to be had or
// comes to be (see onPosition) — the dot itself asks nobody anything. It is
// not something to press, and stands under the pins. Returns the way to take
// it off again.
export function showSelf(map) {
  const element = document.createElement("span");
  element.className = styles.self;
  element.setAttribute("aria-hidden", "true");
  const marker = new mapboxgl.Marker({ element, anchor: "center" });
  let placed = false;
  const stop = onPosition((spot) => {
    marker.setLngLat([spot.longitude, spot.latitude]);
    if (!placed) {
      marker.addTo(map);
      placed = true;
    }
  });
  return () => {
    stop();
    marker.remove();
  };
}

// The place search that stands in the top left of a map: a glass to say what it
// is, the field, and the cross that empties it once there is something in it. It looks inside the country the reader is taken to be in (see
// utils/region.js) — a street name typed in Tokyo should not come back as a
// town in Brazil — and the plane in the top bar is the way to anywhere else.
//
// `near` is asked for at the moment of searching, so the answers lean towards
// wherever the map happens to be looking.
export function MapSearch({ onPick, near }) {
  const { t, i18n } = useTranslation();
  const { country } = useRegion();
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState(null);
  const lang = i18n.language;

  useEffect(() => {
    loadRegion();
  }, []);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setPlaces(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      geocode(text, { lang, country, near: near?.() ?? null, signal: controller.signal })
        .then((found) => setPlaces({ list: found }))
        .catch((error) => {
          if (error?.name !== "AbortError") setPlaces({ error: t("map.searchFailed") });
        });
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `near` is read when the search runs, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, lang, country, t]);

  function clear() {
    setQuery("");
    setPlaces(null);
  }

  function choose(place) {
    clear();
    onPick(place);
  }

  return (
    // Not a <form>: one of these stands inside the item form, and a form
    // cannot hold another. Enter is read off the field instead.
    <div className={styles.search} role="search">
      <div className={styles.field}>
        {/* A mark that says what the field is for, not a control: Enter goes
            to the first answer, and the answers are pressed themselves. */}
        <svg className={styles.glass} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-4.5-4.5" />
        </svg>
        <input
          className={styles.input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") {
              event.preventDefault();
              if (places?.list?.[0]) choose(places.list[0]);
            } else if (event.key === "Escape" && query) {
              event.stopPropagation();
              clear();
            }
          }}
          placeholder={t("map.search")}
          aria-label={t("map.search")}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query && (
          <button type="button" className={styles.clear} onClick={clear} aria-label={t("map.searchClear")}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
      {places && (
        <ul className={styles.results}>
          {places.error && <li className={styles.note}>{places.error}</li>}
          {places.list?.length === 0 && <li className={styles.note}>{t("map.searchEmpty")}</li>}
          {places.list?.map((place) => (
            <li key={place.id}>
              <button type="button" className={styles.result} onClick={() => choose(place)}>
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

// The three buttons down the top right of a map: nearer, further, and where
// the reader is.
export function MapTools({ onZoomIn, onZoomOut, onLocate }) {
  const { t } = useTranslation();
  return (
    <div className={styles.tools}>
      <ActionButton tooltip={t("map.zoomIn")} tooltipBeside onClick={onZoomIn}>
        <svg viewBox="0 0 24 24">
          <path d="M12 6v12" />
          <path d="M6 12h12" />
        </svg>
      </ActionButton>
      <ActionButton tooltip={t("map.zoomOut")} tooltipBeside onClick={onZoomOut}>
        <svg viewBox="0 0 24 24">
          <path d="M6 12h12" />
        </svg>
      </ActionButton>
      <ActionButton tooltip={t("map.locate")} tooltipBeside onClick={onLocate}>
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="6" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </ActionButton>
    </div>
  );
}
