import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { nameFolders, readList, removeUserDir, renameNumberedFolders, userFolders, writeList } from "./files.js";
import { moveIntoFolders } from "./migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = process.env.RAB_DB || path.resolve(__dirname, "..", "db.sqlite");

// The database holds who has an account and who is signed in, and that is all.
// What an account has — its items, its bookings, its messages, its photographs
// — is in its own folder, data/users/<username>/ (see files.js). All of it is read
// into memory when the server starts and written back, a file at a time, as it
// changes; so one server process owns the folders, and a file edited by hand is
// picked up at the next start.
export const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- An account is a name and a password. The name is what its folder is
  -- called; the id is what everything in the folders points at: an item's owner, a booking's
  -- renter, the other end of a message.
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    -- The password itself, as it was typed (see passwordMatches).
    password TEXT NOT NULL,
    bio TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Only the digest of a session token is kept: enough to find the account when
  -- the token comes back, and not a usable credential to whoever reads the file.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
`);

// An account has an address too, from when one was first asked for at sign-up:
// proved by a code sent to it, and one account to an address. Accounts older
// than that have none. Added to a table that already exists, once.
if (!db.prepare("PRAGMA table_info(users)").all().some((column) => column.name === "email")) {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email COLLATE NOCASE) WHERE email IS NOT NULL");

// The folders are named after usernames, and only the database knows which
// username is which id.
{
  const nameById = db.prepare("SELECT username FROM users WHERE id = ?");
  const idByName = db.prepare("SELECT id FROM users WHERE username = ?");
  nameFolders({
    nameOf: (id) => nameById.get(id)?.username ?? null,
    idOf: (username) => idByName.get(username)?.id ?? null,
  });
}

// A database from when it held everything is moved into the folders, once; and
// folders from when they were named after ids are given their usernames, once.
moveIntoFolders(db, databasePath);
renameNumberedFolders();

const now = () => new Date().toISOString();

/* ------------------------------------------------------------------- users */

// A password is kept as it was typed, so whoever looks after the server can
// read one and write one straight into the table. Anybody who can read the
// database file can therefore read every password in it.
//
// One kept from when they were hashed — scrypt$<salt>$<hash> — is still
// answered to, so an account made then can still sign in; it is written plain
// the next time it is set.
function passwordMatches(password, stored) {
  const kept = String(stored ?? "");
  const [scheme, salt, hash] = kept.split("$");
  const expected = Buffer.from(scheme === "scrypt" && salt && hash ? hash : kept);
  const given = Buffer.from(
    scheme === "scrypt" && salt && hash ? crypto.scryptSync(password, salt, 32).toString("base64url") : String(password),
  );
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

const USER_COLUMNS = "id, username, created_at AS createdAt";
const selectUser = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username = ?`);
const selectUserById = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`);
const selectPassword = db.prepare("SELECT password FROM users WHERE username = ?");
const insertUser = db.prepare("INSERT INTO users (username, password, email) VALUES (?, ?, ?)");
const selectByEmail = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE");

export function getUser(username) {
  return selectUser.get(username) ?? null;
}

export function getUserById(id) {
  return selectUserById.get(id) ?? null;
}

// `email` is the address the account was opened with, or null for one made
// by whoever looks after the server (see cli.js), which asks for none.
export function createUser(username, password, email = null) {
  insertUser.run(username, String(password), email);
  return getUser(username);
}

// Whether an address already has an account.
export function emailTaken(email) {
  return Boolean(selectByEmail.get(email));
}

// Every account, oldest first: for whoever looks after the server (see cli.js).
const selectUsers = db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY id`);
export function listUsers() {
  return selectUsers.all();
}

// A new password for an account, set by whoever looks after the server. The
// account is signed out everywhere: whoever was in on the old one is not in on
// the new one.
const updatePassword = db.prepare("UPDATE users SET password = ? WHERE id = ?");
const deleteSessionsOf = db.prepare("DELETE FROM sessions WHERE user_id = ?");
export function setPassword(userId, password) {
  updatePassword.run(String(password), userId);
  deleteSessionsOf.run(userId);
}

export function checkPassword(username, password) {
  const row = selectPassword.get(username);
  return row ? passwordMatches(password, row.password) : false;
}

/* ---------------------------------------------------------------- sessions */

