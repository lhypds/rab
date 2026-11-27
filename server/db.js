import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { SOURCE_FILE, accountFolders, allItemFolders, isInPlace, moveItemDir, nameFolders, readAnyItem, readItemSource, readItems, readList, readRequests, removeRequestDir, moveRequestDir, writeRequest, moveSpotDir, moveOldSpots, readOldSpots, readRecord, removeItemDir, removeUserDir, renameNumberedFolders, userFolders, writeItem, writeItemFolder, writeList, writeRecord } from "./files.js";
import { ADULT_AGE, ageOn } from "../src/utils/categories.js";
import { moveIntoFolders, moveItemsIntoFolders, renameItemFolders, renumberAccounts, renumberItems, storeAsWebp } from "./migrate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = process.env.RAB_DB || path.resolve(__dirname, "..", "db.sqlite");

// The database holds who is signed in, and that is all. An account is its
// folder, data/users/<username>/ (see files.js): the folder's name is its
// username, and user.json in it says the rest about it — its id, which is
// when it was made, its password, its address, how it is reached. What an account has —
// its items, its bookings, its messages, its photographs — is in the same
// folder, each item in a folder of its own inside it. All of it is read into
// memory when the server starts and written back, a file at a time, as it
// changes; so one server process owns the folders, and a file edited by hand
// is picked up at the next start.
export const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;

  -- Only the digest of a session token is kept: enough to find the account when
  -- the token comes back, and not a usable credential to whoever reads the file.
  -- user_id is the id in the account's user.json.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) WITHOUT ROWID;
`);

// What an account keeps about itself, in its folder's user.json: its id —
// when it was made — its password, its address, how it is reached (see "users" and
// "contacts" below).
const USER_FILE = "user.json";

// The accounts there are, as they are held while the server runs: by id, and
// the id by username — which is folded to lower case, a name being nobody
// else's whatever its capitals. An account is { id, username, createdAt }.
//
// The id is what everything in the folders points at — an item's owner, a
// booking's renter, the other end of a message, a session. It is the
// millisecond the account was made, in Unix time, like an item's — so when it
// was made (`createdAt`) is read off the id, and written nowhere.
const usersById = new Map();
const idByName = new Map();
const nameKey = (username) => String(username ?? "").toLowerCase();

function remember(user) {
  usersById.set(user.id, user);
  idByName.set(nameKey(user.username), user.id);
}

function forget(userId) {
  const user = usersById.get(userId);
  if (!user) return;
  usersById.delete(userId);
  idByName.delete(nameKey(user.username));
}

// The folders are named after usernames, and this is where it is known which
// username is which id.
nameFolders({
  nameOf: (id) => usersById.get(id)?.username ?? null,
  idOf: (username) => idByName.get(nameKey(username)) ?? null,
});

// The accounts used to be a table in the database: id, username, when it was
// made, and for a time the password and the address. A database that still
// has it has each account's row written into its user.json, and then the
// table goes — once. Nothing is dropped until every file is written: a start
// that fails part-way does it all again. The sessions go on pointing at the
// same ids, in a table that no longer leans on the one that went.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) {
  const rows = db.prepare("SELECT * FROM users ORDER BY id").all();
  for (const row of rows) remember({ id: row.id, username: row.username, createdAt: row.created_at });
  // And two older moves, from when the table was there to be asked: a
  // database that held everything is moved into the folders, and folders
  // named after ids are given their usernames.
  moveIntoFolders(db, databasePath);
  renameNumberedFolders();
  for (const row of rows) {
    const about = readRecord(row.id, USER_FILE);
    const record = { id: row.id, createdAt: row.created_at, ...about };
    record.id = row.id;
    if (row.password != null) record.password = String(row.password);
    if (row.email != null) record.email = String(row.email);
    writeRecord(row.id, USER_FILE, record);
  }
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE sessions_kept (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) WITHOUT ROWID;
    INSERT INTO sessions_kept SELECT token_hash, user_id, expires_at, created_at FROM sessions;
    DROP TABLE sessions;
    ALTER TABLE sessions_kept RENAME TO sessions;
    DROP TABLE users;
    COMMIT;
  `);
  console.log(`rab: moved ${rows.length} accounts out of db.sqlite into data/users/<username>/user.json`);
}

db.exec("CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at)");

// Accounts from when the database numbered them are given the millisecond
// they were made for an id, once, and what points at them follows (see
// migrate.js).
renumberAccounts(db, USER_FILE);

// The accounts, read from the folders: every folder whose user.json has an id
// is the account of that id, called what the folder is called. A folder
// without one is nobody's and is left alone. When it was made is its id.
usersById.clear();
idByName.clear();
for (const { username, record } of accountFolders(USER_FILE)) {
  const id = Number(record.id);
  if (!Number.isSafeInteger(id) || id <= 0) continue;
  if (usersById.has(id)) {
    console.warn(`rab: data/users/${username} was not read: its id, ${id}, is also that of ${usersById.get(id).username}`);
    continue;
  }
  remember({ id, username, createdAt: new Date(id).toISOString() });
}

// A new account's id: the millisecond it is made, in Unix time — the next one
// that is free, should that one be some account's already.
function newUserId() {
  let stamp = Date.now();
  while (usersById.has(stamp)) stamp += 1;
  return stamp;
}

// An account, made: its folder, with a user.json saying its id — which is
// when it was made — and whatever else is said of it (`about`). One whose file could not
// be written is not left behind as a name with nothing under it.
function addUser(username, about = {}) {
  const id = newUserId();
  const user = { id, username, createdAt: new Date(id).toISOString() };
  remember(user);
  try {
    writeRecord(user.id, USER_FILE, { id: user.id, ...about });
  } catch (error) {
    forget(user.id);
    throw error;
  }
  return user;
}

// One account is nobody's: "_public", which has what is everybody's — the
// items that are somebody else's, written down by an account that does not
// have them (an item's `shared`). They are kept in its folder,
// data/users/_public/, like any account's, and anybody signed in may change
// them. It is made here, once, with no password; nobody signs in as it
// whatever its user.json says (see checkPassword), and its name starts with
// _, which no name somebody chooses can.
export const PUBLIC_NAME = "_public";
export const PUBLIC_ID = (usersById.get(idByName.get(PUBLIC_NAME)) ?? addUser(PUBLIC_NAME)).id;

// And one is whoever looks after the site: "_admin", which is always there —
// made here, once, like the public account, under a name nobody can choose.
// It is the account the site's own post goes to: a request to delete one of
// the public account's items, a report of an item (see index.js) — each a line
// in a conversation with it, like any message. Unlike the public account it is
// signed in to, by whoever looks after the server: it starts with no password,
// which nothing typed matches, and `rab user _admin pass <new>` gives it one
// (see cli.js).
export const ADMIN_NAME = "_admin";
export const ADMIN_ID = (usersById.get(idByName.get(ADMIN_NAME)) ?? addUser(ADMIN_NAME)).id;

// Items from when an account's were one list are given their own folders,
// once; item folders from when they were named after a random id are named
// after when the item was made, once; and the items take that for their id,
// once.
moveItemsIntoFolders();
renameItemFolders();
renumberItems();

// And the photographs kept as JPEG or PNG from before every one was stored as
// WebP are made WebP, once.
await storeAsWebp();

const now = () => new Date().toISOString();

/* ------------------------------------------------------------------- users */

// An account's password and its address are in its folder's user.json —
// `password` and `email` — beside its id and how it is reached.
// They are read and written as they are asked for, so one changed by hand, or
// by cli.js under a running server, is the one that counts from then on.
//
// A password is kept as it was typed, so whoever looks after the server can
// read one and write one straight into the file. Anybody who can read the
// folders can therefore read every password in them. An account with none
// written — the server's own start so — is not signed in to at all.
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

// What an account's user.json says, with one thing in it changed: a value of
// null takes the thing out.
function keepAbout(userId, name, value) {
  const record = readRecord(userId, USER_FILE);
  if (value == null) delete record[name];
  else record[name] = value;
  writeRecord(userId, USER_FILE, record);
}

