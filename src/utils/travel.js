// Coordinates typed where a place name is expected: "35.01, 135.73", with or
// without the @ a map's own address writes them with. Lifted from lo's Go-to.
const COORDINATES = /^@?\s*([-+]?\d{1,3}(?:\.\d+)?)\s*(?:,\s*|\s+)([-+]?\d{1,3}(?:\.\d+)?)(?:\s*,\s*\d+(?:\.\d+)?z)?$/i;

// Six places, the precision the sensor's own fixes are kept at (see location.js):
// about a tenth of a metre, and short enough to read in an address.
function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

// A pair of numbers as a spot, or null where they cannot be one.
export function toSpot(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  return { latitude: round(lat), longitude: round(lon) };
}

export function readCoordinates(text) {
  const match = COORDINATES.exec(String(text ?? "").trim());
  return match ? toSpot(match[1], match[2]) : null;
}