const insertSession = db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)");
const selectSession = db.prepare(`
  SELECT s.user_id AS userId, s.expires_at AS expiresAt, u.username
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ?
`);
const deleteSessionRow = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
const touchSessionRow = db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?");
const deleteExpired = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");

export const saveSession = (hash, userId, expiresAt) => insertSession.run(hash, userId, expiresAt);
export const getSession = (hash) => selectSession.get(hash) ?? null;
export const deleteSession = (hash) => deleteSessionRow.run(hash);
export const touchSession = (hash, expiresAt) => touchSessionRow.run(expiresAt, hash);
export const deleteExpiredSessions = (time) => deleteExpired.run(time);

/* ----------------------------------------------------------------- folders */

// Everything in the users' folders, as it is held while the server runs.
//
// An item is in its owner's items.json and nowhere else. A booking is between
// two accounts and is in both their bookings.json, the same on each side. A
// line of a conversation is in the messages.json of each end separately, as
// that end sees it — `with` the other account, `mine` or not — so deleting a
// conversation takes it out of one folder and leaves the other's alone.
const itemsById = new Map();
const bookingsById = new Map();
const messagesByUser = new Map();
let lastBookingId = 0;
let lastMessageId = 0;

function linesOf(userId) {
  if (!messagesByUser.has(userId)) messagesByUser.set(userId, []);
  return messagesByUser.get(userId);
}

// An item booked by the time, from when its prices were for an hour and it was
// booked by the half hour: it has neither written down, and is read as both.
function perUnit(item) {
  if (item.mode !== "time" || item.unit != null) return item;
  return { ...item, unit: 30, priceUnit: 60 };
}

function load() {
  itemsById.clear();
  bookingsById.clear();
  messagesByUser.clear();
  for (const userId of userFolders()) {
    for (const item of readList(userId, "items.json")) itemsById.set(item.id, { ...perUnit(item), ownerId: userId });
    // Both sides hold the booking; should the two ever differ, the one changed
    // last is the one that is right.
    for (const booking of readList(userId, "bookings.json")) {
      const known = bookingsById.get(booking.id);
      if (!known || booking.updatedAt > known.updatedAt) bookingsById.set(booking.id, booking);
    }
    messagesByUser.set(userId, readList(userId, "messages.json"));
  }
  lastBookingId = Math.max(0, ...bookingsById.keys());
  lastMessageId = 0;
  for (const lines of messagesByUser.values()) {
    for (const line of lines) lastMessageId = Math.max(lastMessageId, line.id);
  }
}

// What has changed and is not on disk yet, as "<user id>/<file>".
const unsaved = new Set();
let depth = 0;

function changed(userId, file) {
  unsaved.add(`${userId}/${file}`);
}

function save() {
  for (const entry of unsaved) {
    const [id, file] = entry.split("/");
    const userId = Number(id);
    if (file === "items.json") {
      const items = [...itemsById.values()]
        .filter((item) => item.ownerId === userId)
        .map(({ ownerId, ...item }) => item);
      writeList(userId, file, items);
    } else if (file === "bookings.json") {
      const bookings = [...bookingsById.values()].filter(
        (booking) => booking.ownerId === userId || booking.renterId === userId,
      );
      writeList(userId, file, bookings);
    } else {
      writeList(userId, file, linesOf(userId));
    }
    unsaved.delete(entry);
  }
}

// Everything that touches more than one thing and must not half-happen: the
// files are written when the work is done, and if it throws nothing is written
// and what is in memory is put back to what the files say.
export function transaction(work) {
  depth += 1;
  try {
    const result = work();
    depth -= 1;
    if (depth === 0) save();
    return result;
  } catch (error) {
    depth = Math.max(0, depth - 1);
    if (depth === 0) {
      unsaved.clear();
      load();
    }
    throw error;
  }
}

load();

const nameOf = (userId) => selectUserById.get(userId)?.username ?? null;
const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
const highestFirst = (a, b) => b.id - a.id;

/* ------------------------------------------------------------------- items */

const imageUrl = (name) => (name ? `/api/images/${name}` : null);

