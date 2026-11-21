import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

try {
  // real environment variables take precedence over .env entries
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // no .env file — use the ambient environment as-is
}

const {
  checkPassword,
  countUnread,
  createBooking,
  createItem,
  createMessage,
  createUser,
  deleteConversation,
  deleteExpiredSessions,
  deleteItem,
  deleteSession,
  getBooking,
  getBookingsByRenter,
  getBookingsForItem,
  getBookingsForItemByRenter,
  getBookingsForOwner,
  getConversation,
  getDays,
  getDaysBetween,
  getItem,
  getItemImages,
  getItemsAt,
  getItemsByUser,
  getItemsInBox,
  getSession,
  getTaken,
  getThreads,
  getUser,
  hasOwnOverlap,
  overlapping,
  readConversation,
  saveSession,
  searchItems,
  setBookingStatus,
  setDays,
  touchSession,
  transaction,
  updateItem,
} = await import("./db.js");
const { MAX_IMAGE_BYTES, imageFile, isStoredName, storeImage } = await import("./images.js");
const { MODES, dayPrice, listPrice, parseHours, parseRates, timeQuote } = await import("./rates.js");
const { lookupRegion } = await import("./region.js");

const port = Number(process.env.PORT) || 3016;
const isProduction = process.env.NODE_ENV === "production";

/* -------------------------------------------------------------------- rules */

const USERNAME_RE =
  /^[a-z0-9_\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}-]{1,32}$/u;
const USERNAME_LETTER_RE =
  /[a-z\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}]/u;
const USERNAME_HINT = "A username is 1–32 characters: letters, digits, CJK characters, - and _";
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;
const PASSWORD_HINT = `A password is ${PASSWORD_MIN}–${PASSWORD_MAX} characters`;

// How long a session lasts unused. Presenting the token pushes the expiry out
// again, at most once a day, so a device somebody keeps using stays signed in.
const sessionAgeMs = 30 * 24 * 60 * 60 * 1000;
const sessionRenewMs = 24 * 60 * 60 * 1000;

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 2000;
const PLACE_MAX = 120;
const REGION_MAX = 120;
const IMAGES_MAX = 100;
const KINDS = new Set(["item", "space", "service"]);
const CATEGORY_RE = /^[a-z0-9-]{0,32}$/;
const PRICE_MAX = 100_000_000;
const CURRENCIES = new Set(["JPY", "CNY", "USD", "EUR"]);
const NOTE_MAX = 500;
const MESSAGE_MAX = 1000;
// The longest single rental, and how far ahead the calendar reaches.
const BOOKING_MAX_DAYS = 90;
const CALENDAR_DAYS = 366;

deleteExpiredSessions(Date.now());

function normalizeUsername(value) {
  return String(value ?? "").trim().normalize("NFKC").toLowerCase();
}

function usernameFault(username) {
  if (!USERNAME_RE.test(username)) return { error: USERNAME_HINT };
  if (!USERNAME_LETTER_RE.test(username)) {
    return { error: "A username needs at least one letter", code: "USERNAME_NO_LETTER" };
  }
  return null;
}

function usablePassword(value) {
  const password = String(value ?? "");
  return password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX ? password : null;
}

function text(value, max) {
  return String(value ?? "").trim().normalize("NFC").slice(0, max);
}

/* --------------------------------------------------------------------- days */

// A day is a calendar date and nothing more: "2026-11-19", no clock and no
// zone. A rental is counted in days at the place the item is, and both sides
// read the same square of the same calendar wherever they are sitting.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value) {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

// The hour something is picked up or brought back: "09:30", on the clock of
// the place the item is.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isTime(value) {
  return typeof value === "string" && TIME_RE.test(value);
}

function addDays(day, count) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

// The earliest day anybody could still be calling today. The server keeps UTC
// and a reader west of it is still in yesterday, so the floor is one day back.
function earliestDay() {
  return addDays(new Date().toISOString().slice(0, 10), -1);
}

