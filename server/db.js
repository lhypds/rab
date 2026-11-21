import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = process.env.RAB_DB || path.resolve(__dirname, "..", "db.sqlite");

export const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- An account is a name and a password. The name is the address everything
  -- else hangs off: an item's owner, a booking's renter, both ends of a message.
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    -- scrypt$<salt>$<hash>, never the password itself (see hashPassword).
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

  -- Something somebody is renting out, pinned to the spot it is picked up at.
  -- The id is a short random slug rather than a counter because it is the whole
  -- of the item's public address (/i/<id>) and is meant to be passed around.
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- The price of one day, in the item's own currency. A day on the calendar
    -- may carry a price of its own (see item_days); this is every other day.
    price REAL NOT NULL,
    currency TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    place TEXT,
    -- A JSON array of {name, thumb, width, height}: file names under
    -- data/images, never bytes.
    images TEXT NOT NULL DEFAULT '[]',
    -- Off is an item taken down from the map without being deleted: its page
    -- still opens for whoever holds the link, and nothing new can be booked.
    active INTEGER NOT NULL DEFAULT 1,
    -- Soft, so the bookings and messages that point at an item keep their
    -- sentence after the item has gone.
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS items_latitude_idx ON items(latitude);
  CREATE INDEX IF NOT EXISTS items_user_idx ON items(user_id, created_at DESC);

  -- What the owner has said about one day of one item: that it cannot be had,
  -- or that it costs something other than the usual. A day with no row here is
  -- an ordinary day — available, at the item's price — so the table holds only
  -- the exceptions and an item nobody has touched the calendar of has none.
  CREATE TABLE IF NOT EXISTS item_days (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 1,
    price REAL,
    PRIMARY KEY (item_id, day)
  ) WITHOUT ROWID;

  -- A request to have an item from start_day to end_day, both included, and
  -- what became of it: pending until the owner answers, then confirmed or
  -- declined, and cancelled if either side backs out. Only a confirmed booking
  -- takes days off the calendar.
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    renter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_day TEXT NOT NULL,
    end_day TEXT NOT NULL,
    -- Worked out when the request was made and kept: a price changed on the
    -- calendar afterwards does not change what was agreed to.
    total REAL NOT NULL,
    currency TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS bookings_item_idx ON bookings(item_id, start_day);
  CREATE INDEX IF NOT EXISTS bookings_renter_idx ON bookings(renter_id, id DESC);

  -- One row per line said. Two accounts have exactly one conversation between
  -- them, so the pair of names is the thread and there is no table of threads.
  --
  -- kind is 'text' for something typed. The others — request, confirmed,
  -- declined, cancelled — are lines rab writes itself when a booking changes
  -- hands, so that everything about a rental is in the conversation it is being
  -- arranged in; booking_id says which one, and the client words the line.
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'text',
    booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    read_at TEXT,
    -- A conversation deleted from an inbox is hidden on that side only.
    hidden_from INTEGER NOT NULL DEFAULT 0,
    hidden_to INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS messages_from_idx ON messages(from_user, id DESC);
  CREATE INDEX IF NOT EXISTS messages_to_idx ON messages(to_user, id DESC);