// An item as it goes out: the photographs as addresses a browser can ask for,
// and the first of them named once more as the one a list or a pin draws.
function servedItem(item) {
  if (!item) return null;
  const images = (item.images ?? []).map((image) => ({
    src: imageUrl(image.name),
    thumb: imageUrl(image.thumb || image.name),
    width: image.width ?? null,
    height: image.height ?? null,
  }));
  const located = item.located === true;
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    price: item.price,
    currency: item.currency,
    latitude: located ? item.latitude : null,
    longitude: located ? item.longitude : null,
    place: item.place ?? null,
    // The area it is offered in, with its box as [west, south, east, north].
    region: item.region ?? null,
    images,
    // The first photograph is the main one: what a list row and a pin draw.
    thumb: images[0]?.thumb ?? null,
    active: item.active === true,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    kind: item.kind,
    category: item.category,
    mode: item.mode,
    // An item from before there were rules has one: its price, every day.
    rates: item.rates?.length > 0 ? item.rates : [{ price: item.price, days: null }],
    hours: item.hours ?? [],
    // The piece of the clock it is booked in, in minutes, where it is booked
    // by the time: half an hour for an item from before there was a choice.
    unit: item.unit ?? 30,
    // The stretch of the clock a price is for, in minutes: the booking unit
    // where the item says none.
    priceUnit: item.priceUnit ?? item.unit ?? 30,
    // When a confirmed booking may still be called off by whoever made it:
    // { mode: "any" | "none" | "days", days }. Any time, where nothing is said.
    cancel: item.cancel ?? { mode: "any" },
    // The rule for days — which days of the week it can be had, null for all —
    // and the dates whose hours the owner wiped.
    openDays: item.openDays ?? null,
    hoursOff: item.hoursOff ?? [],
    // The dates the owner gave a price of their own, from yesterday on (a
    // reader west of the server's UTC is still in it): what a list needs to
    // say what the item costs today without asking for its whole calendar.
    dayPrices: Object.fromEntries(
      (item.days ?? [])
        .filter((day) => day.available && day.price != null && day.day >= new Date(Date.now() - 86_400_000).toISOString().slice(0, 10))
        .map((day) => [day.day, day.price]),
    ),
    located,
    ownerId: item.ownerId,
    owner: nameOf(item.ownerId),
  };
}

// The items anybody may be shown, newest first.
function listedItems() {
  return [...itemsById.values()].filter((item) => !item.deletedAt && item.active).sort(newestFirst);
}

// Whether a longitude is between two edges, where a box that crosses the
// antimeridian has its west edge east of its east edge.
function between(longitude, west, east) {
  return west <= east ? longitude >= west && longitude <= east : longitude >= west || longitude <= east;
}

function liveItem(id) {
  const item = itemsById.get(id);
  return item && !item.deletedAt ? item : null;
}

export function getItem(id) {
  return servedItem(liveItem(id));
}

// Words typed into the bar at the top: matched anywhere in what an item says
// about itself, the ones that have them in their name first.
export function searchItems(query, limit = 20) {
  const wanted = query.toLowerCase();
  const has = (value) => String(value ?? "").toLowerCase().includes(wanted);
  const found = listedItems().filter(
    (item) => has(item.title) || has(item.description) || has(item.place) || has(item.category),
  );
  return [...found.filter((item) => has(item.title)), ...found.filter((item) => !has(item.title))]
    .slice(0, limit)
    .map(servedItem);
}

export function getItemsInBox({ south, north, west, east }, limit = 300) {
  return listedItems()
    .filter(
      (item) =>
        item.located && item.latitude >= south && item.latitude <= north && between(item.longitude, west, east),
    )
    .slice(0, limit)
    .map(servedItem);
}

// The items offered where somebody is looking: the ones whose area has that
// spot inside it, pin or no pin — and the ones whose pin stands inside the area
// being looked at, whatever area they say, which is what lists an item from
// before areas were asked for. `box` is the area being looked at, as { south,
// north, west, east }, where it is known; without one only the items' own
// areas decide.
export function getItemsAt(latitude, longitude, box = null, limit = 200) {
  return listedItems()
    .filter((item) => {
      if (item.region) {
        const [west, south, east, north] = item.region.bbox;
        if (latitude >= south && latitude <= north && between(longitude, west, east)) return true;
      }
      return Boolean(
        box &&
          item.located &&
          item.latitude >= box.south &&
          item.latitude <= box.north &&
          between(item.longitude, box.west, box.east),
      );
    })
    .slice(0, limit)
    .map(servedItem);
}