/* ----------------------------------------------------------------- sessions */

// The session is in one place: the Authorization header, set deliberately by
// the client. Nothing a browser attaches on its own authenticates anything, so
// a hostile page cannot spend a reader's session.
function sessionToken(req) {
  return /^Bearer\s+([^\s]+)$/i.exec(String(req.headers.authorization ?? ""))?.[1] ?? null;
}

function sessionHash(token) {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function currentSession(req) {
  const token = sessionToken(req);
  const tokenHash = token ? sessionHash(token) : null;
  const session = tokenHash ? getSession(tokenHash) : null;
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt <= now) {
    deleteSession(tokenHash);
    return null;
  }
  if (session.expiresAt - now <= sessionAgeMs - sessionRenewMs) {
    session.expiresAt = now + sessionAgeMs;
    touchSession(tokenHash, session.expiresAt);
  }
  return { tokenHash, ...session };
}

function startSession(user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  deleteExpiredSessions(now);
  saveSession(sessionHash(token), user.id, now + sessionAgeMs);
  return token;
}

// Most of rab can be read without an account — the map and an item's page are
// the things people are sent links to — so the session is read on every request
// and only demanded where something is being written or is somebody's own.
function readSession(req, _res, next) {
  const session = currentSession(req);
  req.user = session ? getUser(session.username) : null;
  next();
}

function requireSession(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please sign in", code: "LOGIN_REQUIRED" });
  next();
}

/* ---------------------------------------------------------------------- app */

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "256kb" }));
app.use("/api", readSession);

app.get("/api/session", requireSession, (req, res) => {
  res.json({ user: req.user, unread: countUnread(req.user.id) });
});

// Signing in is asked in two goes, the name and then the password. This is the
// first: it signs nobody in and says whether the name is an account at all, so
// the screen can ask "create it?" about a name nobody has rather than open an
// account on a typo.
app.post("/api/username", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const fault = usernameFault(username);
  if (fault) return res.status(400).json(fault);
  const user = getUser(username);
  if (!user) return res.status(404).json({ error: "No such user", code: "USER_NOT_FOUND" });
  res.json({ username: user.username });
});

app.post("/api/login", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const user = USERNAME_RE.test(username) ? getUser(username) : null;
  if (!user) return res.status(404).json({ error: "No such user", code: "USER_NOT_FOUND" });
  if (!checkPassword(username, String(req.body?.password ?? ""))) {
    return res.status(401).json({ error: "Wrong password", code: "PASSWORD_WRONG" });
  }
  res.json({ user, token: startSession(user), unread: countUnread(user.id) });
});

app.post("/api/logout", (req, res) => {
  const session = currentSession(req);
  if (session) deleteSession(session.tokenHash);
  res.status(204).end();
});

// A profile lives at /u/<name> and an item at /i/<id>, so no name can shadow
// one of rab's own pages; these are refused only so nobody can pass for the site.
const RESERVED_NAMES = new Set(["rab", "admin", "support", "login", "mine"]);

app.post("/api/users", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const fault = usernameFault(username);
  if (fault) return res.status(400).json(fault);
  const password = usablePassword(req.body?.password);
  if (!password) return res.status(400).json({ error: PASSWORD_HINT, code: "PASSWORD_INVALID" });
  if (RESERVED_NAMES.has(username)) return res.status(409).json({ error: "That username is not available" });
  if (getUser(username)) return res.status(409).json({ error: "That username is taken", code: "USER_EXISTS" });
  const user = createUser(username, password);
  res.status(201).json({ user, token: startSession(user), unread: 0 });
});

// Who somebody is: when they joined and what they have out for rent.
app.get("/api/users/:username", (req, res) => {
  const user = getUser(normalizeUsername(req.params.username));
  if (!user) return res.status(404).json({ error: "No such user" });
  res.json({
    user: { username: user.username, createdAt: user.createdAt },
    items: getItemsByUser(user.id, { publicOnly: true }).map(publicItem),
  });
});

