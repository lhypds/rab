import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Select, showToast } from "../../ui/index.js";
import { formatCoords } from "../../utils/format.js";
import { DEFAULT_VIEW, MAPBOX_TOKEN, addressLanguage, placeName, savedView } from "../../utils/mapbox.js";
import { currentRegion, useRegion } from "../../utils/region.js";
import SpotMap from "../SpotMap/index.js";
import styles from "./location.module.css";

// How long the line naming a spot may be.
export const PLACE_MAX = 120;

// Near enough to be the same spot.
const near = (a, b) => Math.abs(a - b) < 1e-6;

// Where something stands, as a form puts it — an item's, a page's: a pin on a
// map, dragged where it goes, with the name of the spot on the map's bottom
// edge, following the pin until somebody types over it. Over the map, the
// account's places to put it at in one choice; under it, the way to keep the
// spot as one of them, and the way to take it off.
//
// `value` is { located, latitude, longitude, place }, and `onChange` is given
// what of it changed. `locations` are the places to choose from, and
// `onSaved` is told of one just kept — with `region` saved beside it, and in
// the public account's folder where `shared`. `onTouched` is told the spot
// was put by hand. Mounted afresh for each opening of its form (by `key`): it
// starts by taking a place already written as somebody's own words.
export default function LocationField({ value, onChange, locations, shared = false, region = null, onSaved, onTouched, onError }) {
  const { t } = useTranslation();
  const { country } = useRegion();
  // The language a spot is named in (see addressLanguage).
  const placeLang = addressLanguage(country);
  const { located, latitude, longitude, place } = value;
  // Whether the place line is the reader's own words. Until it is, it follows
  // the pin: the name of wherever the map has been dragged to.
  const placeTyped = useRef(Boolean(place));
  // The name being given to the spot, while it is being saved as a place.
  const [naming, setNaming] = useState(null);
  // Somewhere for the map to go to: the place just chosen from the list. A new
  // object each time, so the same place chosen twice still moves it.
  const [target, setTarget] = useState(null);

  // Whether the pin and its address are one of the places as it is kept:
  // chosen from the list and left alone, or just saved. There is nothing to
  // save then; moving the pin or rewriting the address makes it a new spot.
  const keptLocation = located
    ? locations.find(
        (location) =>
          near(location.latitude, latitude) &&
          near(location.longitude, longitude) &&
          (location.address || location.name).slice(0, PLACE_MAX) === place.trim(),
      )
    : null;

  // The pin's place, named a moment after the map stops moving — not where it
  // stands at one of the places, whose own address it already has.
  const atKept = Boolean(keptLocation);
  useEffect(() => {
    if (!located || placeTyped.current || atKept || !MAPBOX_TOKEN) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      placeName(latitude, longitude, placeLang, controller.signal)
        .then((name) => {
          if (name && !placeTyped.current) onChange({ place: name.slice(0, PLACE_MAX) });
        })
        .catch(() => {});
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located, latitude, longitude, placeLang, atKept]);

  function add() {
    onTouched?.();
    const view = savedView() ?? currentRegion().center ?? DEFAULT_VIEW;
    onChange({ located: true, latitude: view.latitude, longitude: view.longitude });
  }

  // One of the places: the pin goes to its spot and the line under the pin is
  // its address — the place's own, so it stays put rather than following the
  // pin.
  function putAt(id) {
    const location = locations.find((each) => each.id === id);
    if (!location) return;
    onTouched?.();
    placeTyped.current = true;
    // The map goes there too: with a pin on it already, the pin alone would
    // move, to somewhere the map is not looking.
    setTarget({ latitude: location.latitude, longitude: location.longitude });
    onChange({
      located: true,
      latitude: location.latitude,
      longitude: location.longitude,
      place: (location.address || location.name).slice(0, PLACE_MAX),
    });
  }

  // The spot on the map, kept as one of the places under a name.
  async function save() {
    const name = (naming ?? "").trim();
    if (!name) return;
    try {
      const answer = await api.saveLocation({ name, address: place.trim(), latitude, longitude, region, shared });
      onSaved?.(answer.location);
      setNaming(null);
      showToast(t("item.locationSaved"), 2000);
    } catch (saveError) {
      onError?.(saveError.message);
    }
  }

  return (
    <div className="field">
      <span className="field-label">
        {t("item.location")}
        {located && <span className="field-count">{formatCoords(latitude, longitude)}</span>}
      </span>
      {/* The places to put it at: choosing one puts the pin there. Always here,
          so that it is known there is such a list: with none in it yet, it
          says so. */}
      <Select
        sans
        label={t(shared ? "item.locationChoosePublic" : "item.locationChoose")}
        // The place the pin is at, where it is one of them: the box says its
        // name until the pin is moved off it.
        value={keptLocation?.id ?? ""}
        onChange={putAt}
        options={[
          { value: "", label: t(shared ? "item.locationChoosePublic" : "item.locationChoose") },
          // Not a place: choosing it puts the pin nowhere.
          ...(locations.length === 0 ? [{ value: "none", label: t(shared ? "item.locationNonePublic" : "item.locationNone") }] : []),
          // Each place on two lines: what it is called and where, and under
          // that, in grey, the spot itself.
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
                  <span className={styles.locationSpot}>{formatCoords(location.latitude, location.longitude)}</span>
                </span>
              ),
            };
          }),
        ]}
      />
      {located ? (
        <>
          <div className={styles.map}>
            <SpotMap
              latitude={latitude}
              longitude={longitude}
              target={target}
              onMove={(spot) => {
                // The pin has been put somewhere else, so the name it had
                // belongs to where it was: the line under it goes back to
                // following the pin, typed over or not.
                placeTyped.current = false;
                onChange(spot);
              }}
            />
            {/* What the spot is called, on the map it is a name for: in the
                middle of its bottom edge. It follows the pin until somebody
                types over it. */}
            <input
              className={styles.place}
              value={place}
              onChange={(event) => {
                placeTyped.current = event.target.value.trim() !== "";
                onChange({ place: event.target.value });
              }}
              placeholder={t("item.placePlaceholder")}
              maxLength={PLACE_MAX}
              aria-label={t("item.place")}
            />
          </div>
          {/* Under the map: keeping the spot at the left, taking it off at the
              right. The empty span keeps Remove at the right. */}
          <div className={styles.actions}>
            {keptLocation ? (
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
                    save();
                  }}
                  placeholder={t("item.locationName")}
                  maxLength={60}
                  autoFocus
                />
                <button type="button" className="small-button" onClick={save} disabled={!naming.trim()}>
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
                onTouched?.();
                onChange({ located: false, place: "" });
              }}
            >
              {t("item.locationRemove")}
            </button>
          </div>
          <span className={styles.hint}>{t("item.locationHint")}</span>
        </>
      ) : (
        <>
          <button type="button" className={`small-button ${styles.start}`} onClick={add}>
            {t("item.locationAdd")}
          </button>
          <span className={styles.hint}>{t("item.locationOptional")}</span>
        </>
      )}
    </div>
  );
}