export function getItemsByUser(userId, { publicOnly = false } = {}) {
  const items = [...itemsById.values()].filter((item) => item.ownerId === userId && !item.deletedAt).sort(newestFirst);
  if (publicOnly) return items.filter((item) => item.active).map(servedItem);
  const bookings = [...bookingsById.values()];
  return items.map((item) => ({
    ...servedItem(item),
    // How many people are waiting on an answer about it.
    pending: bookings.filter((booking) => booking.itemId === item.id && booking.status === "pending").length,
  }));
}

function newItemId() {
  // 40 bits, in letters and digits nobody has to read aloud twice.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  for (;;) {
    const id = Array.from(crypto.randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join("");
    if (!itemsById.has(id)) return id;
  }
}

// What the form decides about an item, as it is kept.
function itemFields(item) {
  return {
    title: item.title,
    description: item.description,
    kind: item.kind,
    category: item.category,
    mode: item.mode,
    rates: item.rates,
    hours: item.hours ?? [],
    unit: item.unit ?? 30,
    priceUnit: item.priceUnit ?? item.unit ?? 30,
    cancel: item.cancel ?? { mode: "any" },
    openDays: item.openDays ?? null,
    hoursOff: item.hoursOff ?? [],
    price: item.price,
    currency: item.currency,
    located: Boolean(item.located),
    latitude: item.latitude,
    longitude: item.longitude,
    place: item.place ?? null,
    region: item.region ?? null,
    // {name, thumb, width, height}: file names in the owner's images folder.
    images: item.images,
  };
}

export function createItem(userId, item) {
  const id = newItemId();
  const time = now();
  transaction(() => {
    itemsById.set(id, {
      id,
      ...itemFields(item),
      // Off is an item not on the map: one taken down without being deleted,
      // or one made that way to be finished and published later (the phone's
      // are). Its page still opens for whoever holds the link, and nothing can
      // be booked.
      active: item.active !== false,
      // What the owner has said about single days: that one cannot be had, or
      // costs something other than the usual. Only the exceptions are here.
      days: [],
      createdAt: time,
      updatedAt: time,
      // Soft, so the bookings and messages that point at an item keep their
      // sentence after the item has gone.
      deletedAt: null,
      ownerId: userId,
    });
    changed(userId, "items.json");
  });
  return getItem(id);
}

export function updateItem(userId, id, item) {
  const current = liveItem(id);
  if (!current || current.ownerId !== userId) return null;
  transaction(() => {
    Object.assign(current, itemFields(item), { active: Boolean(item.active), updatedAt: now() });
    changed(userId, "items.json");
  });
  return getItem(id);
}

// The stored photo list, as file names — what an edit starts from, since the
// served item only carries addresses.
export function getItemImages(id) {
  return itemsById.get(id)?.images ?? [];
}

export function deleteItem(userId, id) {
  const current = liveItem(id);
  if (!current || current.ownerId !== userId) return false;
  transaction(() => {
    current.deletedAt = now();
    current.active = false;
    changed(userId, "items.json");
  });
  return true;
}

/* -------------------------------------------------------------------- days */

const daysOf = (itemId) => itemsById.get(itemId)?.days ?? [];

export function getDays(itemId, from) {
  return daysOf(itemId).filter((day) => day.day >= from);
}

export function getDaysBetween(itemId, start, end) {
  return daysOf(itemId).filter((day) => day.day >= start && day.day <= end);
}