// What goes out about an account is a copy: what is held is not handed round
// to be written on.
export function getUser(username) {
  const user = usersById.get(idByName.get(nameKey(username)));
  return user ? { ...user } : null;
}

export function getUserById(id) {
  const user = usersById.get(id);
  return user ? { ...user } : null;
}

// `email` is the address the account was opened with, or null for one made
// where none is asked for.
export function createUser(username, password, email = null) {
  const user = { ...addUser(username, { password: String(password), ...(email ? { email } : null) }) };
  // Every account starts with its default spot (see spots).
  transaction(() => makeDefaultSpot(user.id, { fresh: true }));
  return user;
}

// The account's own address — the one it signs up with or sets on its sheet,
// which is the account's and not a way it says it is reached (see contacts) —
// or null where it has none.
export function getEmail(userId) {
  const { email } = readRecord(userId, USER_FILE);
  return typeof email === "string" && email ? email : null;
}

export function setEmail(userId, email) {
  keepAbout(userId, "email", email || null);
}

// When the account says it was born, "YYYY-MM-DD", or null where it has not
// said: kept in its user.json, shown to nobody, and asked for only to decide
// whether it is old enough for the grown-up categories (see categories.js).
export function getBirthdate(userId) {
  const { birthdate } = readRecord(userId, USER_FILE);
  return typeof birthdate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(birthdate) ? birthdate : null;
}

export function setBirthdate(userId, birthdate) {
  keepAbout(userId, "birthdate", birthdate || null);
}

// Whether the account is old enough to be shown the grown-up categories: it
// has said when it was born, and that is ADULT_AGE years ago or more today, by
// the calendar in Japan.
export function isAdult(userId) {
  if (userId == null) return false;
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const age = ageOn(getBirthdate(userId), today);
  return age !== null && age >= ADULT_AGE;
}

// Whether an address already has an account — other than `exceptId`, the
// account asking, where it is one that is changing its own. One account to an
// address, whatever its capitals: every account's file is asked, there being
// no index of what is in them.
export function emailTaken(email, exceptId = null) {
  const wanted = String(email).toLowerCase();
  return [...usersById.values()].some((user) => user.id !== exceptId && getEmail(user.id)?.toLowerCase() === wanted);
}

// Every account, oldest first: for whoever looks after the server (see cli.js).
export function listUsers() {
  return [...usersById.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id))
    .map((user) => ({ ...user }));
}

// A new password for an account, set by whoever looks after the server. The
// account is signed out everywhere: whoever was in on the old one is not in on
// the new one.
const deleteSessionsOf = db.prepare("DELETE FROM sessions WHERE user_id = ?");
export function setPassword(userId, password) {
  keepAbout(userId, "password", String(password));
  deleteSessionsOf.run(userId);
}

export function checkPassword(username, password) {
  // Nobody signs in as the account that is nobody's.
  if (String(username).toLowerCase() === PUBLIC_NAME) return false;
  const user = getUser(username);
  if (!user) return false;
  const kept = readRecord(user.id, USER_FILE).password;
  return typeof kept === "string" && kept !== "" ? passwordMatches(password, kept) : false;
}

/* ---------------------------------------------------------------- sessions */

const insertSession = db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)");
const selectSession = db.prepare("SELECT user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token_hash = ?");
const deleteSessionRow = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
const touchSessionRow = db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?");
const deleteExpired = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");

export const saveSession = (hash, userId, expiresAt) => insertSession.run(hash, userId, expiresAt);
// A session of an account there no longer is, is no session.
export function getSession(hash) {
  const session = selectSession.get(hash);
  const username = session ? usersById.get(session.userId)?.username : null;
  return username ? { ...session, username } : null;
}
export const deleteSession = (hash) => deleteSessionRow.run(hash);
export const touchSession = (hash, expiresAt) => touchSessionRow.run(expiresAt, hash);
export const deleteExpiredSessions = (time) => deleteExpired.run(time);

/* ----------------------------------------------------------------- folders */

// Everything in the users' folders, as it is held while the server runs.
//
// An item is in its own folder under its owner's items/ — item.json, with its
// photographs beside it — and nowhere else. Its id is the millisecond it was
// made, in Unix time, and its folder is named after it. One from when ids were
// drawn at random still says what it was called then (`was`), and `idByOldId`
// finds it by that. A booking is between
// two accounts and is in both their bookings.json, the same on each side. A
// line of a conversation is in the messages.json of each end separately, as
// that end sees it — `with` the other account, `mine` or not — so deleting a
// conversation takes it out of one folder and leaves the other's alone.
const itemsById = new Map();
const idByOldId = new Map();
const bookingsById = new Map();
const messagesByUser = new Map();
let lastBookingId = 0;
let lastMessageId = 0;

function linesOf(userId) {
  if (!messagesByUser.has(userId)) messagesByUser.set(userId, []);
  return messagesByUser.get(userId);
}

// An item as it is read from its folder. One booked by the time, from when its
// prices were for an hour and it was booked by the half hour, has neither
// written down, and is read as both. And one from when listings were of three
// kinds — a thing, a space, a service — loses its `kind`: every listing is an
// item now, told apart by its category alone.
function perUnit({ kind: _kind, ...item }) {
  if (item.mode !== "time" || item.unit != null) return item;
  return { ...item, unit: 30, priceUnit: 60 };
}

function load() {
  itemsById.clear();
  idByOldId.clear();
  bookingsById.clear();
  messagesByUser.clear();
  for (const userId of userFolders()) {
    // An account's spots from when they were stores or pages, in stores/,
    // in pages/ or in one list, moved to spots/.
    moveOldSpots(userId);
    for (const item of readItems(userId)) {
      itemsById.set(item.id, { ...perUnit(item), ownerId: userId });
      if (item.was) idByOldId.set(String(item.was), item.id);
      // One deleted from before deleted items were moved to deleted/, still
      // in items/ or spots/: written, and so moved, where it belongs.
      if (item.deletedAt && !isInPlace(userId, item)) changedItem(itemsById.get(item.id));
    }
    // Its spots from before spots were items, made items, and written so.
    for (const old of readOldSpots(userId)) {
      let id = old.id;
      if (itemsById.has(id)) {
        let stamp = Number(id) || Date.now();
        while (itemsById.has(String(stamp))) stamp += 1;
        moveSpotDir(userId, id, String(stamp));
        id = String(stamp);
      }
      const spot = spotFromOld({ ...old, id }, userId);
      itemsById.set(id, spot);
      if (spot.was) idByOldId.set(String(spot.was), id);
      changedItem(spot);
    }
    // Both sides hold the booking; should the two ever differ, the one changed
    // last is the one that is right.
    for (const booking of readList(userId, "bookings.json")) {
      const known = bookingsById.get(booking.id);
      if (!known || booking.updatedAt > known.updatedAt) bookingsById.set(booking.id, booking);
    }
    messagesByUser.set(userId, readList(userId, "messages.json"));
  }
  // Somebody else's, found in the folder of the account that wrote it down —
  // from before such items were the public account's: it is the public
  // account's from here on, and its folder goes there with it.
  for (const item of itemsById.values()) {
    if (item.shared !== true || item.ownerId === PUBLIC_ID) continue;
    const from = item.ownerId;
    item.ownerId = PUBLIC_ID;
    changedItem(item, from);
  }
  lastBookingId = Math.max(0, ...bookingsById.keys());
  lastMessageId = 0;
  for (const lines of messagesByUser.values()) {
    for (const line of lines) lastMessageId = Math.max(lastMessageId, line.id);
  }
}

