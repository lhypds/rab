// The area a spot is in, asked of Mapbox by the server: what it is called, the
// line saying where that is, and its box as [west, south, east, north] — the
// shape an item's `region` has. The item form finds this in the browser; a
// crawler that sends a spot and no area has it found here instead (see the
// public API in index.js). The town where the spot has one, else the widest
// thing Mapbox names there. Null where there is no token or no answer.
const REVERSE = "https://api.mapbox.com/search/geocode/v6/reverse";
const TYPES = "place,locality,district,region";
const LANGUAGES = { en: "en", zh: "zh-Hans", ja: "ja" };
const TIMEOUT_MS = 10 * 1000;

// Spots a few hundred metres apart are in the same town: answered once.
const answered = new Map();
const REMEMBERED = 2000;

export async function areaAt(latitude, longitude, lang = "en") {
  const token = process.env.VITE_MAPBOX_TOKEN;
  if (!token) return null;
  const language = LANGUAGES[String(lang).slice(0, 2)] ?? "en";
  const key = `${language}:${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  if (answered.has(key)) return answered.get(key);

  const params = new URLSearchParams({
    longitude: String(longitude),
    latitude: String(latitude),
    types: TYPES,
    language,
    access_token: token,
  });
  let features;
  try {
    const response = await fetch(`${REVERSE}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    features = (await response.json()).features ?? [];
  } catch (error) {
    console.error(`[area] Mapbox did not answer: ${error.message}`);
    return null;
  }
  // Where Mapbox files a ward as a second town (京都市下京区 beside 京都市),
  // the town is the one the other is named after — as the item form has it.
  const places = features.filter((each) => each.properties?.feature_type === "place" && each.properties?.name);
  const feature =
    places.find((each) => places.some((other) => other !== each && other.properties.name.includes(each.properties.name))) ??
    places[0] ??
    features.find((each) => each.properties?.feature_type === "locality") ??
    features[0];
  const properties = feature?.properties;
  let area = null;
  if (properties?.name) {
    const [x, y] = feature.geometry?.coordinates ?? [longitude, latitude];
    const spread = properties.feature_type === "locality" ? 0.01 : 0.05;
    const bbox = properties.bbox?.length === 4 ? properties.bbox : [x - spread, y - spread, x + spread, y + spread];
    area = { name: properties.name, detail: properties.place_formatted ?? "", bbox };
  }
  answered.set(key, area);
  if (answered.size > REMEMBERED) answered.delete(answered.keys().next().value);
  return area;
}