`);

// Columns that arrived after the first schema. CREATE TABLE IF NOT EXISTS does
// nothing for a table that already exists, so each is added by hand where it is
// missing — which is every database made before the line was written, once.
function addColumn(table, column, definition) {
  const known = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!known.some((row) => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// What is being rented: a thing, a space, or somebody's time — and, inside
// that, the sort of thing it is, as a slug the browser has the words for.
addColumn("items", "kind", "TEXT NOT NULL DEFAULT 'item'");
addColumn("items", "category", "TEXT NOT NULL DEFAULT ''");
// How it is booked: by the date, or by the date and the time. And the rules
// that price it — a JSON array, read whole and written whole (see rates.js) —
// with, for one booked by the time, the hours of the week it can be had.
addColumn("items", "mode", "TEXT NOT NULL DEFAULT 'day'");
addColumn("items", "rates", "TEXT NOT NULL DEFAULT '[]'");
addColumn("items", "hours", "TEXT NOT NULL DEFAULT '[]'");
// Whether the item says where it is at all. A place is optional; latitude and
// longitude were written NOT NULL before it was, so an item without one keeps
// zeroes there and says so here.
addColumn("items", "has_location", "INTEGER NOT NULL DEFAULT 1");
// The area an item is offered in — a town, a ward, a prefecture — which every
// item says even where it has no pin: its name, the line saying where that is,
// and the box of ground it covers. An item is listed for anybody looking at a
// spot inside the box. Empty on an item from before areas were asked for.
addColumn("items", "region_name", "TEXT NOT NULL DEFAULT ''");
addColumn("items", "region_detail", "TEXT NOT NULL DEFAULT ''");
addColumn("items", "region_south", "REAL");
addColumn("items", "region_north", "REAL");
addColumn("items", "region_west", "REAL");
addColumn("items", "region_east", "REAL");
// The hours a booking took, where the item is booked by the time: a JSON array
// of {start, end, price} on the one day the booking is for. Null for a booking
// counted in days.
addColumn("bookings", "slots", "TEXT");
// The hours of a booking counted in days: when on its first day it is picked
// up and when on its last it comes back, "HH:MM" at the place the item is.
// Null for a booking by the slot, whose slots are its hours, and for one made
// before the hours were asked for.
addColumn("bookings", "start_time", "TEXT");
addColumn("bookings", "end_time", "TEXT");

const now = () => new Date().toISOString();

// Everything that touches more than one row and must not half-happen.
export function transaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/* ------------------------------------------------------------------- users */

function hashPassword(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = crypto.scryptSync(password, salt, 32).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

function passwordMatches(password, stored) {
  const [scheme, salt, hash] = String(stored ?? "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash);
  const given = Buffer.from(hashPassword(password, salt).split("$")[2]);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

const USER_COLUMNS = "id, username, created_at AS createdAt";
const selectUser = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username = ?`);
const selectUserById = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`);
const selectPassword = db.prepare("SELECT password FROM users WHERE username = ?");
const insertUser = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");

export function getUser(username) {
  return selectUser.get(username) ?? null;
}

export function getUserById(id) {
  return selectUserById.get(id) ?? null;
}

export function createUser(username, password) {
  insertUser.run(username, hashPassword(password));
  return getUser(username);
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

/* ------------------------------------------------------------------- items */

const ITEM_COLUMNS = `
  i.id, i.title, i.description, i.price, i.currency, i.latitude, i.longitude, i.place,
  i.images, i.active, i.created_at AS createdAt, i.updated_at AS updatedAt,
  i.kind, i.category, i.mode, i.rates, i.hours, i.has_location AS located,
  i.region_name AS regionName, i.region_detail AS regionDetail,
  i.region_south AS regionSouth, i.region_north AS regionNorth,
  i.region_west AS regionWest, i.region_east AS regionEast,
  i.user_id AS ownerId, u.username AS owner
`;

function readList(text) {
  try {
    const parsed = JSON.parse(text ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readImages(text) {
  try {
    const parsed = JSON.parse(text ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const imageUrl = (name) => (name ? `/api/images/${name}` : null);

// A row as it goes out: the photographs as addresses a browser can ask for, and
// the first of them named once more as the one a list or a pin draws.
function servedItem(row) {
  if (!row) return null;
  const images = readImages(row.images).map((image) => ({
    src: imageUrl(image.name),
    thumb: imageUrl(image.thumb || image.name),
    width: image.width ?? null,
    height: image.height ?? null,
  }));
  const located = row.located === 1;
  const { regionName, regionDetail, regionSouth, regionNorth, regionWest, regionEast, ...rest } = row;
  return {
    ...rest,
    // The area it is offered in, with its box as [west, south, east, north].
    region:
      regionName && regionSouth !== null
        ? { name: regionName, detail: regionDetail, bbox: [regionWest, regionSouth, regionEast, regionNorth] }
        : null,
    images,
    // The first photograph is the main one: what a list row and a pin draw.
    thumb: images[0]?.thumb ?? null,
    active: row.active === 1,
    // An item from before there were rules has one: its price, every day.
    rates: readList(row.rates).length > 0 ? readList(row.rates) : [{ price: row.price, days: null }],
    hours: readList(row.hours),
    located,
    latitude: located ? row.latitude : null,
    longitude: located ? row.longitude : null,
  };
}

const selectItem = db.prepare(`
  SELECT ${ITEM_COLUMNS} FROM items i JOIN users u ON u.id = i.user_id
  WHERE i.id = ? AND i.deleted_at IS NULL