// A spot as it was kept before spots were items — a name, a word about it,
// a copy of a saved location, how its owner is reached, its
// photographs and the ids of its items — as the item it is now: priced on
// request, booked by asking where it says how its owner is reached and by the
// day where not, in the currency of its owner's newest item.
function spotFromOld(old, userId) {
  const location = old.location ?? null;
  const contacts = Array.isArray(old.contacts) ? old.contacts : [];
  const currency =
    [...itemsById.values()]
      .filter((item) => item.ownerId === userId && !item.spot && item.currency)
      .reduce((newest, item) => (!newest || item.createdAt > newest.createdAt ? item : newest), null)?.currency ?? "USD";
  return {
    id: old.id,
    ...(old.was ? { was: old.was } : null),
    spot: true,
    itemIds: Array.isArray(old.itemIds) ? old.itemIds.map(String) : [],
    title: old.name ?? "",
    description: old.description ?? "",
    what: "",
    links: [],
    category: "",
    mode: contacts.length > 0 ? "inquiry" : "day",
    rates: [],
    hours: [],
    unit: 30,
    priceUnit: contacts.length > 0 ? 1440 : 30,
    cancel: { mode: "any" },
    contacts,
    shared: false,
    openDays: null,
    dayHours: null,
    hoursOff: [],
    price: null,
    currency,
    located: Boolean(location),
    latitude: location?.latitude ?? 0,
    longitude: location?.longitude ?? 0,
    place: location ? location.address || location.name || null : null,
    region: location?.region ?? null,
    moreRegions: [],
    images: Array.isArray(old.images) ? old.images : [],
    active: true,
    days: [],
    createdAt: old.createdAt ?? now(),
    updatedAt: old.updatedAt ?? old.createdAt ?? now(),
    deletedAt: null,
    ownerId: userId,
  };
}

// The public account's items by the key the crawler knows each by (its
// source.json), as JSON — read from every folder once, the first time it is
// asked for, and kept up to date from then on wherever one is taken in,
// merged or purged — so that a public folder pushed an item at a time does
// not read thousands of files for each one.
let publicKeys = null;

function publicKeyIndex() {
  if (publicKeys) return publicKeys;
  publicKeys = new Map();
  for (const { folder } of allItemFolders(PUBLIC_ID)) notePublicKey(folder);
  return publicKeys;
}

// One folder's key put in the index (where it is built), read from its
// source.json.
function notePublicKey(folder) {
  if (!publicKeys) return;
  const key = readItemSource(PUBLIC_ID, folder)?.key;
  if (key) publicKeys.set(JSON.stringify(key), folder);
}

// The public item the crawler knows by `key`, where there still is one.
function publicByKey(key) {
  const id = publicKeyIndex().get(key);
  return id && itemsById.get(id)?.ownerId === PUBLIC_ID ? id : null;
}

// The public account's items that were put in its folder while the server was
// running — by a crawler (see data/crawlers), which writes a whole item folder
// and moves it into place — and are not held here yet: taken in, and their ids
// given back. Only a folder not known is read, so one the server holds is
// never read over what has been changed here; and one that cannot be read yet
// is left for the next time round.
export function adoptPublicItems() {
  const adopted = [];
  for (const { folder } of allItemFolders(PUBLIC_ID)) {
    if (itemsById.has(folder)) continue;
    let item;
    try {
      item = readAnyItem(PUBLIC_ID, folder);
    } catch {
      continue;
    }
    if (!item) continue;
    itemsById.set(item.id, { ...perUnit(item), ownerId: PUBLIC_ID });
    notePublicKey(item.id);
    adopted.push(item.id);
  }
  return adopted;
}

// What has changed and is not on disk yet, as "<user id>/<file>".
const unsaved = new Set();
// The items that have changed and are not on disk yet, by id — each with the
// account whose folder it is still in, where it has changed owner since it was
// last written, and null where it has not.
const unsavedItems = new Map();
let depth = 0;

function changed(userId, file) {
  unsaved.add(`${userId}/${file}`);
}

function changedItem(item, from = null) {
  unsavedItems.set(item.id, from ?? unsavedItems.get(item.id) ?? null);
}

function save() {
  for (const [id, from] of unsavedItems) {
    unsavedItems.delete(id);
    const item = itemsById.get(id);
    if (!item) continue;
    // The whole folder goes to the new owner, photographs and all.
    if (from !== null && from !== item.ownerId) moveItemDir(from, item.ownerId, id);
    const { ownerId, ...kept } = item;
    writeItem(ownerId, kept);
  }
  for (const entry of unsaved) {
    const [id, file] = entry.split("/");
    const userId = Number(id);
    if (file === "bookings.json") {
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
      unsavedItems.clear();
      load();
    }
    throw error;
  }
}

load();
// An account from before every account had a default spot is given one,
// and every item on no spot is put on it.
ensureDefaultSpots();
// Whatever load() moved is written where it now belongs.
save();

const nameOf = (userId) => usersById.get(userId)?.username ?? null;
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
    // Whether it is a spot: a collection of the owner's items (see spots).
    spot: item.spot === true,
    // Whether it is the account's default spot: the one it has from the
    // first, listed first among its pages on its profile (see defaultSpot).
    default: item.default === true,
    title: item.title,
    // A few words for what it is, apart from its name; empty where not said.
    what: item.what ?? "",
    // How many of it its owner has: one, where nothing is said. (Not `count`,
    // which on a spot is how many items are on it.)
    quantity: item.quantity ?? 1,
    description: item.description,
    price: item.price,
    currency: item.currency,
    latitude: located ? item.latitude : null,
    longitude: located ? item.longitude : null,
    place: item.place ?? null,
    // The area it is offered in, with its box as [west, south, east, north].
    region: item.region ?? null,
    // And the other areas it is offered in as well, for something that stands
    // between two: the same shape, a few at most.
    moreRegions: item.moreRegions ?? [],
    images,
    // The first photograph is the main one: what a list row and a pin draw.
    thumb: images[0]?.thumb ?? null,
    // And the same at the size a pin draws it, which is what the map asks for.
    pin: images[0] ? `${images[0].thumb}/pin` : null,
    active: item.active === true,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    category: item.category,
    mode: item.mode,
    // An item from before there were rules has one: its price, every day.
    rates: item.rates?.length > 0 ? item.rates : [{ price: item.price, days: null }],
    hours: item.hours ?? [],
    // The piece of the clock it is booked in, in minutes, where it is booked
    // by the time: half an hour for an item from before there was a choice.
    unit: item.unit ?? 30,
    // The shortest stretch one booking may be, in minutes: one unit where
    // the item says none.
    minDuration: item.minDuration ?? item.unit ?? 30,
    // The stretch of the clock a price is for, in minutes: the booking unit
    // where the item says none.
    priceUnit: item.priceUnit ?? item.unit ?? 30,
    // When a confirmed booking may still be called off by whoever made it:
    // { mode: "any" | "none" | "days", days }. Any time, where nothing is said.
    cancel: item.cancel ?? { mode: "any" },
    // The deposit asked for on top of the price, in its currency: null for none.
    deposit: item.deposit ?? null,
    // What it is sold for, where it is for sale as well: null where it is not.
    salePrice: item.salePrice ?? null,
    // Whether it is lent out at all: one that is not is only for sale.
    rentable: item.rentable !== false,
    // Whether it is somebody else's, put here by an account that does not
    // have it: anybody signed in may then change it or delete it.
    shared: item.shared === true,
    // Its own pages somewhere else, as addresses; one from before there could
    // be several has the one it had, as `homepage`.
    links: item.links ?? (item.homepage ? [item.homepage] : []),
    // How its owner is reached, where it is booked by asking: [{ type, value }].
    contacts: item.contacts ?? [],
    // The rule for days — which days of the week it can be had, null for all —
    // and the dates whose hours the owner wiped.
    openDays: item.openDays ?? null,
    // The hours of the day one booked by the date is handed over in.
    dayHours: item.dayHours ?? null,
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
    // What the people who rented it gave it once they had (see reviews).
    rating: ratingOf(getItemReviews(item.id)),
    ownerId: item.ownerId,
    // Whose account it is under — which is not said of somebody else's: the
    // account that wrote it down does not have it, and it is everybody's to
    // keep right.
    owner: item.shared === true ? null : nameOf(item.ownerId),
  };
}

