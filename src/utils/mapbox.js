export const MAPBOX_TOKEN = String(import.meta.env.VITE_MAPBOX_TOKEN ?? "").trim();

// The quiet face of the map: grey ground and hairline streets, which is the
// only one a page drawn in one ink sits on without arguing.
export const MAP_STYLE = "mapbox://styles/mapbox/light-v11";

// Where the map opens for somebody it has never met and cannot locate.
export const DEFAULT_VIEW = { latitude: 35.6812, longitude: 139.7671, zoom: 11 };

// The language the ground is labelled in, said the way Mapbox says it.
export function mapLanguage(lang) {
  return { zh: "zh-Hans", ja: "ja" }[lang] ?? "en";
}

// The stretch of map the reader was last looking at, for as long as the page
// lives: coming back from an item's page puts the map where it was left. Not
// kept across visits — a fresh visit opens on where the reader is, which is the
// better answer by the time they have gone and come back.
let lastView = null;

export function savedView() {
  return lastView;
}

export function saveView(view) {
  lastView = view;
}

// Whether the reader has said yes to being located here before, kept across
// visits. It is kept because Safari on iOS will not say: asked whether it may
// give a position it answers "ask them" even where it has just been allowed,
// so a browser's own word cannot tell a returning reader from a new one.
const ALLOWED_KEY = "rab:location";

function allowed() {
  try {
    return localStorage.getItem(ALLOWED_KEY);
  } catch {
    return null;
  }
}

function remember(answer) {
  try {
    localStorage.setItem(ALLOWED_KEY, answer);
  } catch {
    // Asked again next visit, which is the worst this costs.
  }
}

// Why the last attempt to find the reader came to nothing: "denied" where they
// or their settings said no, "insecure" where the page is not one a browser
// will give a position to, "failed" where the device simply had no answer —
// and null after an attempt that worked.
let failure = null;

export function locateFailure() {
  return failure;
}

function position(options) {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (found) => resolve({ spot: { latitude: found.coords.latitude, longitude: found.coords.longitude } }),
      (error) => resolve({ error }),
      options,
    );
  });
}

// Where the device says it is, or null where it will not say (see
// locateFailure for why).
export async function locate({ timeout = 8000 } = {}) {
  // A browser gives a position only to a page it trusts: https, or localhost.
  // An iPhone opening a dev server by its LAN address is the usual way to
  // meet this.
  if (!navigator.geolocation || !window.isSecureContext) {
    failure = "insecure";
    return null;
  }
  let answer = await position({ enableHighAccuracy: false, timeout, maximumAge: 5 * 60 * 1000 });
  // iOS often has nothing to give a request for a rough position — no answer
  // in time, or "position unavailable" — and answers at once when asked for a
  // precise one. So a miss that is not a refusal is asked again that way.
  if (answer.error && answer.error.code !== answer.error.PERMISSION_DENIED) {
    answer = await position({ enableHighAccuracy: true, timeout: Math.max(timeout, 10000), maximumAge: 0 });
  }
  if (answer.spot) {
    failure = null;
    remember("yes");
    return answer.spot;
  }
  const denied = answer.error.code === answer.error.PERMISSION_DENIED;
  failure = denied ? "denied" : "failed";
  if (denied) remember("no");
  return null;
}