/* -------------------------------------------------------------------- items */

// What goes out about an item to anybody: everything on its page except the
// owner's row id, which is nobody's business.
function publicItem(item) {
  const { ownerId, ...rest } = item;
  return rest;
}

function parseNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function parsePrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const price = parseNumber(value, 0, PRICE_MAX);
  return price === null ? null : Math.round(price * 100) / 100;
}

// The photographs an item is asking to carry, as the names of files this server
// stored. A name it did not write, or one whose file is gone, is refused rather
// than kept as a picture that will not load.
function parseImages(value) {
  if (!Array.isArray(value) || value.length > IMAGES_MAX) return null;
  const images = [];
  for (const entry of value) {
    const name = String(entry?.name ?? entry?.src ?? "").split("/").pop();
    const thumb = String(entry?.thumb ?? "").split("/").pop() || name;
    if (!isStoredName(name) || !isStoredName(thumb)) return null;
    if (!imageFile(name) || !imageFile(thumb)) return null;
    images.push({
      name,
      thumb,
      width: parseNumber(entry?.width, 1, 20000),
      height: parseNumber(entry?.height, 1, 20000),
    });
  }
  return images;
}

// An area, as the form sends it: what it is called, the line saying where that
// is, and its box as [west, south, east, north]. Null where any of it is
// missing or out of range.
function parseRegion(value) {
  const name = text(value?.name, REGION_MAX);
  const bbox = Array.isArray(value?.bbox) && value.bbox.length === 4 ? value.bbox : null;
  if (!name || !bbox) return null;
  const west = parseNumber(bbox[0], -180, 180);
  const south = parseNumber(bbox[1], -90, 90);
  const east = parseNumber(bbox[2], -180, 180);
  const north = parseNumber(bbox[3], -90, 90);
  if (west === null || south === null || east === null || north === null || south > north) return null;
  const round = (number) => Math.round(number * 1e5) / 1e5;
  return { name, detail: text(value?.detail, REGION_MAX), bbox: [west, south, east, north].map(round) };
}

// A whole item, as the form sends it. Returns the fields or a sentence about
// what is wrong with them.
function parseItem(body, { regionOptional = false } = {}) {
  const title = text(body?.title, TITLE_MAX);
  if (!title) return { error: "An item needs a name" };
  // The area it is offered in, which every item says — it is what lists an
  // item for the people looking there, and the only place an item without a
  // pin has.
  const region = parseRegion(body?.region);
  if (!region && !regionOptional) {
    return { error: "Say which area it is offered in", code: "REGION_REQUIRED" };
  }
  const kind = KINDS.has(body?.kind) ? body.kind : "item";
  const category = CATEGORY_RE.test(String(body?.category ?? "")) ? String(body?.category ?? "") : "";
  const currency = String(body?.currency ?? "");
  if (!CURRENCIES.has(currency)) return { error: "Unsupported currency" };

  // The rules that price it. A request from before there were any — a bare
  // price — is one rule: that price, every day.
  const mode = MODES.has(body?.mode) ? body.mode : "day";
  const sent = Array.isArray(body?.rates) && body.rates.length > 0 ? body.rates : [{ price: body?.price }];
  const parsed = parseRates(mode, sent, PRICE_MAX);
  if (parsed.error) return { error: parsed.error };
  // The hours it can be had, which only an item booked by the time has.
  const hours = mode === "time" ? parseHours(body?.hours) : { hours: [] };
  if (hours.error) return { error: hours.error, code: hours.code };

  // Where it is, which is optional: a service has no doorway, and not every
  // owner wants a pin on their street. Both numbers or neither.
  const latitude = body?.latitude == null ? null : parseNumber(body.latitude, -90, 90);
  const longitude = body?.longitude == null ? null : parseNumber(body.longitude, -180, 180);
  const located = latitude !== null && longitude !== null;

  const images = parseImages(body?.images ?? []);
  if (!images) return { error: "One of the photos could not be found" };
  return {
    item: {
      title,
      description: text(body?.description, DESCRIPTION_MAX),
      kind,
      category,
      mode,
      rates: parsed.rates,
      hours: hours.hours,
      price: listPrice(mode, parsed.rates),
      currency,
      located,
      latitude: located ? Math.round(latitude * 1e6) / 1e6 : 0,
      longitude: located ? Math.round(longitude * 1e6) / 1e6 : 0,
      place: located ? text(body?.place, PLACE_MAX) || null : null,
      region,
      images,
      active: body?.active !== false,
    },
  };
}

