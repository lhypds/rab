import i18n from "../i18n/index.js";
import { MAPBOX_TOKEN, mapLanguage } from "./mapbox.js";

// Places by name, anywhere in the world, for the Go-to sheet: countries,
// regions and towns, in the shape lo's own sheet reads them in — a name, the
// region and country it is in, and where it is. Asked of Mapbox, in the
// reader's language first and the others after it, so a city typed in one
// language is found by a reader browsing in another.
const MAPBOX_URL = "https://api.mapbox.com/search/geocode/v6/forward";
const MAPBOX_TYPES = "country,region,district,place,locality";
const LANGUAGES = ["en", "zh", "ja"];
const LIMIT = 5;
const TIMEOUT_MS = 10 * 1000;

// How much ground a place of each sort covers, as the zoom the map opens it at.
const ZOOM = { country: 4, region: 7, district: 10, place: 11, locality: 13 };

// What has been asked this visit, so stepping back through a word already typed
// is answered from here rather than asked again.
const answered = new Map();
const REMEMBERED = 100;

export async function findPlaces(query, { signal } = {}) {
  if (!MAPBOX_TOKEN) return [];
  const language = i18n.language || "en";
  const key = `${language}:${query}`;
  if (answered.has(key)) return answered.get(key);

  const own = mapLanguage(language);
  const url = new URL(MAPBOX_URL);
  url.search = new URLSearchParams({
    q: query,
    access_token: MAPBOX_TOKEN,
    autocomplete: "true",
    types: MAPBOX_TYPES,
    limit: String(LIMIT),
    language: [own, ...LANGUAGES.map(mapLanguage).filter((code) => code !== own)].join(","),
  });

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error(`Mapbox returned HTTP ${response.status}`);
    const data = await response.json();
    const seen = new Set();
    const places = (data.features ?? [])
      .map((feature) => {
        const properties = feature.properties ?? {};
        const { latitude, longitude } = properties.coordinates ?? {};
        const name = properties.name_preferred || properties.name;
        if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        const region = properties.context?.region?.name ?? "";
        const country = properties.context?.country?.name ?? "";
        return {
          name,
          region: region === name ? "" : region,
          country: country === name ? "" : country,
          countryCode: properties.context?.country?.country_code?.toUpperCase() ?? null,
          zoom: ZOOM[properties.feature_type] ?? 12,
          latitude,
          longitude,
        };
      })
      .filter((place) => {
        const id = place && `${place.name}|${place.region}|${place.country}`;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    answered.set(key, places);
    if (answered.size > REMEMBERED) answered.delete(answered.keys().next().value);
    return places;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