// What the browser will do when asked where it is: answer ("granted"), ask the
// reader first ("prompt"), refuse ("denied"), or never be able to
// ("unsupported"). A browser that cannot say which is taken to be one that
// asks — unless the reader has said yes here before, in which case it is one
// that answers: on iOS that is the only way a returning reader is known, and
// the worst it costs is the system's own question once more.
export async function locationPermission() {
  if (!navigator.geolocation || !window.isSecureContext) return "unsupported";
  let state = "prompt";
  try {
    state = (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    // No such question in this browser: it is one that asks.
  }
  if (state === "prompt" && allowed() === "yes") return "granted";
  return state;
}

const GEOCODE = "https://api.mapbox.com/search/geocode/v6";

// Places by name. `country` keeps the search inside one country, as its
// two-letter code; `near` leans it towards a spot; `types` narrows what counts
// as a place.
export async function geocode(query, { lang = "en", country = null, near = null, types = null, limit = 6, signal } = {}) {
  if (!MAPBOX_TOKEN) return [];
  const params = new URLSearchParams({
    q: query,
    language: mapLanguage(lang),
    limit: String(limit),
    access_token: MAPBOX_TOKEN,
  });
  if (country) params.set("country", country.toLowerCase());
  if (types) params.set("types", types);
  if (near) params.set("proximity", `${near.longitude},${near.latitude}`);
  const response = await fetch(`${GEOCODE}/forward?${params}`, { signal });
  if (!response.ok) throw new Error("Search failed");
  const data = await response.json();
  return (data.features ?? []).map((feature) => ({
    id: feature.id,
    name: feature.properties?.name ?? "",
    detail: feature.properties?.place_formatted ?? "",
    type: feature.properties?.feature_type ?? "",
    country: feature.properties?.context?.country?.country_code?.toUpperCase() ?? null,
    longitude: feature.geometry?.coordinates?.[0],
    latitude: feature.geometry?.coordinates?.[1],
    bbox: feature.properties?.bbox ?? null,
  }));
}

// What a spot is called, roughly: the neighbourhood and the town, which is as
// much as an item's page should say about where somebody keeps their things.
export async function placeName(latitude, longitude, lang, signal) {
  if (!MAPBOX_TOKEN) return "";
  const params = new URLSearchParams({
    longitude: String(longitude),
    latitude: String(latitude),
    language: mapLanguage(lang),
    types: "neighborhood,locality,place",
    access_token: MAPBOX_TOKEN,
  });
  const response = await fetch(`${GEOCODE}/reverse?${params}`, { signal });
  if (!response.ok) return "";
  const data = await response.json();
  const names = [];
  for (const feature of data.features ?? []) {
    const name = feature.properties?.name;
    if (name && !names.includes(name)) names.push(name);
    if (names.length === 2) break;
  }
  return names.join(", ");
}

// The types of place an area can be: a town or a ward, a county, a prefecture
// or a province.
export const AREA_TYPES = "place,locality,district,region";

// A place as the area an item is offered in: what it is called, the line saying
// where that is, and the box of ground it covers as [west, south, east, north].
// A place that comes without a box is given a few kilometres round its middle.
export function areaOf(place) {
  if (!place?.name) return null;
  const spread = 0.05;
  const bbox =
    place.bbox?.length === 4
      ? place.bbox
      : [place.longitude - spread, place.latitude - spread, place.longitude + spread, place.latitude + spread];
  if (!bbox.every(Number.isFinite)) return null;
  return { name: place.name, detail: place.detail ?? "", bbox };
}

// What a spot is called, by lo's own logic and from lo's own source (see
// lookupPlace in lo's server/geo.js): BigDataCloud's reverse geocoder, read the
// same way — the city for a name, the ward under it as `locality`, the
// prefecture as `region`. City is empty out in the countryside, where locality
// is the village and principalSubdivision the prefecture, so the name is
// whichever exists, widest last.
const PLACE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";
// Asked for "zh" the geocoder answers in traditional; only the script named
// outright gets 下京区 rather than 下京區.
const PLACE_SCRIPT = { zh: "zh-Hans" };

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

// Folded before two names are compared: they come from the same geocoder but
// not always in the same case or width.
function fold(text) {
  return text.normalize("NFKC").toLowerCase();
}

async function lookupPlace(latitude, longitude, lang, signal) {
  const language = ["en", "zh", "ja"].includes(lang) ? lang : "en";
  const url = new URL(PLACE_URL);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("localityLanguage", PLACE_SCRIPT[language] ?? language);
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) return null;
  const data = await response.json();
  const name = firstString(data.city, data.locality, data.principalSubdivision, data.countryName);
  if (!name) return null;
  const locality = firstString(data.locality);
  const region = firstString(data.principalSubdivision, data.countryName);
  return {
    name,
    // Left off where it is the name over again, as lo's strip leaves it.
    locality: locality !== name ? locality : "",
    // And the region where the name has already said it — Kyoto under "Kyoto
    // Prefecture".
    region: region && !fold(region).includes(fold(name)) ? region : "",
  };
}