// The days the owner has closed, as the form's calendar sends them: the whole
// list, from today on. What is in it is closed; what was closed and is not in
// it any more is open again. A day somebody already has is left as it is.
function applyClosed(item, closed) {
  if (!Array.isArray(closed)) return;
  const from = earliestDay();
  const until = addDays(from, CALENDAR_DAYS);
  const wanted = new Set(closed.filter((day) => isDay(day) && day >= from && day <= until));
  const current = getDays(item.id, from);
  const reopen = current.filter((day) => !day.available && !wanted.has(day.day)).map((day) => day.day);
  const already = new Set(current.filter((day) => !day.available).map((day) => day.day));
  const close = [...wanted].filter(
    (day) => !already.has(day) && overlapping(item.id, "confirmed", day, day).length === 0,
  );
  if (reopen.length > 0) setDays(item.id, reopen, { available: true, price: null });
  if (close.length > 0) setDays(item.id, close, { available: false, price: null });
}

// The items inside the window of the map somebody is looking at.
app.get("/api/items", (req, res) => {
  const south = parseNumber(req.query.south, -90, 90);
  const north = parseNumber(req.query.north, -90, 90);
  const west = parseNumber(req.query.west, -180, 180);
  const east = parseNumber(req.query.east, -180, 180);
  if (south === null || north === null || west === null || east === null || south > north) {
    return res.status(400).json({ error: "Invalid bounds" });
  }
  res.json({ items: getItemsInBox({ south, north, west, east }).map(publicItem) });
});

// The items offered at a spot: every one whose area has it inside, whether or
// not the item has a pin of its own. The list beside the map.
app.get("/api/items/at", (req, res) => {
  const latitude = parseNumber(req.query.latitude, -90, 90);
  const longitude = parseNumber(req.query.longitude, -180, 180);
  if (latitude === null || longitude === null) return res.status(400).json({ error: "Invalid spot" });
  // The box of the area the spot is in, where the browser knows it: items with
  // a pin inside it are listed too.
  const box = {
    south: req.query.south == null ? null : parseNumber(req.query.south, -90, 90),
    north: req.query.north == null ? null : parseNumber(req.query.north, -90, 90),
    west: req.query.west == null ? null : parseNumber(req.query.west, -180, 180),
    east: req.query.east == null ? null : parseNumber(req.query.east, -180, 180),
  };
  const whole = Object.values(box).every((edge) => edge !== null) && box.south <= box.north;
  res.json({ items: getItemsAt(latitude, longitude, whole ? box : null).map(publicItem) });
});

// Items by what they say about themselves, for the box in the top bar.
app.get("/api/search", (req, res) => {
  const query = text(req.query.q, 60);
  if (query.length < 1) return res.json({ items: [] });
  res.json({ items: searchItems(query).map(publicItem) });
});

// Which country the request comes from, for where the map opens and where its
// search looks when the browser will not say where it is (see region.js).
app.get("/api/region", async (req, res) => {
  res.json(await lookupRegion(String(req.ip ?? "")));
});