// One answer for a handful of days. A day put back to available at the usual
// price is an ordinary day again, and its entry goes rather than staying behind
// to say nothing — unless it is `explicit`: a day the item's rule for days
// leaves out, opened all the same, which only its entry can say.
export function setDays(itemId, days, { available, price, explicit = false }) {
  const item = itemsById.get(itemId);
  if (!item) return;
  transaction(() => {
    const kept = new Map((item.days ?? []).map((day) => [day.day, day]));
    for (const day of days) {
      if (available && price == null && !explicit) kept.delete(day);
      else kept.set(day, { day, available: Boolean(available), price: price ?? null });
    }
    item.days = [...kept.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
    changed(item.ownerId, "items.json");
  });
}

/* ---------------------------------------------------------------- bookings */

// A request to have an item from `start` to `end`, both days included, and what
// became of it: pending until the owner answers, then confirmed or declined,
// and cancelled if either side backs out. Only a confirmed booking takes days
// off the calendar. `total` is worked out when the request is made and kept: a
// price changed afterwards does not change what was agreed to. `slots` is the
// hours it took, [{start, end, price}], where the item is booked by the time;
// `startTime` and `endTime` are the pickup and return of one counted in days.
function servedBooking(booking) {
  if (!booking) return null;
  const item = itemsById.get(booking.itemId);
  const first = item?.images?.[0];
  return {
    id: booking.id,
    itemId: booking.itemId,
    start: booking.start,
    end: booking.end,
    startTime: booking.startTime,
    endTime: booking.endTime,
    total: booking.total,
    currency: booking.currency,
    note: booking.note,
    status: booking.status,
    slots: booking.slots ?? null,
    cancel: booking.cancel ?? { mode: "any" },
    // Whether whoever made it has asked the owner to call it off.
    cancelRequested: Boolean(booking.cancelRequest),
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    renter: nameOf(booking.renterId),
    renterId: booking.renterId,
    itemTitle: item?.title ?? null,
    ownerId: booking.ownerId,
    owner: nameOf(booking.ownerId),
    itemThumb: imageUrl(first?.thumb || first?.name),
  };
}

function bookingsWhere(test, limit = 200) {
  return [...bookingsById.values()].filter(test).sort(highestFirst).slice(0, limit).map(servedBooking);
}

export const getBooking = (id) => servedBooking(bookingsById.get(id) ?? null);
export const getBookingsForItem = (itemId) => bookingsWhere((booking) => booking.itemId === itemId);
export const getBookingsForItemByRenter = (itemId, renterId) =>
  bookingsWhere((booking) => booking.itemId === itemId && booking.renterId === renterId, 50);
export const getBookingsByRenter = (renterId) => bookingsWhere((booking) => booking.renterId === renterId);
export const getBookingsForOwner = (ownerId) => bookingsWhere((booking) => booking.ownerId === ownerId);

// The days that are taken, which is all a stranger is told: no names, no notes.
export function getTaken(itemId, from) {
  return [...bookingsById.values()]
    .filter((booking) => booking.itemId === itemId && booking.status === "confirmed" && booking.end >= from)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    .map((booking) => ({ start: booking.start, end: booking.end, slots: booking.slots ?? null }));
}

// Two bookings on the same days are in each other's way — unless both are for
// slots, where they clash only if the hours do. Times are "HH:MM", which
// compare as text.
function clashes(booking, slots) {
  if (!slots || !booking.slots) return true;
  return slots.some((mine) => booking.slots.some((other) => mine.start < other.end && other.start < mine.end));
}

const onDays = (booking, itemId, start, end) =>
  booking.itemId === itemId && booking.start <= end && booking.end >= start;

export function overlapping(itemId, status, start, end, { exceptId = 0, slots = null } = {}) {
  return [...bookingsById.values()]
    .filter(
      (booking) =>
        onDays(booking, itemId, start, end) &&
        booking.status === status &&
        booking.id !== exceptId &&
        clashes(booking, slots),
    )
    .map((booking) => ({ id: booking.id, renterId: booking.renterId, status: booking.status, slots: booking.slots }));
}

export function hasOwnOverlap(itemId, renterId, start, end, slots = null) {
  return [...bookingsById.values()].some(
    (booking) =>
      onDays(booking, itemId, start, end) &&
      booking.renterId === renterId &&
      (booking.status === "pending" || booking.status === "confirmed") &&
      clashes(booking, slots),
  );
}

function bookingChanged(booking) {
  changed(booking.ownerId, "bookings.json");
  changed(booking.renterId, "bookings.json");
}

export function createBooking({
  itemId,
  renterId,
  start,
  end,
  total,
  currency,
  note,
  slots = null,
  startTime = null,
  endTime = null,
}) {
  const item = itemsById.get(itemId);
  if (!item) throw new Error(`no such item: ${itemId}`);
  const time = now();
  const booking = {
    id: lastBookingId + 1,
    itemId,
    ownerId: item.ownerId,
    renterId,
    start,
    end,
    startTime,
    endTime,
    total,
    currency,
    note: note || null,
    status: "pending",
    slots,
    // The item's rule for calling a booking off, as it stood when this one
    // was asked for: changing the rule afterwards does not change what was
    // agreed to.
    cancel: item.cancel ?? { mode: "any" },
    createdAt: time,
    updatedAt: time,
  };
  transaction(() => {
    lastBookingId = booking.id;
    bookingsById.set(booking.id, booking);
    bookingChanged(booking);
  });
  return getBooking(booking.id);
}

// Whoever made a booking asks its owner to let them out of it, where its rule
// no longer lets them call it off themselves — or the owner says no, and the
// asking is taken down. `asked` is when it was asked, or null.
export function setCancelRequest(id, asked) {
  const booking = bookingsById.get(id);
  if (!booking) return null;
  transaction(() => {
    booking.cancelRequest = asked ? now() : null;
    booking.updatedAt = now();
    bookingChanged(booking);
  });
  return getBooking(id);
}

export function setBookingStatus(id, status) {
  const booking = bookingsById.get(id);
  if (!booking) return null;
  transaction(() => {
    booking.status = status;
    // Whatever was being asked about it is answered by its changing.
    booking.cancelRequest = null;
    booking.updatedAt = now();
    bookingChanged(booking);
  });
  return getBooking(id);
}

/* ---------------------------------------------------------------- messages */

// One entry per line said, in the folder of each end. Two accounts have exactly
// one conversation between them, so `with` is the thread and there is no list
// of threads.
//
// kind is 'text' for something typed. The others — request, confirmed,
// declined, cancelled — are lines rab writes itself when a booking changes
// hands, so that everything about a rental is in the conversation it is being
// arranged in; bookingId says which one, and the client words the line.
//
// `read` is whether the one it was sent to has read it, on both copies: it is
// what the receiver's unread count goes by and what the sender is shown.
function servedMessage(line) {
  if (!line) return null;
  const booking = line.bookingId ? bookingsById.get(line.bookingId) : null;
  return {
    id: line.id,
    body: line.body,
    kind: line.kind,
    time: line.time,
    mine: line.mine === true,
    read: line.read === true,
    booking: booking
      ? {
          id: booking.id,
          start: booking.start,
          end: booking.end,
          startTime: booking.startTime,
          endTime: booking.endTime,
          status: booking.status,
          slots: booking.slots ?? null,
          itemId: booking.itemId,
          itemTitle: itemsById.get(booking.itemId)?.title ?? null,
        }
      : null,
  };
}

const unreadLine = (line) => !line.mine && !line.read;

// The inbox: the last line of every conversation this account is part of, with
// how much of it is still unread.
export function getThreads(userId, limit = 50) {
  const threads = new Map();
  for (const line of linesOf(userId)) {
    const thread = threads.get(line.with) ?? { last: line, unread: 0 };
    if (line.id >= thread.last.id) thread.last = line;
    if (unreadLine(line)) thread.unread += 1;
    threads.set(line.with, thread);
  }
  return [...threads.values()]
    .sort((a, b) => b.last.id - a.last.id)
    .slice(0, limit)
    .map(({ last, unread }) => ({ ...servedMessage(last), username: nameOf(last.with), unread }));
}

// Capped at its end rather than its beginning: a long exchange opens on the
// part of it that is still being had.
export function getConversation(userId, otherId, limit = 200) {
  return linesOf(userId)
    .filter((line) => line.with === otherId)
    .sort((a, b) => a.id - b.id)
    .slice(-limit)
    .map(servedMessage);
}

export function countUnread(userId) {
  return linesOf(userId).filter(unreadLine).length;
}

// Marks what `userId` was sent by `otherId` as read, in both folders. Writes
// nothing where nothing was unread — an open conversation asks every few
// seconds.
export function readConversation(userId, otherId) {
  const fresh = new Set(
    linesOf(userId)
      .filter((line) => line.with === otherId && unreadLine(line))
      .map((line) => line.id),
  );
  if (fresh.size === 0) return;
  transaction(() => {
    for (const line of linesOf(userId)) if (fresh.has(line.id)) line.read = true;
    changed(userId, "messages.json");
    let told = false;
    for (const line of linesOf(otherId)) {
      if (line.mine && line.with === userId && fresh.has(line.id)) {
        line.read = true;
        told = true;
      }
    }
    if (told) changed(otherId, "messages.json");
  });
}

export function createMessage(fromId, toId, body, { kind = "text", bookingId = null } = {}) {
  // The clock, so a number is never handed out twice even after both ends have
  // deleted the lines that carried the highest ones.
  lastMessageId = Math.max(Date.now(), lastMessageId + 1);
  const line = { id: lastMessageId, body, kind, bookingId, time: now(), read: false };
  const sent = { ...line, with: toId, mine: true };
  transaction(() => {
    linesOf(fromId).push(sent);
    linesOf(toId).push({ ...line, with: fromId, mine: false });
    changed(fromId, "messages.json");
    changed(toId, "messages.json");
  });
  return servedMessage(sent);
}

// A conversation deleted from an inbox goes from that side's folder only. What
// had not been read yet counts as read on the way out, so the other end is not
// left waiting on it.
export function deleteConversation(userId, otherId) {
  transaction(() => {
    const dropped = new Set(
      linesOf(userId)
        .filter((line) => line.with === otherId && unreadLine(line))
        .map((line) => line.id),
    );
    for (const line of linesOf(otherId)) {
      if (line.mine && line.with === userId && dropped.has(line.id)) {
        line.read = true;
        changed(otherId, "messages.json");
      }
    }
    messagesByUser.set(
      userId,
      linesOf(userId).filter((line) => line.with !== otherId),
    );
    changed(userId, "messages.json");
  });
}

/* --------------------------------------------------------------- locations */

// The places an account keeps to put its items at — "Home", "The studio": a
// name, an address and a spot on the map, and the area the spot is in. They are
// the account's own list, in its folder's locations.json, the same from the
// website and from the phone. Read and written as they are asked for: the list
// is short, and nothing else in the server points into it — an item put at a
// location carries the spot and the address itself.
const LOCATIONS_FILE = "locations.json";
export const LOCATIONS_MAX = 100;

export function getLocations(userId) {
  return readList(userId, LOCATIONS_FILE);
}

// Kept under the id it came with, where it came with one (the phone names its
// own, and its items remember them); a location sent again under an id that is
// there replaces what was there.
export function saveLocation(userId, location) {
  const list = getLocations(userId);
  const id = location.id || crypto.randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x");
  const at = list.findIndex((each) => each.id === id);
  if (at === -1 && list.length >= LOCATIONS_MAX) return null;
  const saved = { ...location, id, createdAt: at === -1 ? now() : list[at].createdAt };
  if (at === -1) list.push(saved);
  else list[at] = saved;
  writeList(userId, LOCATIONS_FILE, list);
  return saved;
}

export function deleteLocation(userId, id) {
  const list = getLocations(userId);
  const kept = list.filter((each) => each.id !== id);
  if (kept.length === list.length) return false;
  writeList(userId, LOCATIONS_FILE, kept);
  return true;
}

/* ----------------------------------------------------------------- removal */

// An account deleted outright, by whoever looks after the server: its folder —
// items, photographs, its side of every conversation — and the account itself,
// and with them what other accounts held that pointed at it: the bookings it
// was one side of, and their conversations with it. Nothing is left that names
// an account there no longer is.
//
// Not for a running server to have done to it from outside: the server holds
// the folders in memory and would write some of this back (see cli.js).
const deleteUserRow = db.prepare("DELETE FROM users WHERE id = ?");
export function deleteUser(userId) {
  const counts = { items: 0, bookings: 0, conversations: 0 };
  transaction(() => {
    for (const [id, item] of itemsById) {
      if (item.ownerId !== userId) continue;
      itemsById.delete(id);
      if (!item.deletedAt) counts.items += 1;
    }
    for (const [id, booking] of bookingsById) {
      if (booking.ownerId !== userId && booking.renterId !== userId) continue;
      bookingsById.delete(id);
      counts.bookings += 1;
      changed(booking.ownerId === userId ? booking.renterId : booking.ownerId, "bookings.json");
    }
    for (const [otherId, lines] of messagesByUser) {
      if (otherId === userId) continue;
      const kept = lines.filter((line) => line.with !== userId);
      if (kept.length === lines.length) continue;
      messagesByUser.set(otherId, kept);
      counts.conversations += 1;
      changed(otherId, "messages.json");
    }
    messagesByUser.delete(userId);
    // Its own files are not written back: the folder goes whole.
    for (const entry of [...unsaved]) if (entry.startsWith(`${userId}/`)) unsaved.delete(entry);
  });
  removeUserDir(userId);
  // The sessions go with the row (ON DELETE CASCADE).
  deleteUserRow.run(userId);
  return counts;
}