// The area a spot is in, for the head of the panel and for the item form: what
// it is called, as lo calls it — 京都市, with 下京区 · 京都府 on the line under
// it — and the box of ground it covers, which lo's geocoder does not give and
// Mapbox does. Either half stands in for the other where one does not answer:
// Mapbox's own names where lo's geocoder is silent, no box where Mapbox is.
// Null where neither knows the spot.
export async function areaAt(latitude, longitude, lang, signal) {
  const [ground, named] = await Promise.all([
    mapboxArea(latitude, longitude, lang, signal).catch((error) => {
      if (error?.name === "AbortError") throw error;
      return null;
    }),
    lookupPlace(latitude, longitude, lang, signal).catch((error) => {
      if (error?.name === "AbortError") throw error;
      return null;
    }),
  ]);
  if (!named) return ground;
  return {
    name: named.name,
    locality: named.locality,
    within: named.region,
    detail: ground?.detail ?? "",
    bbox: ground?.bbox ?? null,
    longitude: ground?.longitude ?? longitude,
    latitude: ground?.latitude ?? latitude,
  };
}

// Mapbox's half of that: the town a spot stands in, and failing that the
// prefecture, with the box it covers — and its own reading of the ward, for
// when it is the only one answering.
async function mapboxArea(latitude, longitude, lang, signal) {
  if (!MAPBOX_TOKEN) return null;
  const params = new URLSearchParams({
    longitude: String(longitude),
    latitude: String(latitude),
    language: mapLanguage(lang),
    types: "locality,place,region",
    access_token: MAPBOX_TOKEN,
  });
  const response = await fetch(`${GEOCODE}/reverse?${params}`, { signal });
  if (!response.ok) return null;
  const data = await response.json();
  const features = data.features ?? [];
  const places = features.filter((each) => each.properties?.feature_type === "place" && each.properties.name);
  // The town. Where Mapbox answers with two — in Japan's big cities it files
  // the ward as a place of its own, 京都市下京区 beside 京都市, in either order
  // — the town is the one the other is named after.
  const town =
    places.find((each) => places.some((other) => other !== each && other.properties.name.includes(each.properties.name))) ??
    places[0];
  const feature = town ?? features.find((each) => each.properties?.feature_type === "region") ?? null;
  const properties = feature?.properties;
  if (!properties?.name) return null;
  // The ward the spot is in, where the town has them. Either that second place,
  // with the town's name taken back off it (京都市下京区 → 下京区, "Shimogyo,
  // Kyoto" → "Shimogyo"), or Mapbox's locality — which is the ward everywhere
  // but Japan (黄浦区, Manhattan), and there is the block (西新宿), a step too
  // fine to be what a district is called.
  let locality = "";
  if (town) {
    const ward = places.find((each) => each !== town && each.properties.name.includes(properties.name));
    if (ward) {
      locality = ward.properties.name.replace(properties.name, "").replace(/^[\s,，、]+|[\s,，、]+$/g, "");
    } else if (properties.context?.country?.country_code?.toUpperCase() !== "JP") {
      locality = features.find((each) => each.properties?.feature_type === "locality")?.properties?.name ?? "";
    }
  }
  // What the area is inside, for the line under its name: the prefecture a
  // town is in, the country a prefecture is in. Left off where it would only
  // say the name again.
  const context = properties.context ?? {};
  const within = properties.feature_type === "place" ? context.region?.name : context.country?.name;
  return {
    name: properties.name,
    locality: locality !== properties.name ? locality : "",
    within: within && within !== properties.name ? within : "",
    detail: properties.place_formatted ?? "",
    bbox: properties.bbox ?? null,
    longitude: feature.geometry?.coordinates?.[0],
    latitude: feature.geometry?.coordinates?.[1],
  };
}

export function directionsUrl(latitude, longitude) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

// The pin an item stands on the map with: a head and a point, drawn on a
// 24-unit grid with the tip at (12, 21).
export const PIN_PATH = "M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11z";