// What the home page shows — the map, the lists beside it and the search in
// its bar: spots (pages) only, never the items on them. Only the published
// ones, the most lately changed first — the spot itself or anything published
// on it — each placed where it says it is — or, where it says nothing, where
// the published items on it are (see placedSpot).
function listedItems() {
  return [...itemsById.values()]
    .filter((item) => item.spot && !item.deletedAt && item.active)
    .map((spot) => [placedSpot(spot), lastChanged(spot)])
    .filter(([placed]) => placed)
    .sort(([a, aTime], [b, bTime]) => (aTime < bTime ? 1 : aTime > bTime ? -1 : newestFirst(a, b)))
    .map(([placed]) => placed);
}

// When a spot or one of the published items on it was last changed.
function lastChanged(spot) {
  let latest = spot.updatedAt ?? spot.createdAt ?? "";
  for (const id of spot.itemIds ?? []) {
    const item = itemsById.get(String(id));
    if (!item || item.deletedAt || !item.active || item.spot || item.ownerId !== spot.ownerId) continue;
    const time = item.updatedAt ?? item.createdAt ?? "";
    if (time > latest) latest = time;
  }
  return latest;
}

// A spot as the home page places it: its own pin, areas and photographs
// where it has them, and otherwise those of the published items on it — the
// pin of the first that has one, the areas of all of them, the first photo.
// Null where it has neither a place of its own nor anything published on it
// — an account's default spot before anything is added, say.
function placedSpot(spot) {
  const items = (spot.itemIds ?? [])
    .map((id) => itemsById.get(String(id)))
    .filter((item) => item && !item.deletedAt && item.active && !item.spot && item.ownerId === spot.ownerId);
  if (items.length === 0) return spot.located || spot.region ? spot : null;
  const placed = { ...spot };
  if (!spot.located) {
    const pinned = items.find((item) => item.located);
    if (pinned) Object.assign(placed, { located: true, latitude: pinned.latitude, longitude: pinned.longitude, place: spot.place || pinned.place });
  }
  if (!spot.region) {
    const seen = new Map();
    for (const item of items) {
      for (const region of [item.region, ...(item.moreRegions ?? [])]) {
        if (region?.bbox) seen.set(`${region.name}|${region.bbox.join()}`, region);
      }
    }
    const [first = null, ...rest] = seen.values();
    Object.assign(placed, { region: first, moreRegions: rest });
  }
  if (!(spot.images?.length > 0)) {
    const shown = items.find((item) => item.images?.length > 0);
    if (shown) placed.images = [shown.images[0]];
  }
  return placed;
}

// Whether a longitude is between two edges, where a box that crosses the
// antimeridian has its west edge east of its east edge.
function between(longitude, west, east) {
  return west <= east ? longitude >= west && longitude <= east : longitude >= west || longitude <= east;
}

// The item an id is the id of — or was, for an address from when ids were
// drawn at random.
function liveItem(id) {
  const item = itemsById.get(id) ?? itemsById.get(idByOldId.get(id));
  return item && !item.deletedAt ? item : null;
}

export function getItem(id) {
  return servedItem(liveItem(id));
}

// Words typed into the bar at the top: matched anywhere in what an item says
// about itself, the ones that have them in their name first.
export function searchItems(query, limit = 20) {
  // Word by word: every word asked for is somewhere in what the item says
  // about itself, in any order — as the box over the lists reads what is
  // already on the page. The ones with all of it in the title come first.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all = (text) => words.every((word) => text.includes(word));
  const said = (item) =>
    [item.title, item.what, item.description, item.place, item.category, nameOf(item.ownerId)].filter(Boolean).join(" ").toLowerCase();
  const has = (value) => all(String(value ?? "").toLowerCase());
  const found = listedItems().filter((item) => all(said(item)));
  return [...found.filter((item) => has(item.title)), ...found.filter((item) => !has(item.title))]
    .slice(0, limit)
    .map(servedItem);
}

export function getItemsInBox({ south, north, west, east }, limit = 4000) {
  return listedItems()
    .filter(
      (item) =>
        item.located && item.latitude >= south && item.latitude <= north && between(item.longitude, west, east),
    )
    .slice(0, limit)
    .map(servedItem);
}

