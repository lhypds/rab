// The way to somewhere, handed to Google Maps — as lo does it (see
// ~/code/lo/lo/src/utils/maps.js).

// Past this a route is not a walk however willing a router is to draw one, and
// under it driving goes the long way round every one-way street to get there.
const WALKING_LIMIT_M = 3000;

// A phone or a tablet: everything else gets a new tab. iPadOS calls itself a
// Mac, and the touch points are the only thing left that give it away.
function handheld() {
  if (typeof navigator === "undefined") return false;
  if (/Android|iPhone|iPod/i.test(navigator.userAgent)) return true;
  return /Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Google's cross-platform directions address: the plain https one, which a
// tapped link on iOS and Android is handed to the Maps app with, and which is
// the directions page on a desktop. With no origin, Maps routes from wherever
// the device says it is.
export function directionsUrl(to, from = null) {
  const query = new URLSearchParams({ api: "1", destination: `${to.latitude},${to.longitude}` });
  if (from) {
    query.set("origin", `${from.latitude},${from.longitude}`);
    query.set("travelmode", distanceMeters(from, to) <= WALKING_LIMIT_M ? "walking" : "driving");
  }
  return `https://www.google.com/maps/dir/?${query}`;
}

// Spread onto the anchor: a new tab on a desktop, so the map is still there
// behind Google Maps; the same tab on a handheld, where target="_blank" would
// stop Safari handing the link to the app.
export function directionsLink(to, from = null) {
  const href = directionsUrl(to, from);
  return handheld() ? { href } : { href, target: "_blank", rel: "noopener noreferrer" };
}
