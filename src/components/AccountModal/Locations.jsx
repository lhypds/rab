import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { showToast } from "../../ui/index.js";
import { formatCoords } from "../../utils/format.js";
import { DEFAULT_VIEW, MAPBOX_TOKEN, addressLanguage, areaAt, areaOf, placeName, savedView } from "../../utils/mapbox.js";
import { currentRegion, useRegion } from "../../utils/region.js";
import SpotMap from "../SpotMap/index.js";
import styles from "./account.module.css";

const NAME_MAX = 60;
const ADDRESS_MAX = 120;

// The places the user keeps to put items at (see the item form, which chooses
// from them): the list of them, each to be changed — its name, its address,
// its spot on the map — or taken off, and a new one added. One is worked on at
// a time, in place: the row it was, opened into a small form.
export default function Locations({ isOpen }) {
  const { t } = useTranslation();
  // Addresses are written in the language of the country the reader is in.
  const lang = addressLanguage(useRegion().country);
  // The places as they are kept, null until they have been read.
  const [locations, setLocations] = useState(null);
  // The one being written: what is kept of it, with `id` null for a new one
  // and `moved` once its pin has been put somewhere else.
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Whether the address was written by hand. Until it is, it follows the pin.
  const addressTyped = useRef(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setLocations(null);
    setDraft(null);
    setError("");
    api
      .getLocations()
      .then((answer) => !cancelled && setLocations(answer.locations ?? []))
      .catch(() => !cancelled && setLocations([]));
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // The pin's place, named a moment after it is put down.
  const { latitude, longitude, moved } = draft ?? {};
  const open = Boolean(draft);
  useEffect(() => {
    if (!open || addressTyped.current || !MAPBOX_TOKEN) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      placeName(latitude, longitude, lang, controller.signal)
        .then((name) => {
          if (name && !addressTyped.current) setDraft((current) => current && { ...current, address: name.slice(0, ADDRESS_MAX) });
        })
        .catch(() => {});
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, latitude, longitude, lang]);

  function start(location) {
    setError("");
    if (location) {
      addressTyped.current = Boolean(location.address);
      setDraft({ ...location, address: location.address ?? "", moved: false });
      return;
    }
    addressTyped.current = false;
    const view = savedView() ?? currentRegion().center ?? DEFAULT_VIEW;
    setDraft({ id: null, name: "", address: "", latitude: view.latitude, longitude: view.longitude, region: null, moved: true });
  }

  async function save(event) {
    event.preventDefault();
    const name = draft.name.trim();
    if (busy || !name) return;
    setBusy(true);
    setError("");
    try {
      // The area the spot is in goes with it: asked for again where the pin
      // has been moved, and kept without one where nobody answers.
      let region = draft.region ?? null;
      if (moved && MAPBOX_TOKEN) {
        region = await areaAt(draft.latitude, draft.longitude, lang)
          .then(areaOf)
          .catch(() => null);
      }
      const answer = await api.saveLocation({
        ...(draft.id ? { id: draft.id } : {}),
        name,
        address: draft.address.trim(),
        latitude: draft.latitude,
        longitude: draft.longitude,
        region,
      });
      setLocations((current) =>
        current.some((each) => each.id === answer.location.id)
          ? current.map((each) => (each.id === answer.location.id ? answer.location : each))
          : [...current, answer.location],
      );
      setDraft(null);
      showToast(t("item.locationSaved"), 2000);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !draft?.id) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteLocation(draft.id);
      setLocations((current) => current.filter((each) => each.id !== draft.id));
      setDraft(null);
      showToast(t("account.locationRemoved"), 2000);
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusy(false);
    }
  }

  const form = draft && (
    <form className={styles.locationForm} onSubmit={save} autoComplete="off">
      <input
        className="text-input"
        value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        placeholder={t("item.locationName")}
        maxLength={NAME_MAX}
        aria-label={t("item.locationName")}
        autoFocus={!draft.id}
      />
      <input
        className="text-input"
        value={draft.address}
        onChange={(event) => {
          addressTyped.current = event.target.value.trim() !== "";
          setDraft({ ...draft, address: event.target.value });
        }}
        placeholder={t("account.locationAddress")}
        maxLength={ADDRESS_MAX}
        aria-label={t("account.locationAddress")}
      />
      <div className={styles.locationMap}>
        <SpotMap
          latitude={draft.latitude}
          longitude={draft.longitude}
          zoom={draft.id ? 15 : 12}
          onMove={(spot) => setDraft((current) => current && { ...current, ...spot, moved: true })}
        />
      </div>
      <div className={styles.contactActions}>
        <span className={styles.locationButtons}>
          <button type="submit" className="small-button filled" disabled={busy || !draft.name.trim()}>
            {t("common.save")}
          </button>
          <button type="button" className="small-button" onClick={() => setDraft(null)} disabled={busy}>
            {t("common.cancel")}
          </button>
        </span>
        {draft.id && (
          <button type="button" className="small-button" onClick={remove} disabled={busy}>
            {t("item.locationRemove")}
          </button>
        )}
      </div>
      {error && <p className="form-message error">{error}</p>}
    </form>
  );

  return (
    <div className={styles.contacts}>
      <span className="field-label">{t("account.locations")}</span>
      {locations?.length === 0 && !draft && <span className={styles.hint}>{t("account.locationsEmpty")}</span>}
      {locations && locations.length > 0 && (
        <ul className={styles.locations}>
          {locations.map((location) =>
            draft?.id === location.id ? (
              <li key={location.id}>{form}</li>
            ) : (
              <li key={location.id} className={styles.locationRow}>
                <span className={styles.locationText}>
                  <span className={styles.locationName}>{location.name}</span>
                  <span className={styles.locationWhere}>
                    {[location.address, formatCoords(location.latitude, location.longitude)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <button type="button" className="small-button" onClick={() => start(location)} disabled={busy}>
                  {t("account.locationEdit")}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {draft && !draft.id && form}
      {locations && !draft && (
        <div className={styles.contactActions}>
          <button type="button" className="small-button" onClick={() => start(null)}>
            {t("item.locationAdd")}
          </button>
        </div>
      )}
      <span className={styles.hint}>{t("account.locationsHint")}</span>
    </div>
  );
}