`);
const selectItemsInBox = db.prepare(`
  SELECT ${ITEM_COLUMNS} FROM items i JOIN users u ON u.id = i.user_id
  WHERE i.deleted_at IS NULL AND i.active = 1 AND i.has_location = 1
    AND i.latitude BETWEEN ? AND ?
    AND i.longitude BETWEEN ? AND ?
  ORDER BY i.created_at DESC
  LIMIT ?
`);
// A box that crosses the antimeridian has its west edge east of its east edge.
const selectItemsAcrossDateline = db.prepare(`
  SELECT ${ITEM_COLUMNS} FROM items i JOIN users u ON u.id = i.user_id
  WHERE i.deleted_at IS NULL AND i.active = 1 AND i.has_location = 1
    AND i.latitude BETWEEN ? AND ?
    AND (i.longitude >= ? OR i.longitude <= ?)
  ORDER BY i.created_at DESC
  LIMIT ?
`);
// The items offered where somebody is looking: the ones whose area has that
// spot inside it, pin or no pin — and the ones whose pin stands inside the area
// being looked at, whatever area they say, which is what lists an item from
// before areas were asked for. An area across the antimeridian has its west
// edge east of its east edge.
const selectItemsAt = db.prepare(`
  SELECT ${ITEM_COLUMNS} FROM items i JOIN users u ON u.id = i.user_id
  WHERE i.deleted_at IS NULL AND i.active = 1
    AND ((:latitude BETWEEN i.region_south AND i.region_north
        AND ((i.region_west <= i.region_east AND :longitude BETWEEN i.region_west AND i.region_east)
          OR (i.region_west > i.region_east AND (:longitude >= i.region_west OR :longitude <= i.region_east))))
      OR (i.has_location = 1
        AND i.latitude BETWEEN :south AND :north
        AND ((:west <= :east AND i.longitude BETWEEN :west AND :east)
          OR (:west > :east AND (i.longitude >= :west OR i.longitude <= :east)))))
  ORDER BY i.created_at DESC
  LIMIT :limit
`);
const selectItemsByUser = db.prepare(`
  SELECT ${ITEM_COLUMNS},
    (SELECT COUNT(*) FROM bookings b WHERE b.item_id = i.id AND b.status = 'pending') AS pending
  FROM items i JOIN users u ON u.id = i.user_id
  WHERE i.user_id = ? AND i.deleted_at IS NULL
  ORDER BY i.created_at DESC
`);
const insertItem = db.prepare(`
  INSERT INTO items (id, user_id, title, description, price, currency, latitude, longitude, place, images,
                     kind, category, mode, rates, hours, has_location,
                     region_name, region_detail, region_south, region_north, region_west, region_east)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateItemRow = db.prepare(`
  UPDATE items
  SET title = ?, description = ?, price = ?, currency = ?, latitude = ?, longitude = ?, place = ?,
      images = ?, active = ?, kind = ?, category = ?, mode = ?, rates = ?, hours = ?, has_location = ?,
      region_name = ?, region_detail = ?, region_south = ?, region_north = ?, region_west = ?, region_east = ?,
      updated_at = ?
  WHERE id = ? AND user_id = ? AND deleted_at IS NULL
`);
// Words typed into the bar at the top: matched anywhere in what an item says
// about itself. LIKE is enough for a table this size, and it is the one search
// that needs no index kept in step with every edit.
const searchItemRows = db.prepare(`
  SELECT ${ITEM_COLUMNS} FROM items i JOIN users u ON u.id = i.user_id
  WHERE i.deleted_at IS NULL AND i.active = 1
    AND (i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\'
      OR i.place LIKE ? ESCAPE '\\' OR i.category LIKE ? ESCAPE '\\')
  ORDER BY (i.title LIKE ? ESCAPE '\\') DESC, i.created_at DESC
  LIMIT ?
`);

export function searchItems(query, limit = 20) {
  const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return searchItemRows.all(pattern, pattern, pattern, pattern, pattern, limit).map(servedItem);
}
const deleteItemRow = db.prepare(`
  UPDATE items SET deleted_at = ?, active = 0 WHERE id = ? AND user_id = ? AND deleted_at IS NULL
`);

export function getItem(id) {
  return servedItem(selectItem.get(id) ?? null);
}

export function getItemsInBox({ south, north, west, east }, limit = 300) {
  const rows =
    west <= east
      ? selectItemsInBox.all(south, north, west, east, limit)
      : selectItemsAcrossDateline.all(south, north, west, east, limit);
  return rows.map(servedItem);
}