// An item's page: the item, its calendar, and — to the two people a rental is
// between — where things stand. A stranger sees which days are taken; the
// renter also sees their own requests; the owner sees all of them.
function itemAnswer(item, viewer) {
  const from = earliestDay();
  const mine = Boolean(viewer && viewer.id === item.ownerId);
  return {
    item: { ...publicItem(item), mine },
    calendar: {
      from,
      until: addDays(from, CALENDAR_DAYS),
      days: getDays(item.id, from),
      taken: getTaken(item.id, from),
    },
    bookings: (!viewer
      ? []
      : mine
        ? getBookingsForItem(item.id)
        : getBookingsForItemByRenter(item.id, viewer.id)
    ).map((booking) => bookingFor(viewer, booking)),
  };
}

app.get("/api/items/:id", (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: "No such item", code: "ITEM_NOT_FOUND" });
  res.json(itemAnswer(item, req.user));
});

app.post("/api/items", requireSession, (req, res) => {
  const parsed = parseItem(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error, code: parsed.code });
  const item = createItem(req.user.id, parsed.item);
  applyClosed(item, req.body?.closed);
  res.status(201).json({ item: { ...publicItem(item), mine: true } });
});

function ownItem(req, res) {
  const item = getItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: "No such item", code: "ITEM_NOT_FOUND" });
    return null;
  }
  if (item.ownerId !== req.user.id) {
    res.status(403).json({ error: "That is not your item" });
    return null;
  }
  return item;
}

app.patch("/api/items/:id", requireSession, (req, res) => {
  const current = ownItem(req, res);
  if (!current) return;
  // A patch: whatever the request leaves out stays as it was, so switching an
  // item off does not have to resend its photographs.
  const stored = {
    ...current,
    images: getItemImages(current.id),
  };
  // An item from before areas were asked for has none, and is not made to
  // find one just to be switched off: it is asked for when the form sends one.
  const parsed = parseItem({ ...stored, ...req.body }, { regionOptional: !current.region && !("region" in (req.body ?? {})) });
  if (parsed.error) return res.status(400).json({ error: parsed.error, code: parsed.code });
  const item = updateItem(req.user.id, current.id, parsed.item);
  applyClosed(item, req.body?.closed);
  res.json({ item: { ...publicItem(item), mine: true } });
});

app.delete("/api/items/:id", requireSession, (req, res) => {
  const item = ownItem(req, res);
  if (!item) return;
  // Whatever was still open on it is closed with it, and said so to whoever
  // was waiting on an answer.
  transaction(() => {
    for (const booking of getBookingsForItem(item.id)) {
      if (booking.status !== "pending" && booking.status !== "confirmed") continue;
      setBookingStatus(booking.id, "cancelled");
      createMessage(req.user.id, booking.renterId, "", { kind: "cancelled", bookingId: booking.id });
    }
    deleteItem(req.user.id, item.id);
  });
  res.status(204).end();
});

/* ----------------------------------------------------------------- calendar */

// The owner's answer about a handful of days: whether they can be had, and
// optionally what they cost. `price: null` puts them back to the item's own.
app.put("/api/items/:id/days", requireSession, (req, res) => {
  const item = ownItem(req, res);
  if (!item) return;
  const days = Array.isArray(req.body?.days) ? [...new Set(req.body.days)] : [];
  if (days.length === 0 || days.length > CALENDAR_DAYS || !days.every(isDay)) {
    return res.status(400).json({ error: "Invalid days" });
  }
  const available = req.body?.available !== false;
  const price = parsePrice(req.body?.price);
  if (req.body?.price != null && req.body.price !== "" && price === null) {
    return res.status(400).json({ error: "Invalid price" });
  }
  // A day somebody already has cannot be closed from under them: the booking
  // is cancelled first, which tells them, and then the day is free to close.
  if (!available) {
    const clash = days.find((day) => overlapping(item.id, "confirmed", day, day).length > 0);
    if (clash) {
      return res.status(409).json({ error: `${clash} is already booked`, code: "DAY_BOOKED", day: clash });
    }
  }
  setDays(item.id, days, { available, price: available ? price : null });
  res.json(itemAnswer(item, req.user));
});

