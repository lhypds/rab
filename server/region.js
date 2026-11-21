import net from "node:net";

// Which country a request comes from, worked out from its address.
//
// rab opens on a map, and a map has to open somewhere. Where the browser will
// say where it is, that is the answer; where it will not, the country the
// request came from is the next best one — the map opens on its capital, and
// the place search looks inside it.
//
// The lookup is a public, key-free service (ipwho.is). The address is the only
// thing sent to it. An answer is kept for a day per address, so a reader is
// asked about once however many pages they open, and a service that is slow or
// down costs nothing but the answer: the browser falls back to its own guess.

const LOOKUP_MS = 4000;
const KEEP_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;
const cache = new Map();

// Loopback and private ranges say nothing about where anybody is. Asked about
// with no address at all, the service answers for whoever is asking — which on
// a laptop running the dev server is the right answer anyway.
function isPublic(ip) {
  if (!net.isIP(ip)) return false;
  if (net.isIPv4(ip)) {
    return !/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(ip);
  }
  return !/^(::1$|fe80:|fc|fd)/i.test(ip);
}

export async function lookupRegion(address) {
  const ip = String(address ?? "").replace(/^::ffff:/i, "");
  const key = isPublic(ip) ? ip : "";
  const kept = cache.get(key);
  if (kept && kept.until > Date.now()) return kept.region;

  let region = { country: null, capital: null };
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(key)}?fields=success,country_code,capital`, {
      signal: AbortSignal.timeout(LOOKUP_MS),
    });
    const data = await response.json();
    if (data?.success && /^[A-Z]{2}$/.test(data.country_code ?? "")) {
      region = { country: data.country_code, capital: String(data.capital ?? "").slice(0, 80) || null };
    }
  } catch {
    // No answer: the browser has its own guess to fall back on.
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  // A miss is kept too, but briefly, so a service having a bad minute is not
  // asked again by every page load in it.
  cache.set(key, { region, until: Date.now() + (region.country ? KEEP_MS : 60 * 1000) });
  return region;
}