export function getItemsByUser(userId, { publicOnly = false } = {}) {
  const rows = selectItemsByUser.all(userId).map(servedItem);
  return publicOnly ? rows.filter((item) => item.active).map(({ pending, ...item }) => item) : rows;
}

function newItemId() {
  // 40 bits, in letters and digits nobody has to read aloud twice.
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  for (;;) {
    const id = Array.from(crypto.randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join("");
    if (!selectItem.get(id)) return id;
  }
}

// An area as its six columns, in the order they are written.
function regionValues(region) {
  if (!region) return ["", "", null, null, null, null];
  const [west, south, east, north] = region.bbox;
  return [region.name, region.detail, south, north, west, east];
}

// `box` is the area being looked at, as { south, north, west, east }, where it
// is known; without one only the items' own areas decide.
export function getItemsAt(latitude, longitude, box = null, limit = 200) {
  const { south = null, north = null, west = null, east = null } = box ?? {};
  return selectItemsAt.all({ latitude, longitude, south, north, west, east, limit }).map(servedItem);
}

export function createItem(userId, item) {
  const id = newItemId();
  insertItem.run(
    id,
    userId,
    item.title,
    item.description,
    item.price,
    item.currency,
    item.latitude,
    item.longitude,
    item.place,
    JSON.stringify(item.images),
    item.kind,
    item.category,
    item.mode,
    JSON.stringify(item.rates),
    JSON.stringify(item.hours ?? []),
    item.located ? 1 : 0,
    ...regionValues(item.region),
  );
  return getItem(id);
}

export function updateItem(userId, id, item) {
  const { changes } = updateItemRow.run(
    item.title,
    item.description,
    item.price,
    item.currency,
    item.latitude,
    item.longitude,
    item.place,
    JSON.stringify(item.images),
    item.active ? 1 : 0,
    item.kind,
    item.category,
    item.mode,
    JSON.stringify(item.rates),
    JSON.stringify(item.hours ?? []),
    item.located ? 1 : 0,
    ...regionValues(item.region),
    now(),
    id,
    userId,
  );
  return changes > 0 ? getItem(id) : null;
}

// The stored photo list, as file names — what an edit starts from, since the
// served item only carries addresses.
export function getItemImages(id) {
  const row = db.prepare("SELECT images FROM items WHERE id = ?").get(id);
  return readImages(row?.images);
}

export function deleteItem(userId, id) {
  return deleteItemRow.run(now(), id, userId).changes > 0;
}

/* -------------------------------------------------------------------- days */

const selectDays = db.prepare(`
  SELECT day, available, price FROM item_days WHERE item_id = ? AND day >= ? ORDER BY day
`);
const selectDaysBetween = db.prepare(`
  SELECT day, available, price FROM item_days WHERE item_id = ? AND day BETWEEN ? AND ?
`);
const upsertDay = db.prepare(`
  INSERT INTO item_days (item_id, day, available, price) VALUES (?, ?, ?, ?)
  ON CONFLICT (item_id, day) DO UPDATE SET available = excluded.available, price = excluded.price
`);
const deleteDay = db.prepare("DELETE FROM item_days WHERE item_id = ? AND day = ?");

const servedDay = (row) => ({ day: row.day, available: row.available === 1, price: row.price });

export function getDays(itemId, from) {
  return selectDays.all(itemId, from).map(servedDay);
}

export function getDaysBetween(itemId, start, end) {
  return selectDaysBetween.all(itemId, start, end).map(servedDay);
}

// One answer for a handful of days. A day put back to available at the usual
// price is an ordinary day again, and its row goes rather than staying behind
// to say nothing.
export function setDays(itemId, days, { available, price }) {
  transaction(() => {
    for (const day of days) {
      if (available && price == null) deleteDay.run(itemId, day);
      else upsertDay.run(itemId, day, available ? 1 : 0, price ?? null);
    }
  });
}

/* ---------------------------------------------------------------- bookings */

const BOOKING_COLUMNS = `
  b.id, b.item_id AS itemId, b.start_day AS start, b.end_day AS end, b.start_time AS startTime, b.end_time AS endTime, b.total, b.currency,
  b.note, b.status, b.slots, b.created_at AS createdAt, b.updated_at AS updatedAt,
  r.username AS renter, b.renter_id AS renterId,
  i.title AS itemTitle, i.images AS itemImages, i.user_id AS ownerId, o.username AS owner
`;
const BOOKING_FROM = `
  FROM bookings b
  JOIN users r ON r.id = b.renter_id
  JOIN items i ON i.id = b.item_id
  JOIN users o ON o.id = i.user_id
`;

function servedBooking(row) {
  if (!row) return null;
  const { itemImages, ...booking } = row;
  const first = readImages(itemImages)[0];
  return {
    ...booking,
    slots: booking.slots ? readList(booking.slots) : null,
    itemThumb: imageUrl(first?.thumb || first?.name),
  };
}

const selectBooking = db.prepare(`SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM} WHERE b.id = ?`);
const selectBookingsForItem = db.prepare(`
  SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM} WHERE b.item_id = ? ORDER BY b.id DESC LIMIT 200
`);
const selectBookingsForItemByRenter = db.prepare(`
  SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM} WHERE b.item_id = ? AND b.renter_id = ? ORDER BY b.id DESC LIMIT 50
`);
const selectBookingsByRenter = db.prepare(`
  SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM} WHERE b.renter_id = ? ORDER BY b.id DESC LIMIT 200
`);
const selectBookingsForOwner = db.prepare(`
  SELECT ${BOOKING_COLUMNS} ${BOOKING_FROM} WHERE i.user_id = ? ORDER BY b.id DESC LIMIT 200
`);
// The days that are taken, which is all a stranger is told: no names, no notes.
const selectTaken = db.prepare(`
  SELECT start_day AS start, end_day AS end, slots FROM bookings
  WHERE item_id = ? AND status = 'confirmed' AND end_day >= ?
  ORDER BY start_day
`);
const selectOverlapping = db.prepare(`
  SELECT id, renter_id AS renterId, status, slots FROM bookings
  WHERE item_id = ? AND status = ? AND start_day <= ? AND end_day >= ? AND id <> ?
`);
const selectOwnOverlap = db.prepare(`
  SELECT id, slots FROM bookings
  WHERE item_id = ? AND renter_id = ? AND status IN ('pending', 'confirmed') AND start_day <= ? AND end_day >= ?
`);
const insertBooking = db.prepare(`
  INSERT INTO bookings (item_id, renter_id, start_day, end_day, total, currency, note, slots, start_time, end_time)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateBookingStatus = db.prepare("UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?");

export const getBooking = (id) => servedBooking(selectBooking.get(id) ?? null);
export const getBookingsForItem = (itemId) => selectBookingsForItem.all(itemId).map(servedBooking);
export const getBookingsForItemByRenter = (itemId, renterId) =>
  selectBookingsForItemByRenter.all(itemId, renterId).map(servedBooking);
export const getBookingsByRenter = (renterId) => selectBookingsByRenter.all(renterId).map(servedBooking);
export const getBookingsForOwner = (ownerId) => selectBookingsForOwner.all(ownerId).map(servedBooking);
export const getTaken = (itemId, from) =>
  selectTaken.all(itemId, from).map((row) => ({ ...row, slots: row.slots ? readList(row.slots) : null }));

// Two bookings on the same days are in each other's way — unless both are for
// slots, where they clash only if the hours do. Times are "HH:MM", which
// compare as text.
function clashes(row, slots) {
  if (!slots || !row.slots) return true;
  const theirs = readList(row.slots);
  return slots.some((mine) => theirs.some((other) => mine.start < other.end && other.start < mine.end));
}

export function overlapping(itemId, status, start, end, { exceptId = 0, slots = null } = {}) {
  return selectOverlapping.all(itemId, status, end, start, exceptId).filter((row) => clashes(row, slots));
}

export function hasOwnOverlap(itemId, renterId, start, end, slots = null) {
  return selectOwnOverlap.all(itemId, renterId, end, start).some((row) => clashes(row, slots));
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
  const result = insertBooking.run(
    itemId,
    renterId,
    start,
    end,
    total,
    currency,
    note || null,
    slots ? JSON.stringify(slots) : null,
    startTime,
    endTime,
  );
  return getBooking(Number(result.lastInsertRowid));
}

export function setBookingStatus(id, status) {
  updateBookingStatus.run(status, now(), id);
  return getBooking(id);
}

/* ---------------------------------------------------------------- messages */

const MESSAGE_COLUMNS = `
  m.id, m.body, m.kind, m.created_at AS time, (m.from_user = ?) AS mine, (m.read_at IS NOT NULL) AS read,
  b.id AS bookingId, b.start_day AS bookingStart, b.end_day AS bookingEnd, b.status AS bookingStatus,
  b.slots AS bookingSlots, b.start_time AS bookingStartTime, b.end_time AS bookingEndTime, b.item_id AS itemId, i.title AS itemTitle
`;
const MESSAGE_JOINS = `
  LEFT JOIN bookings b ON b.id = m.booking_id
  LEFT JOIN items i ON i.id = b.item_id
`;

function servedMessage(row) {
  if (!row) return null;
  const {
    bookingId,
    bookingStart,
    bookingEnd,
    bookingStatus,
    bookingSlots,
    bookingStartTime,
    bookingEndTime,
    itemId,
    itemTitle,
    ...line
  } = row;
  return {
    ...line,
    mine: row.mine === 1,
    read: row.read === 1,
    booking: bookingId
      ? {
          id: bookingId,
          start: bookingStart,
          end: bookingEnd,
          startTime: bookingStartTime,
          endTime: bookingEndTime,
          status: bookingStatus,
          slots: bookingSlots ? readList(bookingSlots) : null,
          itemId,
          itemTitle,
        }
      : null,
  };
}

// The inbox: the last line of every conversation this account is part of, with
// how much of it is still unread.
const selectThreads = db.prepare(`
  SELECT u.username, ${MESSAGE_COLUMNS},
    (SELECT COUNT(*) FROM messages x
      WHERE x.to_user = ? AND x.from_user = u.id AND x.read_at IS NULL AND x.hidden_to = 0) AS unread
  FROM messages m
  JOIN users u ON u.id = CASE WHEN m.from_user = ? THEN m.to_user ELSE m.from_user END
  ${MESSAGE_JOINS}
  WHERE m.id IN (
    SELECT MAX(id) FROM messages
    WHERE (from_user = ? AND hidden_from = 0) OR (to_user = ? AND hidden_to = 0)
    GROUP BY CASE WHEN from_user = ? THEN to_user ELSE from_user END
  )
  ORDER BY m.id DESC
  LIMIT ?
`);
// Capped at its end rather than its beginning: a long exchange opens on the
// part of it that is still being had.
const selectConversation = db.prepare(`
  SELECT ${MESSAGE_COLUMNS}
  FROM messages m
  ${MESSAGE_JOINS}
  WHERE (m.from_user = ? AND m.to_user = ? AND m.hidden_from = 0)
     OR (m.from_user = ? AND m.to_user = ? AND m.hidden_to = 0)
  ORDER BY m.id DESC
  LIMIT ?
`);
const selectMessage = db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages m ${MESSAGE_JOINS} WHERE m.id = ?`);
const countUnreadRows = db.prepare(`
  SELECT COUNT(*) AS count FROM messages WHERE to_user = ? AND read_at IS NULL AND hidden_to = 0
`);
const markRead = db.prepare(`
  UPDATE messages SET read_at = ? WHERE to_user = ? AND from_user = ? AND read_at IS NULL
`);
const insertMessage = db.prepare(`
  INSERT INTO messages (from_user, to_user, body, kind, booking_id) VALUES (?, ?, ?, ?, ?)
`);
const hideSent = db.prepare("UPDATE messages SET hidden_from = 1 WHERE from_user = ? AND to_user = ?");
const hideReceived = db.prepare(`
  UPDATE messages SET hidden_to = 1, read_at = COALESCE(read_at, ?) WHERE to_user = ? AND from_user = ?
`);

export function getThreads(userId, limit = 50) {
  return selectThreads
    .all(userId, userId, userId, userId, userId, userId, limit)
    .map((row) => ({ ...servedMessage(row), username: row.username, unread: row.unread }));
}

export function getConversation(userId, otherId, limit = 200) {
  return selectConversation.all(userId, userId, otherId, otherId, userId, limit).reverse().map(servedMessage);
}

export function countUnread(userId) {
  return countUnreadRows.get(userId)?.count ?? 0;
}

export function readConversation(userId, otherId) {
  markRead.run(now(), userId, otherId);
}

export function createMessage(fromId, toId, body, { kind = "text", bookingId = null } = {}) {
  const result = insertMessage.run(fromId, toId, body, kind, bookingId);
  return servedMessage(selectMessage.get(fromId, Number(result.lastInsertRowid)));
}

export function deleteConversation(userId, otherId) {
  transaction(() => {
    hideSent.run(userId, otherId);
    hideReceived.run(now(), userId, otherId);
  });
}