/* ----------------------------------------------------------------- bookings */

function bookingFor(viewer, booking) {
  const { renterId, ownerId, ...rest } = booking;
  return { ...rest, mine: renterId === viewer.id, owned: ownerId === viewer.id };
}

// Asking for an item: from one day to another where it is booked by the date,
// or for a stretch of one day's hours where it is booked by the time. Nothing
// is taken off the calendar by asking — only the owner saying yes does that —
// so two people can ask for the same week and the owner chooses.
app.post("/api/items/:id/bookings", requireSession, (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: "No such item", code: "ITEM_NOT_FOUND" });
  if (item.ownerId === req.user.id) return res.status(400).json({ error: "You cannot rent your own item" });
  if (!item.active) return res.status(409).json({ error: "This item is not available", code: "ITEM_INACTIVE" });

  const bySlot = item.mode === "time";
  const start = req.body?.start;
  const end = bySlot ? start : req.body?.end;
  if (!isDay(start) || !isDay(end) || start > end) return res.status(400).json({ error: "Invalid dates" });
  const from = earliestDay();
  if (start < from || end > addDays(from, CALENDAR_DAYS)) {
    return res.status(400).json({ error: "Those dates are outside the calendar" });
  }
  const days = daysBetween(start, end);
  if (days.length > BOOKING_MAX_DAYS) {
    return res.status(400).json({ error: `A rental is at most ${BOOKING_MAX_DAYS} days` });
  }

  // A rental counted in days also says its hours: when it is picked up on the
  // first day and when it comes back on the last. They are what the two sides
  // meet by; the days are still taken and priced whole.
  const startTime = bySlot ? null : req.body?.startTime;
  const endTime = bySlot ? null : req.body?.endTime;
  if (!bySlot) {
    if (!isTime(startTime) || !isTime(endTime)) {
      return res.status(400).json({ error: "Pick a pickup and a return time", code: "TIME_REQUIRED" });
    }
    if (start === end && startTime >= endTime) {
      return res.status(400).json({ error: "The return time must be after the pickup time", code: "TIME_ORDER" });
    }
  }

  // The hours asked for, on the half hour and inside the hours the item has
  // that day — priced by the item's own rules rather than the request's.
  let slots = null;
  if (bySlot) {
    const from = String(req.body?.startTime ?? "");
    const until = String(req.body?.endTime ?? "");
    const price = timeQuote(item, start, from, until);
    if (price === null) {
      return res.status(400).json({ error: "Pick hours it can be booked for", code: "TIME_UNAVAILABLE" });
    }
    slots = [{ start: from, end: until, price }];
  }

  try {
    const booking = transaction(() => {
      const overrides = new Map(getDaysBetween(item.id, start, end).map((day) => [day.day, day]));
      if (days.some((day) => overrides.get(day)?.available === false)) return { code: "DAYS_UNAVAILABLE" };
      if (overlapping(item.id, "confirmed", start, end, { slots }).length > 0) return { code: "DAYS_UNAVAILABLE" };
      if (hasOwnOverlap(item.id, req.user.id, start, end, slots)) return { code: "ALREADY_REQUESTED" };
      const total = bySlot
        ? slots.reduce((sum, slot) => sum + slot.price, 0)
        : days.reduce((sum, day) => sum + (overrides.get(day)?.price ?? dayPrice(item, day)), 0);
      const created = createBooking({
        itemId: item.id,
        renterId: req.user.id,
        start,
        end,
        total: Math.round(total * 100) / 100,
        currency: item.currency,
        note: text(req.body?.note, NOTE_MAX),
        slots,
        startTime,
        endTime,
      });
      // The request is also a line in the conversation with the owner, which is
      // what puts the dot on their envelope.
      createMessage(req.user.id, item.ownerId, created.note ?? "", { kind: "request", bookingId: created.id });
      return { created };
    });
    if (booking.code === "DAYS_UNAVAILABLE") {
      return res.status(409).json({ error: "Some of that is no longer available", code: booking.code });
    }
    if (booking.code === "ALREADY_REQUESTED") {
      return res.status(409).json({ error: "You have already asked for that", code: booking.code });
    }
    res.status(201).json({ booking: bookingFor(req.user, booking.created), ...itemAnswer(item, req.user) });
  } catch (error) {
    console.error("booking failed", error);
    res.status(500).json({ error: "Could not make the booking" });
  }
});

