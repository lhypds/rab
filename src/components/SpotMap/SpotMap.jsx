import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { formatCoords } from "../../utils/format.js";
import { MAPBOX_TOKEN, MAP_STYLE, PIN_PATH, locate, mapLanguage } from "../../utils/mapbox.js";
import { MapSearch, MapTools, showSelf } from "../MapParts/index.js";
import styles from "./spot.module.css";

function Pin() {
  return (
    <svg viewBox="0 0 24 21.6" aria-hidden="true">
      <path d={PIN_PATH} />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

// A small map about one spot, in two uses that are the same drawing.
//
// With `onMove` it is how a spot is chosen: the pin is dragged to it, or the
// map is pressed where it should stand, and `onMove` is told where it landed.
// Without, it is how a spot is shown: the same pin on the same ground, standing
// still.
//
// `target` is somewhere to go to on request — a new object each time, so asking
// for the same place twice still moves the map.
export default function SpotMap({ latitude, longitude, zoom = 14, onMove, target = null }) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const moved = useRef(onMove);
  moved.current = onMove;
  const picking = Boolean(onMove);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return undefined;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [longitude, latitude],
      zoom,
      language: mapLanguage(i18n.language),
      attributionControl: false,
      // A map that is only showing a spot does not take the page's scroll.
      interactive: picking,
      // The picker is zoomed by the wheel like any map, as well as by its
      // buttons, a pinch and a double click — though it sits in a form that
      // scrolls, and a wheel turned over it no longer scrolls the form.
      scrollZoom: picking,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    // Redrawn to its box whenever the box changes size, not only the window.
    const sized = new ResizeObserver(() => map.resize());
    sized.observe(containerRef.current);
    if (picking) {
      map.touchZoomRotate.disableRotation();
      // The pin is the thing being placed, so it is the thing that is moved:
      // picked up and dragged, or sent to wherever the map is pressed. The
      // ground under it pans and zooms without taking the pin along.
      const element = document.createElement("span");
      element.className = styles.marker;
      element.innerHTML = `<svg viewBox="0 0 24 21.6" aria-hidden="true"><path d="${PIN_PATH}"/><circle cx="12" cy="10" r="2.5"/></svg>`;
      // Where the pin stands, in numbers, hung under its point: it goes where
      // the pin goes, and says the new place while the pin is still in the hand.
      const coords = document.createElement("span");
      coords.className = styles.coords;
      element.appendChild(coords);
      const marker = new mapboxgl.Marker({ element, draggable: true, anchor: "bottom" })
        .setLngLat([longitude, latitude])
        .addTo(map);
      const label = () => {
        const spot = marker.getLngLat().wrap();
        coords.textContent = formatCoords(spot.lat, spot.lng);
      };
      label();
      marker.on("drag", label);
      const tell = () => {
        const spot = marker.getLngLat().wrap();
        label();
        moved.current?.({ latitude: spot.lat, longitude: spot.lng });
      };
      marker.on("dragend", tell);
      map.on("click", (event) => {
        marker.setLngLat(event.lngLat);
        tell();
      });
      markerRef.current = { marker, tell, label };
    }
    mapRef.current = map;
    // Where the reader is, beside where the item is.
    const hideSelf = showSelf(map);
    return () => {
      hideSelf();
      sized.disconnect();
      mapRef.current = null;
      markerRef.current = null;
      map.remove();
    };
    // Made once: where it stands afterwards is the map's own business when it
    // is being dragged, and the effect below's when it is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);

  // Shown rather than chosen, the spot is wherever the page says it is; chosen,
  // the pin stands wherever the form last said, which is where it was put.
  useEffect(() => {
    if (picking) {
      markerRef.current?.marker.setLngLat([longitude, latitude]);
      markerRef.current?.label();
    } else mapRef.current?.jumpTo({ center: [longitude, latitude] });
  }, [picking, latitude, longitude]);

  useEffect(() => {
    if (!target) return;
    mapRef.current?.flyTo({ center: [target.longitude, target.latitude], zoom: target.zoom ?? 15, duration: 600 });
  }, [target]);

  useEffect(() => {
    mapRef.current?.setLanguage?.(mapLanguage(i18n.language));
  }, [i18n.language]);

  // Somewhere found by the search or by the locate button: the map goes there
  // and the pin with it, since a place looked up is a place meant.
  function go(spot) {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current && Number.isFinite(spot.latitude) && Number.isFinite(spot.longitude)) {
      markerRef.current.marker.setLngLat([spot.longitude, spot.latitude]);
      markerRef.current.tell();
    }
    if (spot.bbox) {
      map.fitBounds(
        [
          [spot.bbox[0], spot.bbox[1]],
          [spot.bbox[2], spot.bbox[3]],
        ],
        { padding: 16, duration: 600, maxZoom: 16 },
      );
    } else {
      map.flyTo({ center: [spot.longitude, spot.latitude], zoom: spot.zoom ?? 15, duration: 600 });
    }
  }

  if (!MAPBOX_TOKEN) return <p className={styles.noToken}>{t("map.noToken")}</p>;

  return (
    <div className={`${styles.frame} map-frame`}>
      <div ref={containerRef} className={styles.container} />
      {/* Chosen with the same tools the front page's map has, in the same
          corners: a place search, and nearer / further / where I am. */}
      {picking && (
        <>
          <MapSearch
            onPick={(place) => go(place)}
            near={() => {
              const center = mapRef.current?.getCenter();
              return center ? { latitude: center.lat, longitude: center.lng } : null;
            }}
          />
          <MapTools
            onZoomIn={() => mapRef.current?.zoomIn()}
            onZoomOut={() => mapRef.current?.zoomOut()}
            onLocate={async () => {
              const here = await locate({ timeout: 12000 });
              if (here) go({ ...here, zoom: 15 });
            }}
          />
        </>
      )}
      {/* Shown, the pin is the page's rather than the map's: fixed to the
          middle of the frame, its point on the centre. Chosen, it is a marker
          of the map's own, which is what lets it be dragged (see above). */}
      {!picking && (
        <span className={styles.pin}>
          <Pin />
        </span>
      )}
    </div>
  );
}
