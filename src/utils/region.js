import { useEffect, useSyncExternalStore } from "react";
import { MAPBOX_TOKEN, geocode } from "./mapbox.js";

// Where in the world the reader is taken to be, for the two things that have to
// know before anybody has said: where the map opens, and which country its
// place search looks in.
//
// It starts as the country the request came from (see server/region.js), with
// the map on that country's capital. The plane in the top bar changes it: a
// place picked there is somewhere else to stand, and the country it is in
// becomes the one being searched.
//
// `place` is where the plane has put the reader down, for as long as they are
// away: the one thing besides their own position that says where they stand.
// Looking around the map does not — it moves the window, not the reader.

let region = { country: null, center: null, ready: false, traveling: false, place: null };
// The country the reader is really in, kept so that coming home from somewhere
// puts the search back inside it.
let homeCountry = null;
const listeners = new Set();

function set(next) {
  region = { ...region, ...next };
  for (const listener of listeners) listener();
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Whoever reads it has it asked for: it is not only the map that needs to
// know. The account's own page has no map, and a place put on the map from
// there — one of the account's locations — was named in English whatever
// country the reader was in, nobody having asked which that was.
export function useRegion() {
  useEffect(() => {
    loadRegion();
  }, []);
  return useSyncExternalStore(subscribe, () => region);
}

export function currentRegion() {
  return region;
}

// The country the browser's own language names, where the server could not say:
// "ja-JP" is a guess at Japan, and a guess is better than the whole world.
function guessedCountry() {
  const tag = (navigator.languages?.[0] ?? navigator.language ?? "").split("-");
  const code = tag[tag.length - 1]?.toUpperCase();
  return tag.length > 1 && /^[A-Z]{2}$/.test(code) ? code : null;
}

let asked = null;

// Asked once per page load, by whoever needs it first.
export function loadRegion() {
  asked ??= (async () => {
    let country = null;
    let capital = null;
    try {
      const data = await fetch("/api/region").then((response) => response.json());
      country = data?.country ?? null;
      capital = data?.capital ?? null;
    } catch {
      // The guess below stands in.
    }
    country ??= guessedCountry();
    let center = null;
    if (country && MAPBOX_TOKEN) {
      // The capital where its name is known, and the country itself where it
      // is not — which lands the map somewhere in the right country at least.
      const found = await geocode(capital || country, capital ? { country, types: "place,locality" } : { types: "country" })
        .then((places) => places[0] ?? null)
        .catch(() => null);
      if (found) center = { latitude: found.latitude, longitude: found.longitude, zoom: capital ? 10 : 4 };
    }
    // Only where nobody has travelled in the meantime: a place picked while
    // this was on its way is a later answer than this one.
    homeCountry = country;
    if (!region.traveling) set({ country, center, ready: true });
    else set({ center, ready: true });
    return region;
  })();
  return asked;
}

/* ------------------------------------------------------------------ travel */

// Somewhere to go, said by the plane's sheet and heard by the map. Kept here
// rather than handed over directly because the two are not always on the same
// page: a place picked from an item's page is waiting for the map when the
// reader gets back to it.
let journey = null;
const travelListeners = new Set();

export function travelTo(place) {
  journey = { ...place, ticket: Date.now() };
  set({
    traveling: true,
    place: { latitude: place.latitude, longitude: place.longitude },
    ...(place.country ? { country: place.country } : null),
  });
  for (const listener of travelListeners) listener(journey);
}

// Back to where the reader really is. The map is told to go home rather than
// to a spot, and finds home the way it does on a first visit: the reader's own
// position where the browser gives it, their country's capital where not.
export function travelHome() {
  journey = { home: true, ticket: Date.now() };
  set({ traveling: false, place: null, country: homeCountry ?? region.country });
  for (const listener of travelListeners) listener(journey);
}

// The journey still waiting to be made, looked at without being taken: a map
// that is put up and taken down again before it has drawn anything (as React
// does to every page once, in development) leaves it for the map that stays.
export function waitingJourney() {
  return journey;
}

// The journey still waiting to be made, taken by whoever makes it.
export function takeJourney() {
  const waiting = journey;
  journey = null;
  return waiting;
}

export function onTravel(listener) {
  travelListeners.add(listener);
  return () => travelListeners.delete(listener);
}