// What became of a request. The owner confirms or declines a pending one;
// either side may cancel one that is pending or confirmed.
app.patch("/api/bookings/:id", requireSession, (req, res) => {
  const id = Number(req.params.id);
  const booking = Number.isSafeInteger(id) ? getBooking(id) : null;
  if (!booking) return res.status(404).json({ error: "No such booking" });
  const isOwner = booking.ownerId === req.user.id;
  const isRenter = booking.renterId === req.user.id;
  if (!isOwner && !isRenter) return res.status(404).json({ error: "No such booking" });

  const status = String(req.body?.status ?? "");
  const allowed =
    (status === "confirmed" && isOwner && booking.status === "pending") ||
    (status === "declined" && isOwner && booking.status === "pending") ||
    (status === "cancelled" && (booking.status === "pending" || booking.status === "confirmed"));
  if (!allowed) return res.status(409).json({ error: "That booking cannot be changed that way", code: "BAD_STATUS" });

  const other = isOwner ? booking.renterId : booking.ownerId;
  const result = transaction(() => {
    if (status === "confirmed") {
      const taking = { exceptId: booking.id, slots: booking.slots };
      if (overlapping(booking.itemId, "confirmed", booking.start, booking.end, taking).length > 0) {
        return { code: "DAYS_UNAVAILABLE" };
      }
      // Saying yes to one request for a week is saying no to the others for it.
      for (const rival of overlapping(booking.itemId, "pending", booking.start, booking.end, taking)) {
        setBookingStatus(rival.id, "declined");
        createMessage(req.user.id, rival.renterId, "", { kind: "declined", bookingId: rival.id });
      }
    }
    const updated = setBookingStatus(booking.id, status);
    createMessage(req.user.id, other, "", { kind: status, bookingId: booking.id });
    return { updated };
  });
  if (result.code) {
    return res.status(409).json({ error: "Those days have already been booked", code: result.code });
  }
  res.json({ booking: bookingFor(req.user, result.updated) });
});

// Everything that is this account's: what it has out for rent, who has asked
// for any of it, and what it has asked for itself.
app.get("/api/mine", requireSession, (req, res) => {
  res.json({
    items: getItemsByUser(req.user.id).map(publicItem),
    requests: getBookingsForOwner(req.user.id).map((booking) => bookingFor(req.user, booking)),
    bookings: getBookingsByRenter(req.user.id).map((booking) => bookingFor(req.user, booking)),
  });
});

/* ----------------------------------------------------------------- messages */

app.get("/api/unread", requireSession, (req, res) => {
  res.json({ unread: countUnread(req.user.id) });
});

app.get("/api/messages", requireSession, (req, res) => {
  res.json({ conversations: getThreads(req.user.id), unread: countUnread(req.user.id) });
});

function messageTarget(req, res) {
  const target = getUser(normalizeUsername(req.params.username));
  if (!target) {
    res.status(404).json({ error: "No such user" });
    return null;
  }
  if (target.id === req.user.id) {
    res.status(400).json({ error: "You cannot message yourself" });
    return null;
  }
  return target;
}