// The items offered where somebody is looking: the ones with an area — the
// first, or one of those added to it — that has that
// spot inside it, pin or no pin — and the ones whose pin stands inside the area
// being looked at, whatever area they say, which is what lists an item from
// before areas were asked for. `box` is the area being looked at, as { south,
// north, west, east }, where it is known; without one only the items' own
// areas decide. All of them, however many: the page draws the list a part at
// a time, and what it counts and narrows is the whole.
export function getItemsAt(latitude, longitude, box = null) {
  return listedItems()
    .filter((item) => {
      for (const region of [item.region, ...(item.moreRegions ?? [])]) {
        if (!region) continue;
        const [west, south, east, north] = region.bbox;
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
    .map(servedItem);
}

// An account's items — not its spots, which are items too but listed apart
// (see getSpots) — newest first.
export function getItemsByUser(userId, { publicOnly = false } = {}) {
  const items = [...itemsById.values()].filter((item) => item.ownerId === userId && !item.deletedAt && !item.spot).sort(newestFirst);
  if (publicOnly) return items.filter((item) => item.active).map(servedItem);
  const bookings = [...bookingsById.values()];
  return items.map((item) => ({
    ...servedItem(item),
    // How many people are waiting on an answer about it.
    pending: bookings.filter((booking) => booking.itemId === item.id && booking.status === "pending").length,
  }));
}

// A new item's id: the millisecond it was made, in Unix time, which is also
// what its folder is called. Should that one be some item's already, it is the
// next one that is free.
function newItemId(time) {
  let stamp = Date.parse(time);
  while (itemsById.has(String(stamp))) stamp += 1;
  return String(stamp);
}

// What the form decides about an item, as it is kept.
function itemFields(item) {
  return {
    title: item.title,
    // A few words for what it is, kept apart from its name: "Film camera".
    what: item.what ?? "",
    // How many of it there are: one, where nothing is said.
    quantity: item.quantity ?? 1,
    description: item.description,
    // Its own pages somewhere else, as addresses, the first first.
    links: item.links ?? [],
    category: item.category,
    mode: item.mode,
    rates: item.rates,
    hours: item.hours ?? [],
    unit: item.unit ?? 30,
    minDuration: item.minDuration ?? item.unit ?? 30,
    priceUnit: item.priceUnit ?? item.unit ?? 30,
    cancel: item.cancel ?? { mode: "any" },
    deposit: item.deposit ?? null,
    salePrice: item.salePrice ?? null,
    // Whether it is lent out at all: one that is not is only for sale.
    rentable: item.rentable !== false,
    contacts: item.contacts ?? [],
    shared: item.shared === true,
    openDays: item.openDays ?? null,
    dayHours: item.dayHours ?? null,
    hoursOff: item.hoursOff ?? [],
    price: item.price,
    currency: item.currency,
    located: Boolean(item.located),
    latitude: item.latitude,
    longitude: item.longitude,
    place: item.place ?? null,
    region: item.region ?? null,
    moreRegions: item.moreRegions ?? [],
    // {name, thumb, width, height}: the names of files in the item's own folder.
    images: item.images,
  };
}

export function createItem(userId, item) {
  const time = now();
  const id = newItemId(time);
  transaction(() => {
    itemsById.set(id, {
      id,
      ...itemFields(item),
      // A spot is an item with the ids of other items of the account's on it,
      // in the order it put them; it is kept under spots/ (see files.js). What
      // an item is, it stays.
      ...(item.spot ? { spot: true, itemIds: [] } : null),
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
    changedItem(itemsById.get(id));
  });
  return getItem(id);
}

export function updateItem(userId, id, item) {
  const current = liveItem(id);
  if (!current || current.ownerId !== userId) return null;
  transaction(() => {
    Object.assign(current, itemFields(item), { active: Boolean(item.active), updatedAt: now() });
    // The one link from before there could be several is among `links` now.
    delete current.homepage;
    // The default spot is its account's from the first, and stays so.
    if (current.default) current.shared = false;
    // Said to be somebody else's, it leaves the account's folder for the
    // public account's, and is nobody's from then on.
    if (current.shared && current.ownerId !== PUBLIC_ID) {
      current.ownerId = PUBLIC_ID;
      changedItem(current, userId);
    } else {
      changedItem(current);
    }
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
    changedItem(current);
    // A spot gone, the items that were on it alone go on the default one.
    if (current.spot) keepItemsOnSpots(userId);
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
    changedItem(item);
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
    // Which side has said how the other was, once it was over (see reviews).
    reviewedBy: { owner: Boolean(booking.reviews?.owner), renter: Boolean(booking.reviews?.renter) },
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    renter: nameOf(booking.renterId),
    renterId: booking.renterId,
    itemTitle: item?.title ?? null,
    itemCategory: item?.category ?? null,
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

/* ----------------------------------------------------------------- reviews */

// Once a confirmed booking is over, each side says how the other was: one to
// five stars and a word about it. Whoever rented also says how the item was,
// in stars of its own (`itemRating`). It is kept on the booking — `reviews`, under
// the side that wrote it, "owner" or "renter" — so it is in both folders like
// the rest of the booking, and goes when the booking does. Said once: there is
// no taking it back and no saying it again.
const sideOf = (booking, userId) =>
  booking.ownerId === userId ? "owner" : booking.renterId === userId ? "renter" : null;

export function setReview(id, userId, { rating, itemRating = null, comment }) {
  const booking = bookingsById.get(id);
  const side = booking ? sideOf(booking, userId) : null;
  if (!side) return null;
  transaction(() => {
    booking.reviews = {
      ...booking.reviews,
      [side]: { rating, ...(side === "renter" ? { itemRating } : null), comment: comment || null, time: now() },
    };
    booking.updatedAt = now();
    bookingChanged(booking);
  });
  return getBooking(id);
}

// The confirmed bookings an account is one side of and has not said anything
// about yet. Whether one is over is the caller's to say: it goes by a clock.
export function getBookingsToReview(userId) {
  return bookingsWhere((booking) => {
    const side = sideOf(booking, userId);
    return Boolean(side) && booking.status === "confirmed" && !booking.reviews?.[side];
  });
}

// What has been said about an account by the other side of its bookings,
// newest first: as an owner by whoever rented from it, as a renter by whoever
// it rented from.
export function getReviewsOf(userId) {
  const reviews = [];
  for (const booking of bookingsById.values()) {
    const side = sideOf(booking, userId);
    const review = side ? booking.reviews?.[side === "owner" ? "renter" : "owner"] : null;
    if (!review) continue;
    reviews.push({
      id: booking.id,
      rating: review.rating,
      comment: review.comment ?? null,
      time: review.time,
      from: nameOf(side === "owner" ? booking.renterId : booking.ownerId),
      // What the account was in that booking: the "owner" or the "renter".
      // And not what the booking was of: what somebody has borrowed is
      // theirs to know, not for whoever reads their reviews.
      as: side,
    });
  }
  return reviews.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
}

// What has been said about an item, newest first: the stars whoever rented it
// gave the item itself once their booking of it was complete, and the word
// they wrote with them.
export function getItemReviews(itemId) {
  const reviews = [];
  for (const booking of bookingsById.values()) {
    const review = booking.itemId === itemId ? booking.reviews?.renter : null;
    if (!review) continue;
    reviews.push({
      id: booking.id,
      rating: review.itemRating ?? review.rating,
      comment: review.comment ?? null,
      time: review.time,
      from: nameOf(booking.renterId),
    });
  }
  return reviews.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
}

// A rating: the mean of the stars, to one decimal, and how many times they
// were given. No mean where nobody has said anything.
function ratingOf(reviews) {
  const sum = reviews.reduce((total, review) => total + review.rating, 0);
  return { average: reviews.length > 0 ? Math.round((sum / reviews.length) * 10) / 10 : null, count: reviews.length };
}

export const getRating = (userId) => ratingOf(getReviewsOf(userId));

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
// Two more are what is sent to the account that looks after the site (see
// ADMIN_NAME): deleteRequest, asking for one of the public account's items to
// be deleted, and report, saying something is wrong with an item. `itemId`
// says which item, `reason` what kind of thing is wrong with it, and the body
// is what was written about it.
//
// `read` is whether the one it was sent to has read it, on both copies: it is
// what the receiver's unread count goes by and what the sender is shown.
function spotOfLine({ ownerId, id }) {
  const spot = nameOf(ownerId) ? findSpot(ownerId, id) : null;
  return { owner: nameOf(ownerId), id: spot?.id ?? id, name: spot?.title ?? null, gone: !spot };
}

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
    // The item a line sent to the admin is about; `gone` once it is deleted.
    item: line.itemId
      ? {
          id: line.itemId,
          title: itemsById.get(line.itemId)?.title ?? null,
          gone: !itemsById.get(line.itemId) || Boolean(itemsById.get(line.itemId).deletedAt),
        }
      : null,
    // And the spot one is about: its name, and `gone` once it is deleted.
    // (A line from before spots were called so says `store`, or `page`.)
    spot: (line.spot ?? line.store ?? line.page) ? spotOfLine(line.spot ?? line.store ?? line.page) : null,
    reason: line.reason ?? null,
    // The request an exchange is about, said at its head (see the "wanted"
    // line): what was asked for, and `gone` once it has been taken down.
    request: line.requestId
      ? {
          id: line.requestId,
          title: heldRequests().get(line.requestId)?.title ?? null,
          gone: !heldRequests().has(line.requestId),
        }
      : null,
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

// An exchange about a request asked without a name is a thread of its own,
// apart from whatever else the same two accounts have said to each other:
// `via` on its lines is the request's id, and `anon` — on the copies kept by
// the one who answered — says the far end is not to be named. So a thread is
// who it is with and, where there is one, the request it is by way of.
const inThread = (line, otherId, via) => line.with === otherId && (line.via ?? null) === via;

// How a thread is addressed by the account holding it: the other's name; or
// for one by way of a request, "~<request>" to its nameless maker and
// "<name>~<request>" back to whoever answered.
function threadHandle(line) {
  if (!line.via) return nameOf(line.with);
  return line.anon ? `~${line.via}` : `${nameOf(line.with)}~${line.via}`;
}

// Whether an exchange has already said it is about a request: the line that
// leads to it is written once, ahead of the first thing said about it.
export function saidOfRequest(userId, otherId, via, requestId) {
  return linesOf(userId).some((line) => inThread(line, otherId, via) && line.requestId === requestId);
}

// Who `userId` is writing to by way of a request: its maker, from what has
// already been said — which outlives the request — or null.
export function anonymousPeer(userId, via) {
  return linesOf(userId).find((line) => line.via === via && line.anon)?.with ?? null;
}

// Whether `userId`, having asked without a name, has been written to by
// `otherId` by way of that request: only then is there anybody to answer.
export function answeredBy(userId, otherId, via) {
  return linesOf(userId).some((line) => inThread(line, otherId, via) && !line.anon);
}

// The inbox: the last line of every conversation this account is part of, with
// how much of it is still unread.
export function getThreads(userId, limit = 50) {
  const threads = new Map();
  for (const line of linesOf(userId)) {
    const key = `${line.with} ${line.via ?? ""}`;
    const thread = threads.get(key) ?? { last: line, unread: 0 };
    if (line.id >= thread.last.id) thread.last = line;
    if (unreadLine(line)) thread.unread += 1;
    threads.set(key, thread);
  }
  return [...threads.values()]
    .sort((a, b) => b.last.id - a.last.id)
    .slice(0, limit)
    .map(({ last, unread }) => ({
      ...servedMessage(last),
      // What the thread is addressed by, which for one by way of a request
      // is not a name (see threadHandle) — and then what was asked for, to
      // tell it by.
      username: threadHandle(last),
      ...(last.via ? { about: heldRequests().get(last.via)?.title ?? null } : null),
      unread,
    }));
}

// Capped at its end rather than its beginning: a long exchange opens on the
// part of it that is still being had.
export function getConversation(userId, otherId, limit = 200, via = null) {
  return linesOf(userId)
    .filter((line) => inThread(line, otherId, via))
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
export function readConversation(userId, otherId, via = null) {
  const fresh = new Set(
    linesOf(userId)
      .filter((line) => inThread(line, otherId, via) && unreadLine(line))
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

export function createMessage(
  fromId,
  toId,
  body,
  // `via` and `anonId`: the request an exchange is by way of, and which end of
  // it asked without a name (see inThread).
  { kind = "text", bookingId = null, itemId = null, spot = null, reason = null, via = null, anonId = null, requestId = null } = {},
) {
  // The clock, so a number is never handed out twice even after both ends have
  // deleted the lines that carried the highest ones.
  lastMessageId = Math.max(Date.now(), lastMessageId + 1);
  const line = {
    id: lastMessageId,
    body,
    kind,
    bookingId,
    ...(itemId ? { itemId } : null),
    // Or the spot it is about, as whose it is and its id.
    ...(spot ? { spot: { ownerId: spot.ownerId, id: spot.id } } : null),
    ...(reason ? { reason } : null),
    ...(requestId ? { requestId } : null),
    ...(via ? { via } : null),
    time: now(),
    read: false,
  };
  const sent = { ...line, with: toId, mine: true, ...(via && toId === anonId ? { anon: true } : null) };
  transaction(() => {
    linesOf(fromId).push(sent);
    linesOf(toId).push({ ...line, with: fromId, mine: false, ...(via && fromId === anonId ? { anon: true } : null) });
    changed(fromId, "messages.json");
    changed(toId, "messages.json");
  });
  return servedMessage(sent);
}

// A conversation deleted from an inbox goes from that side's folder only. What
// had not been read yet counts as read on the way out, so the other end is not
// left waiting on it.
export function deleteConversation(userId, otherId, via = null) {
  transaction(() => {
    const dropped = new Set(
      linesOf(userId)
        .filter((line) => inThread(line, otherId, via) && unreadLine(line))
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
      linesOf(userId).filter((line) => !inThread(line, otherId, via)),
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
// The public account's are every spot somebody else's thing has been put at,
// which is as many as there are such things.
const PUBLIC_LOCATIONS_MAX = 5000;

const newLocationId = () => crypto.randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x");

export function getLocations(userId) {
  return readList(userId, LOCATIONS_FILE);
}

// Kept under the id it came with, where it came with one (the phone names its
// own, and its items remember them); a location sent again under an id that is
// there replaces what was there.
export function saveLocation(userId, location) {
  const list = getLocations(userId);
  const id = location.id || newLocationId();
  const at = list.findIndex((each) => each.id === id);
  if (at === -1 && list.length >= (userId === PUBLIC_ID ? PUBLIC_LOCATIONS_MAX : LOCATIONS_MAX)) return null;
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

/* ------------------------------------------------------------ public folder */

// A public folder sent whole by whoever looks after the site (see upload.js) —
// its locations.json and its items, as { locations, items: [{ folder, item,
// source, files }] } — merged into the public account's.
//
// A place is one already kept where it has the same id or the same address,
// and is put in its stead under the id it has here; the rest are added, as
// many as there is room for. An item is one already held where it has the
// same id, or where the crawler knows it by the same key (source.json): it is
// put in its stead under the id it has here, and keeps when it was made. The
// rest are added under the id they came with — except one under an id that is
// somebody else's item, which is passed over. Each item's photographs are
// written into its folder; which ones it carries is for the caller to settle
// (see keepImages).
export function mergePublic({ locations, items }) {
  const places = { added: 0, replaced: 0, dropped: 0 };
  const list = getLocations(PUBLIC_ID);
  for (const location of locations) {
    const at = list.findIndex(
      (each) => (location.id && each.id === location.id) || (location.address && each.address === location.address),
    );
    if (at !== -1) {
      list[at] = { ...location, id: list[at].id, createdAt: list[at].createdAt };
      places.replaced += 1;
    } else if (list.length >= PUBLIC_LOCATIONS_MAX) {
      places.dropped += 1;
    } else {
      list.push({ ...location, id: location.id || newLocationId(), createdAt: location.createdAt || now() });
      places.added += 1;
    }
  }
  if (locations.length) writeList(PUBLIC_ID, LOCATIONS_FILE, list);

  const things = { added: [], replaced: [], skipped: [] };
  for (const { folder, item, source, files } of items) {
    const held = itemsById.get(folder);
    if (held && held.ownerId !== PUBLIC_ID) {
      things.skipped.push(folder);
      continue;
    }
    const key = source?.key ? JSON.stringify(source.key) : null;
    const id = held || !key ? folder : (publicByKey(key) ?? folder);
    const existing = itemsById.get(id);
    const time = now();
    // It keeps when it was last changed where it came saying so, so that a
    // sender can tell later whether what it has is newer than this.
    const kept = { ...item, id, shared: true, createdAt: existing?.createdAt ?? item.createdAt ?? time, updatedAt: item.updatedAt ?? time };
    delete kept.ownerId;
    delete kept.page;
    delete kept.store;
    // A spot (spots/<id>/spot.json in the zip) is kept under spots/, with the
    // ids of its items — none, where it came without.
    if (kept.spot === true) kept.itemIds = Array.isArray(kept.itemIds) ? kept.itemIds.map(String) : [];
    else delete kept.spot;
    writeItemFolder(PUBLIC_ID, kept, source ? { ...files, [SOURCE_FILE]: `${JSON.stringify(source, null, 2)}\n` } : files);
    itemsById.set(id, { ...perUnit(kept), ownerId: PUBLIC_ID });
    if (key) publicKeyIndex().set(key, id);
    (existing ? things.replaced : things.added).push(id);
  }
  return { locations: places, items: things };
}

// What the public account already holds, for a sender to compare with what it
// has and send only the rest: each item's id and the crawler's key for it
// (source.json) and when it was last changed, and each place's id and
// address. Not the deleted ones, in deleted/: those are as good as not there.
export function heldPublic() {
  const items = allItemFolders(PUBLIC_ID)
    .filter(({ folder }) => itemsById.get(folder)?.ownerId === PUBLIC_ID && !itemsById.get(folder).deletedAt)
    .map(({ folder: id, spot }) => ({
      id,
      spot,
      key: readItemSource(PUBLIC_ID, id)?.key ?? null,
      // When it was last changed, for a sender to send its own again where
      // that is newer (rab public push).
      updatedAt: itemsById.get(id)?.updatedAt ?? null,
    }));
  const locations = getLocations(PUBLIC_ID).map(({ id, address }) => ({ id, address: address ?? null }));
  return { items, locations };
}

// Whether the public account holds an item under this id, not deleted — what
// heldPublic lists, for one id, without reading every folder.
export function holdsPublic(id) {
  const item = itemsById.get(id);
  return item?.ownerId === PUBLIC_ID && !item.deletedAt;
}

// One of the public account's items taken away outright — its folder and all
// — for the public folder to be the same as the one it is mirrored from (rab
// mirror). Bookings made of it stay, as of an item there no longer is; the
// caller cancels the open ones first. False where it is not _public's.
export function purgePublicItem(id) {
  const item = itemsById.get(id);
  if (!item || item.ownerId !== PUBLIC_ID) return false;
  itemsById.delete(id);
  unsavedItems.delete(id);
  removeItemDir(PUBLIC_ID, id);
  if (publicKeys) for (const [key, at] of publicKeys) if (at === id) publicKeys.delete(key);
  return true;
}

// Some of the public account's places taken off its list in one write (rab
// mirror): how many went, and the ids it did not have.
export function purgePublicLocations(ids) {
  const dropping = new Set(ids);
  if (dropping.size === 0) return { deleted: 0, missing: [] };
  const list = getLocations(PUBLIC_ID);
  const found = new Set(list.map((each) => each.id));
  const kept = list.filter((each) => !dropping.has(each.id));
  if (kept.length !== list.length) writeList(PUBLIC_ID, LOCATIONS_FILE, kept);
  return { deleted: list.length - kept.length, missing: [...dropping].filter((id) => !found.has(id)) };
}

// The public account's places, whole, for another source to take a copy of
// (rab pull).
export function publicLocations() {
  return getLocations(PUBLIC_ID);
}

/* ------------------------------------------------------------------- spots */

// The spots an account makes of what it has out — "Liu's Music Gear Spot".
// A spot is an item like any other — its photographs, its price, where it is,
// when it can be had, booked as one is — with `spot: true` and, in
// `itemIds`, some of the account's own items, in the order it put them: the
// site calls it a page, and everything behind it calls it a spot. It is kept
// in a folder of its own under its owner's spots/ rather than items/ (see
// files.js). An item deleted since is left in the list and left out of what is
// read.
export const SPOTS_MAX = 50;

// Every account has one spot from the first — its default spot, made with
// the account and named after it, and listed first among its pages on its
// profile: a spot like any other, photographs, price, calendar and all,
// that is not deleted and not made somebody else's. An item goes on it where
// the account picks no other spot for it, and whenever it is left on none
// (see keepItemsOnSpots). An account from before there were default spots
// is given one when the server starts, with every item it then had on it, the
// newest first.
function defaultSpotItem(userId) {
  for (const item of itemsById.values()) {
    if (item.default && item.spot && item.ownerId === userId && !item.deletedAt) return item;
  }
  return null;
}

export function defaultSpot(userId) {
  return servedItem(defaultSpotItem(userId));
}

// `fresh` is for an account just opened, which has said nothing of itself
// yet: its spot is not published until its owner publishes it, is reached by
// a message here and no other way, and is booked by asking.
function makeDefaultSpot(userId, { fresh = false } = {}) {
  if (defaultSpotItem(userId)) return;
  const username = usersById.get(userId)?.username ?? "";
  const itemIds = [...itemsById.values()]
    .filter((item) => item.ownerId === userId && !item.spot && !item.shared && !item.deletedAt)
    // Newest first (as newestFirst, which is not defined yet when this runs at
    // start).
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((item) => item.id);
  const spot = spotFromOld({ id: newItemId(now()), name: username, contacts: getContacts(userId), itemIds }, userId);
  spot.default = true;
  if (fresh) {
    spot.active = false;
    spot.contacts = [{ type: "message", value: "" }];
    spot.mode = "inquiry";
    spot.priceUnit = 1440;
  }
  itemsById.set(spot.id, spot);
  changedItem(spot);
}

function ensureDefaultSpots() {
  transaction(() => {
    for (const userId of usersById.keys()) {
      if (userId !== PUBLIC_ID && userId !== ADMIN_ID) {
        makeDefaultSpot(userId);
        keepItemsOnSpots(userId);
      }
    }
  });
}

// Every item of an account's is on at least one of its spots: one on none —
// taken off the last spot it was on, or left on none when that spot was
// deleted — is put on the account's default spot, after what is there.
export function keepItemsOnSpots(userId) {
  const spot = defaultSpotItem(userId);
  if (!spot) return;
  const on = new Set();
  for (const each of itemsById.values()) {
    if (each.spot && !each.deletedAt && each.ownerId === userId) for (const id of each.itemIds ?? []) on.add(String(id));
  }
  const loose = [...itemsById.values()]
    .filter((item) => item.ownerId === userId && !item.spot && !item.deletedAt && !on.has(item.id))
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((item) => item.id);
  if (loose.length === 0) return;
  transaction(() => {
    spot.itemIds = [...(spot.itemIds ?? []), ...loose];
    spot.updatedAt = now();
    changedItem(spot);
  });
}

// Somebody else's spots — the public account's — whose title or place has
// all of `query` in it, as a list to choose from: the published ones, at most
// `limit`, the ones with it in the title first.
export function findSharedSpots(query, limit = 20) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const found = [];
  for (const item of itemsById.values()) {
    if (!item.spot || item.ownerId !== PUBLIC_ID || item.deletedAt || !item.active) continue;
    const title = String(item.title ?? "").toLowerCase();
    const text = `${title} ${String(item.place ?? "").toLowerCase()}`;
    if (!words.every((word) => text.includes(word))) continue;
    found.push({ item, inTitle: words.every((word) => title.includes(word)) });
  }
  return found
    .sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || String(a.item.title).localeCompare(String(b.item.title)))
    .slice(0, limit)
    .map(({ item }) => servedItem(item));
}

// One of the public account's spots by its id, for an item of somebody
// else's to be put on. Null where there is none such.
export function findSharedSpot(id) {
  const spot = liveItem(String(id ?? ""));
  return spot?.spot && spot.ownerId === PUBLIC_ID ? servedItem(spot) : null;
}

// The account's spots, the one made first first, as items go out.
export function getSpots(userId) {
  return [...itemsById.values()]
    .filter((item) => item.spot && item.ownerId === userId && !item.deletedAt)
    // The default spot first, then the rest as they were made.
    .sort((a, b) => Number(b.default === true) - Number(a.default === true) || Number(a.id) - Number(b.id))
    .map(servedItem);
}

// The items on a spot, as a list shows them: only the published ones where
// `publicOnly`, as for somebody else looking at it.
export function spotItems(spot, options) {
  return keptSpotItems(spot, options).map(servedItem);
}

// The same, as little as the map's count of them needs — what each is of and
// whose — for thousands of spots at a time, without making each item whole
// (its rating alone goes through every booking there is).
export function spotItemKinds(spot, options) {
  return keptSpotItems(spot, options).map((item) => ({ category: item.category, ownerId: item.ownerId }));
}

function keptSpotItems(spot, { publicOnly = false } = {}) {
  const kept = itemsById.get(spot.id);
  if (!kept?.spot) return [];
  return (kept.itemIds ?? [])
    .map((id) => liveItem(id))
    .filter(
      (item) =>
        item && !item.spot && item.ownerId === kept.ownerId && (!publicOnly || item.active),
    );
}

// The ids of the items on one of the account's spots, as they now are. Null
// where it has no such spot.
export function setSpotItems(userId, id, itemIds) {
  const spot = liveItem(id);
  if (!spot?.spot || spot.ownerId !== userId) return null;
  transaction(() => {
    spot.itemIds = itemIds.map(String);
    spot.updatedAt = now();
    changedItem(spot);
  });
  return getItem(spot.id);
}

// One of an account's spots by its id — or the id it had before ids were
// times, so a link from then still finds it. Null where it has no such spot.
export function findSpot(userId, id) {
  const spot = liveItem(String(id ?? ""));
  return spot?.spot && spot.ownerId === userId ? servedItem(spot) : null;
}

// The spots an item is on, of its owner's.
export function spotsWith(item) {
  return [...itemsById.values()]
    .filter((spot) => spot.spot && !spot.deletedAt && spot.ownerId === item.ownerId && (spot.itemIds ?? []).includes(item.id))
    .map(servedItem);
}

/* --------------------------------------------------------------- bookmarks */

// The items an account has kept to come back to — other people's, mostly: a
// list of { itemId, createdAt } in its folder's bookmarks.json, the one kept
// last first. Read and written as they are asked for, like the locations. An
// item deleted since is left in the file and left out of what is read.
const BOOKMARKS_FILE = "bookmarks.json";
export const BOOKMARKS_MAX = 1000;

export function isBookmarked(userId, itemId) {
  if (itemsById.get(itemId)?.ownerId === userId) return false;
  return readList(userId, BOOKMARKS_FILE).some((each) => each.itemId === itemId);
}

// Kept (`on`) or let go of. False where the list is as long as it gets.
export function setBookmark(userId, itemId, on) {
  const list = readList(userId, BOOKMARKS_FILE);
  const has = list.some((each) => each.itemId === itemId);
  if (on === has) return true;
  if (on && list.length >= BOOKMARKS_MAX) return false;
  writeList(userId, BOOKMARKS_FILE, on ? [{ itemId, createdAt: now() }, ...list] : list.filter((each) => each.itemId !== itemId));
  return true;
}

// The items themselves, as a list shows them: the ones still there, and still
// shown to anybody. An account's own are never among them.
export function getBookmarkedItems(userId) {
  return readList(userId, BOOKMARKS_FILE)
    .map((each) => liveItem(each.itemId))
    .filter((item) => item && item.active && item.ownerId !== userId)
    .map(servedItem);
}

/* ---------------------------------------------------------------- contacts */

// How an account is reached — [{ type, value }], as an item booked by asking
// carries them (see rates.js) — kept in its folder's user.json as the account
// wrote them on its own sheet, so an item of its own starts with them filled
// in. Read and written as they are asked for, like the locations.
export function getContacts(userId) {
  const { contacts } = readRecord(userId, USER_FILE);
  return Array.isArray(contacts) ? contacts : [];
}

export function saveContacts(userId, contacts) {
  keepAbout(userId, "contacts", contacts);
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
export function deleteUser(userId) {
  const counts = { items: 0, bookings: 0, conversations: 0 };
  transaction(() => {
    for (const [id, item] of itemsById) {
      if (item.ownerId !== userId) continue;
      itemsById.delete(id);
      unsavedItems.delete(id);
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
    if (requestsById) for (const [id, request] of requestsById) if (request.ownerId === userId) requestsById.delete(id);
    // Its own files are not written back: the folder goes whole.
    for (const entry of [...unsaved]) if (entry.startsWith(`${userId}/`)) unsaved.delete(entry);
  });
  removeUserDir(userId);
  // And with the folder, the account: nothing is signed in as it any more.
  deleteSessionsOf.run(userId);
  forget(userId);
  return counts;
}

/* ---------------------------------------------------------------- requests */

// What somebody is looking for, rather than offering: "I need" — a thing, the
// spot it is wanted at, the dates, what they would pay for it, and how they
// are reached. Each is kept in a folder of its own in its maker's requests/
// (see files.js), its photographs beside it, and every account's are held
// here once first asked for: there are few of them, and the map asks for all
// that stand in its window.
export const REQUESTS_MAX = 20;
let requestsById = null;
// A request's id is the millisecond it was made, in Unix time, as an item's
// is. One from before that — "q" and some letters, drawn at random — is given
// the time it was made the first time it is read: its folder is renamed, what
// it was called is kept on it (`was`), and every exchange that was by way of
// it, or says it is about it, is pointed at the new id. A link made with the
// old id still finds it (`requestIdByOldId`).
const requestIdByOldId = new Map();
const TIME_ID_RE = /^\d+$/;

function heldRequests() {
  if (requestsById) return requestsById;
  requestsById = new Map();
  requestIdByOldId.clear();
  for (const userId of usersById.keys()) {
    for (const request of readRequests(userId)) {
      requestsById.set(request.id, { ...request, ownerId: userId });
      if (request.was) requestIdByOldId.set(String(request.was), request.id);
    }
  }
  const renamed = new Map();
  for (const request of [...requestsById.values()]) {
    if (TIME_ID_RE.test(request.id)) continue;
    const was = request.id;
    let stamp = Date.parse(request.createdAt) || Date.now();
    while (requestsById.has(String(stamp)) || itemsById.has(String(stamp))) stamp += 1;
    const id = String(stamp);
    moveRequestDir(request.ownerId, was, id);
    const { ownerId, ...kept } = { ...request, id, was };
    writeRequest(ownerId, kept);
    requestsById.delete(was);
    requestsById.set(id, { ...kept, ownerId });
    requestIdByOldId.set(was, id);
    renamed.set(was, id);
  }
  if (renamed.size > 0) {
    transaction(() => {
      for (const [userId, lines] of messagesByUser) {
        let touched = false;
        for (const line of lines) {
          for (const key of ["via", "requestId"]) {
            if (line[key] && renamed.has(line[key])) {
              line[key] = renamed.get(line[key]);
              touched = true;
            }
          }
        }
        if (touched) changed(userId, "messages.json");
      }
    });
  }
  return requestsById;
}

// Read as the server starts rather than when first asked for, so the ones
// still to be renamed are renamed before anything is served from their
// folders.
heldRequests();

// A request's id as it is now, from the one it may have had before.
export function requestIdNow(id) {
  const held = heldRequests();
  return held.has(id) ? id : (requestIdByOldId.get(id) ?? id);
}

// A request as it goes out: shaped like an item where it can be — a title, a
// category, a pin — so the map and its list draw it the way they draw one,
// and marked as a request (`kind`).
function servedRequest(request) {
  if (!request) return null;
  const { ownerId, ...rest } = request;
  // Its photographs as addresses a browser can ask for, and the first named
  // once more as the one a list or a pin draws — as an item's are.
  const images = (request.images ?? []).map((image) => ({
    src: imageUrl(image.name),
    thumb: imageUrl(image.thumb || image.name),
    width: image.width ?? null,
    height: image.height ?? null,
  }));
  return {
    ...rest,
    images,
    thumb: images[0]?.thumb ?? null,
    pin: images[0] ? `${images[0].thumb}/pin` : null,
    kind: "request",
    owner: nameOf(ownerId),
  };
}

// Still wanted: one whose last date has gone is not listed any more.
const stillWanted = (request) => !request.end || request.end >= now().slice(0, 10);

export function getRequest(id) {
  return servedRequest(heldRequests().get(requestIdNow(id)));
}

// As it is kept, with whose it is: for the server's own use.
export function getRequestHeld(id) {
  return heldRequests().get(requestIdNow(id)) ?? null;
}

export function getRequests() {
  return [...heldRequests().values()]
    .filter(stillWanted)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(servedRequest);
}

export function getRequestsByUser(userId) {
  return [...heldRequests().values()].filter((request) => request.ownerId === userId).map(servedRequest);
}

export function createRequest(userId, request) {
  const held = heldRequests();
  if ([...held.values()].filter((each) => each.ownerId === userId).length >= REQUESTS_MAX) return null;
  // Its id is the millisecond it was made, in Unix time, as an item's is (see
  // newItemId) — the next one free where that one is taken, by a request or
  // by an item: the map lists the two together, by their ids.
  const createdAt = now();
  let stamp = Date.parse(createdAt);
  while (held.has(String(stamp)) || itemsById.has(String(stamp))) stamp += 1;
  const id = String(stamp);
  const kept = { id, ...request, createdAt, ownerId: userId };
  held.set(id, kept);
  writeRequest(userId, { id, ...request, createdAt });
  return servedRequest(kept);
}

// Changed by whoever made it: everything it says is written over, and its id
// and the day it was first asked stay as they were. Null where it is not there
// or not theirs.
export function updateRequest(userId, id, request) {
  const held = heldRequests();
  const before = held.get(id);
  if (!before || before.ownerId !== userId) return null;
  // What it was called before ids were times stays on it too.
  const same = { createdAt: before.createdAt, ...(before.was ? { was: before.was } : null) };
  const kept = { id, ...request, ...same, ownerId: userId };
  held.set(id, kept);
  writeRequest(userId, { id, ...request, ...same });
  return servedRequest(kept);
}

// Its folder goes whole, its photographs with it.
export function deleteRequest(userId, id, { any = false } = {}) {
  const held = heldRequests();
  const request = held.get(id);
  if (!request || (!any && request.ownerId !== userId)) return false;
  held.delete(id);
  removeRequestDir(request.ownerId, id);
  return true;
}

// The files a request carries: its photographs and their small copies.
export function requestImageNames(id) {
  return (heldRequests().get(id)?.images ?? []).flatMap((image) => [image.name, image.thumb]);
}