// One exchange, oldest first — and asking for it is what marks it read. The
// open sheet repeats this every few seconds, so a line that arrives in front of
// a reader is read by the same request that brought it.
app.get("/api/messages/:username", requireSession, (req, res) => {
  const target = messageTarget(req, res);
  if (!target) return;
  readConversation(req.user.id, target.id);
  res.json({
    user: { username: target.username },
    messages: getConversation(req.user.id, target.id),
    unread: countUnread(req.user.id),
  });
});

app.post("/api/messages/:username", requireSession, (req, res) => {
  const target = messageTarget(req, res);
  if (!target) return;
  const body = String(req.body?.body ?? "").trim().normalize("NFC");
  if (!body) return res.status(400).json({ error: "Write something" });
  if (body.length > MESSAGE_MAX) {
    return res.status(400).json({ error: `A message is at most ${MESSAGE_MAX} characters` });
  }
  res.status(201).json({ message: createMessage(req.user.id, target.id, body) });
});

app.delete("/api/messages/:username", requireSession, (req, res) => {
  const target = messageTarget(req, res);
  if (!target) return;
  deleteConversation(req.user.id, target.id);
  res.status(204).end();
});

/* ------------------------------------------------------------------- images */

// The bytes arrive already compressed to WebP by the browser, which keeps rab
// free of an image library and the wire free of an 8 MB phone photo.
app.post(
  "/api/images",
  requireSession,
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  async (req, res, next) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "The image is empty" });
    }
    try {
      const stored = await storeImage(req.body);
      if (!stored) return res.status(415).json({ error: "Unsupported image format" });
      res.json(stored);
    } catch (error) {
      next(error);
    }
  },
);

// Public, because what they are pictures of is: an item's page is the thing
// that gets shared, and a plain <img> has nowhere to put a session.
app.get("/api/images/:name", (req, res) => {
  const file = imageFile(req.params.name);
  if (!file) return res.status(404).json({ error: "No such image" });
  res.sendFile(file.path, {
    headers: {
      "Content-Type": file.type,
      // Content-addressed, so the bytes behind a name never change.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

/* -------------------------------------------------------------------- pages */

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// An item's page is what gets pasted into a chat, and a chat app reads the
// page's head rather than running it. So the one page with something to say
// about itself is served with it already said: the item's name, its price and
// its first photograph.
function sharePage(html, req, item) {
  const origin = `${req.protocol}://${req.get("host")}`;
  const title = `${item.title} — rab`;
  const price = `${item.price} ${item.currency}`;
  const description = [price, item.place, item.description]
    .filter(Boolean)
    .join(" · ")
    .replace(/\s+/g, " ")
    .slice(0, 200);
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(`${origin}/i/${item.id}`)}" />`,
    item.images[0] ? `<meta property="og:image" content="${escapeHtml(origin + item.images[0].src)}" />` : "",
    `<meta name="twitter:card" content="${item.images[0] ? "summary_large_image" : "summary"}" />`,
  ];
  return html.replace("<title>rab</title>", tags.filter(Boolean).join("\n    "));
}

if (isProduction) {
  const indexPath = path.join(dist, "index.html");
  app.use(express.static(dist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    const shared = /^\/i\/([a-z0-9]{1,32})\/?$/.exec(req.path);
    const item = shared ? getItem(shared[1]) : null;
    if (!item) return res.sendFile(indexPath);
    fs.readFile(indexPath, "utf8", (error, html) => {
      if (error) return next(error);
      res.type("html").send(sharePage(html, req, item));
    });
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.use((error, req, res, _next) => {
  if (res.headersSent) return;
  if (error?.type === "entity.too.large") return res.status(413).json({ error: "File too large" });
  if (error?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request" });
  console.error(error);
  res.status(500).json({ error: "Server error" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`rab listening on:`);
  console.log(`  Local:   http://localhost:${port}`);
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface?.family === "IPv4" && !iface.internal) {
      console.log(`  Network: http://${iface.address}:${port}`);
    }
  }
});
