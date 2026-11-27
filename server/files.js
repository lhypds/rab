import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Where everything that belongs to somebody is kept: one folder per account,
// named after the account's username, under data/users/.
//
//   data/users/<username>/items/<made>/item.json   one thing they have out for rent, calendar included
//   data/users/<username>/items/<made>/item.<en|zh|ja>.json   its name, what it is and its description in that language
//   data/users/<username>/items/<made>/<name>      that item's photographs, beside it
//   data/users/<username>/uploads/                 photographs sent and not yet an item's (see images.js)
//   data/users/<username>/user.json                the account itself: its id (when it was made, in
//                                                  Unix time), its password, its email address, how
//                                                  it is reached
//   data/users/<username>/bookings.json            every rental they are one side of
//   data/users/<username>/messages.json            their side of every conversation
//   data/users/<username>/bookmarks.json           the items they have kept to come back to
//   data/users/<username>/spots/<made>/spot.json   one spot they made of their items: a shop, a page
//                                                  of spaces or of services — an item like any
//                                                  other (`spot: true`)
//                                                  with the ids of the items on it (`itemIds`), kept
//                                                  apart from the items
//   data/users/<username>/spots/<made>/<name>      that spot's photographs, beside it
//   data/users/<username>/requests/<id>/request.json  one thing they are looking for ("I need")
//   data/users/<username>/requests/<id>/<name>     that request's photographs, beside it
//   data/users/<username>/deleted/items/<made>/    an item deleted, its folder moved here whole (item.json,
//                                                  with deletedAt, and its photographs)
//   data/users/<username>/deleted/spots/<made>/    a spot deleted, the same (spot.json)
//
// A deleted item is not served, listed or sent anywhere (rab public push
// reads items/ and spots/ only), but it is still read when the server starts:
// the bookings made of it and the messages about it still say what it was.
//
// <made> is when the item was made, in Unix time to the millisecond. It is the
// item's id — what its address and everything else points at it by — and its
// folder's name, both.
//
// The folder is the account: there is no other list of them. db.sqlite knows
// only who is signed in.
//
// Everything in the folders, and everything in the server, points at an
// account by its id, which its user.json says; only the folder's name is the
// username. Which name goes with which id is read from those files when the
// server starts (see db.js), and said here (`nameFolders`) before any other
// file is opened.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const dataDir = process.env.RAB_DATA || path.resolve(__dirname, "..", "data");
export const usersDir = path.join(dataDir, "users");

let names = null;

// Told once, by db.js: how to get an account's username from its id
// (`nameOf`) and its id from its username (`idOf`); either gives null for an
// account there is not.
export function nameFolders(lookup) {
  names = lookup;
}

// A username as a folder's name: one piece of a path and nothing cleverer.
function folderName(username) {
  const name = String(username ?? "");
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) throw new Error(`not a folder name: ${name}`);
  return name;
}

export function userDir(userId) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`not a user id: ${userId}`);
  const username = names?.nameOf(id);
  if (!username) throw new Error(`no account has the id ${id}`);
  return path.join(usersDir, folderName(username));
}

function folders() {
  try {
    return fs
      .readdirSync(usersDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// Every folder with the file an account keeps about itself in it (see db.js),
// as { username, record }: the folder's name, and what the file says. This is
// asked before it is known which folder is whose, and is how that is learned.
// A folder without the file is passed over; a file that is there and cannot
// be read is an error, as everywhere here.
export function accountFolders(file) {
  const found = [];
  for (const username of folders()) {
    let text;
    try {
      text = fs.readFileSync(path.join(usersDir, username, file), "utf8");
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
      throw error;
    }
    const record = JSON.parse(text);
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`${path.join(usersDir, username, file)} is not a record`);
    found.push({ username, record });
  }
  return found;
}

// The ids of the accounts that have a folder. A folder no account is called
// is left alone and not read.
export function userFolders() {
  return folders()
    .map((name) => names?.idOf(name) ?? null)
    .filter((id) => id !== null);
}

// An account's whole folder, gone: what is done when the account is deleted.
// Asked for by id while it is still known which name goes with it.
export function removeUserDir(userId) {
  fs.rmSync(userDir(userId), { recursive: true, force: true });
}

// The folders used to be named after the account's id. One that still is — a
// number, the id of an account, and not itself anybody's username — is given
// its account's name, once.
export function renameNumberedFolders() {
  for (const name of folders()) {
    if (!/^[1-9]\d*$/.test(name) || names?.idOf(name) != null) continue;
    const username = names?.nameOf(Number(name));
    if (!username) continue;
    const to = path.join(usersDir, folderName(username));
    if (fs.existsSync(to)) {
      console.warn(`rab: data/users/${name} was not renamed: data/users/${username} is already there`);
      continue;
    }
    fs.renameSync(path.join(usersDir, name), to);
    console.log(`rab: data/users/${name} is now data/users/${username}`);
  }
}

// Written beside the file and moved over it, so a crash mid-write leaves the
// old file whole rather than half of the new one.
function writeJson(file, value) {
  const partial = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(partial, file);
}

/* ------------------------------------------------------------------- items */

// Every item has a folder of its own in its owner's items/, named after the
// item's id — the millisecond it was made (see db.js) — in which item.json is
// the item, and the pictures beside it are its own.
export const ITEM_FILE = "item.json";

// What an item says of itself — its name, its few words for what it is and
// its description — is in item.json, in the language it was written in:
// English, for what the phone's scanner names. That is the default, and what
// is shown where a reader's language has no file of its own. Beside it, the
// same said in each language it has been said in:
//
//   item.en.json   English
//   item.zh.json   Chinese
//   item.ja.json   Japanese
//
// each { title, what, description } and nothing else: nothing else about an
// item is translated. A spot's are spot.en.json and so on. In memory they are
// the item's `translations` — { en, zh, ja } — which is never written into
// item.json itself.
export const TEXT_LANGUAGES = ["en", "zh", "ja"];

const languageFile = (file, code) => file.replace(/\.json$/, `.${code}.json`);

// The languages an item's file has files beside it for, or null where it has
// none. One that cannot be read is passed over: the default stands in.
function readTranslations(file) {
  const kept = {};
  for (const code of TEXT_LANGUAGES) {
    // Asked first whether it is there: most items have none, and a read that
    // fails costs three times what asking does — for every item, at a start.
    const from = languageFile(file, code);
    if (!fs.existsSync(from)) continue;
    let words;
    try {
      words = JSON.parse(fs.readFileSync(from, "utf8"));
    } catch {
      continue;
    }
    if (!words || typeof words !== "object" || Array.isArray(words)) continue;
    kept[code] = {
      title: String(words.title ?? ""),
      what: String(words.what ?? ""),
      description: String(words.description ?? ""),
    };
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

// Each language's file written beside the item's own, and the file of a
// language it no longer says anything in taken away.
function writeTranslations(file, translations) {
  for (const code of TEXT_LANGUAGES) {
    const words = translations?.[code];
    if (words) {
      writeJson(languageFile(file, code), {
        title: words.title ?? "",
        what: words.what ?? "",
        description: words.description ?? "",
      });
    } else {
      fs.rmSync(languageFile(file, code), { force: true });
    }
  }
}

// An item's folder's name: one piece of a path and nothing cleverer.
const ITEM_FOLDER_RE = /^[A-Za-z0-9_-]+$/;

export const itemsDir = (userId) => path.join(userDir(userId), "items");

export function itemDir(userId, folder) {
  const name = String(folder ?? "");
  if (!ITEM_FOLDER_RE.test(name)) throw new Error(`not an item's folder: ${name}`);
  return path.join(itemsDir(userId), name);
}

// The names of the item folders an account has.
export function itemFolders(userId) {
  try {
    return fs
      .readdirSync(itemsDir(userId), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && ITEM_FOLDER_RE.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// The item in one folder of an account's items, or null where the folder has
// no item.json in it. One that is there and cannot be read is an error. The
// folder's name is the item's id, whatever the file says.
export function readItem(userId, folder) {
  const file = path.join(itemDir(userId, folder), ITEM_FILE);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const item = JSON.parse(text);
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${file} is not an item`);
  // With what it says in other languages, from the files beside it.
  const translations = readTranslations(file);
  return { ...item, id: folder, ...(translations && { translations }) };
}

// Every item an account has. A folder with no item.json in it is not an item
// and is passed over; one that cannot be read is an error, as with a list.
// The account's spots among them: each an item like any other, kept in its
// own folder under spots/ rather than items/ (see the spots below). And the
// ones it has deleted, under deleted/ — each with when it was deleted, which
// one put there by hand without it is taken to be when it was last changed.
export function readItems(userId) {
  const items = [];
  for (const folder of itemFolders(userId)) {
    const item = readItem(userId, folder);
    if (item) items.push(item);
  }
  for (const folder of spotFolders(userId)) {
    const spot = readSpot(userId, folder);
    if (spot && isItemSpot(spot)) items.push({ ...spot, spot: true });
  }
  for (const { folder, spot } of deletedFolders(userId)) {
    const read = readJsonObject(path.join(deletedItemDir(userId, folder, spot), spot ? SPOT_FILE : ITEM_FILE));
    if (!read || (spot && !isItemSpot(read))) continue;
    const deletedAt = read.deletedAt || read.updatedAt || new Date().toISOString();
    items.push({ ...read, id: folder, deletedAt, ...(spot ? { spot: true } : null) });
  }
  return items;
}

/* ----------------------------------------------------------------- deleted */

// Where an account's deleted items are moved to: deleted/items/ and, for its
// spots, deleted/spots/.
const deletedDir = (userId, spot) => path.join(userDir(userId), "deleted", spot ? "spots" : "items");

export function deletedItemDir(userId, folder, spot) {
  const name = String(folder ?? "");
  if (!ITEM_FOLDER_RE.test(name)) throw new Error(`not an item's folder: ${name}`);
  return path.join(deletedDir(userId, spot), name);
}

function foldersIn(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && ITEM_FOLDER_RE.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// Every folder of an account's deleted items: { folder, spot }.
export function deletedFolders(userId) {
  return [
    ...foldersIn(deletedDir(userId, false)).map((folder) => ({ folder, spot: false })),
    ...foldersIn(deletedDir(userId, true)).map((folder) => ({ folder, spot: true })),
  ];
}

// An item's folder: under deleted/ for one deleted, under spots/ for a spot,
// under items/ for anything else.
export const folderOf = (userId, item) =>
  item.deletedAt ? deletedItemDir(userId, item.id, item.spot) : item.spot ? spotDir(userId, item.id) : itemDir(userId, item.id);

// Every place a folder of that name can be in an account's folder: items/,
// spots/, deleted/items/, deleted/spots/.
const placesOf = (userId, folder) => [
  itemDir(userId, folder),
  spotDir(userId, folder),
  deletedItemDir(userId, folder, false),
  deletedItemDir(userId, folder, true),
];

// Whether an item's folder is where it belongs (folderOf) — not, say, one
// deleted from before deleted items were moved, still in items/.
export const isInPlace = (userId, item) => fs.existsSync(folderOf(userId, item));

// Every folder an account keeps an item in, spots too: { folder, spot }.
export function allItemFolders(userId) {
  return [
    ...itemFolders(userId).map((folder) => ({ folder, spot: false })),
    ...spotFolders(userId).map((folder) => ({ folder, spot: true })),
  ];
}

// The item or spot in one folder, as readItems reads it — the spot in
// spots/ first, where there is one of the shape it is now. Null where neither
// is.
export function readAnyItem(userId, folder) {
  const spot = readSpot(userId, folder);
  if (spot && isItemSpot(spot)) return { ...spot, spot: true };
  return readItem(userId, folder);
}

// The folder an item is in on the disk, wherever it is: spots/ where there
// is one of that name, then items/, then deleted/; items/ where there is none.
export const isSpotFolder = (userId, folder) => fs.existsSync(spotDir(userId, folder));

export function heldDir(userId, folder) {
  const [items, spots, deletedItems, deletedSpots] = placesOf(userId, folder);
  return [spots, items, deletedSpots, deletedItems].find((dir) => fs.existsSync(dir)) ?? items;
}

// An item written where it belongs. Its folder, where it is somewhere else —
// the item deleted since, so going to deleted/ — is moved there first, whole.
export function writeItem(userId, item) {
  const dir = folderOf(userId, item);
  if (!fs.existsSync(dir)) {
    const was = placesOf(userId, item.id).find((each) => each !== dir && fs.existsSync(each));
    if (was) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      fs.renameSync(was, dir);
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, item.spot ? SPOT_FILE : ITEM_FILE);
  // A spot from before spots were items is written over as the item it is
  // now; what it was is kept beside it, out of the way, the first time.
  if (item.spot && !fs.existsSync(`${file}.moved`)) {
    const old = readJsonObject(file);
    if (old && !isItemSpot(old)) fs.copyFileSync(file, `${file}.moved`);
  }
  // Its other languages go in their own files beside it, not in it.
  const { translations, ...kept } = item;
  writeJson(file, kept);
  writeTranslations(file, translations);
}

// Where an item came from, as the crawler that wrote it down says
// (data/crawlers): source.json beside item.json (or spot.json), with the
// `key` it knows the thing by. Null where there is none, or none that can be
// read.
export const SOURCE_FILE = "source.json";

export function readItemSource(userId, folder) {
  try {
    const source = JSON.parse(fs.readFileSync(path.join(heldDir(userId, folder), SOURCE_FILE), "utf8"));
    return source && typeof source === "object" && !Array.isArray(source) ? source : null;
  } catch {
    return null;
  }
}

// An item's folder written whole from what was sent for it — item.json (or
// spot.json, under spots/, for a spot), and beside it each of `files` ({
// name: bytes }) — over whatever of those names was there. A folder that is
// not there yet is written beside where it goes, under a name no item's
// folder has, and moved into place, so nothing reading the folders sees half
// of it. An item that was somewhere else before — an item now a spot, one
// deleted here and sent again — has its old folder taken away once the new one
// is in place.
export function writeItemFolder(userId, item, files) {
  const dir = folderOf(userId, item);
  const others = placesOf(userId, item.id).filter((each) => each !== dir);
  const fresh = !fs.existsSync(dir);
  const into = fresh ? path.join(path.dirname(dir), `.${item.id}.${process.pid}.tmp`) : dir;
  if (fresh) fs.rmSync(into, { recursive: true, force: true });
  fs.mkdirSync(into, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(into, name), bytes);
  const { translations, ...kept } = item;
  writeJson(path.join(into, item.spot ? SPOT_FILE : ITEM_FILE), kept);
  writeTranslations(path.join(into, item.spot ? SPOT_FILE : ITEM_FILE), translations);
  if (fresh) fs.renameSync(into, dir);
  for (const other of others) fs.rmSync(other, { recursive: true, force: true });
}

// An item's whole folder, gone, wherever it is, deleted/ too: a public item
// taken away outright (rab mirror), not the delete that moves it to deleted/.
export function removeItemDir(userId, folder) {
  for (const dir of placesOf(userId, folder)) fs.rmSync(dir, { recursive: true, force: true });
}

// An item's whole folder — the item and its photographs — from one account's
// items (or spots) to another's: what is done when an item becomes the
// public account's.
export function moveItemDir(fromUserId, toUserId, folder) {
  // The same place in the other account's folder: items/, spots/ or deleted/.
  const at = placesOf(fromUserId, folder).findIndex((dir) => fs.existsSync(dir));
  if (at === -1) return;
  const from = placesOf(fromUserId, folder)[at];
  const to = placesOf(toUserId, folder)[at];
  if (from === to) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) {
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  } else {
    fs.renameSync(from, to);
  }
}

/* ------------------------------------------------------------------ spots */

// A spot is an item that collects some of its owner's other items — a shop
// of things, a page of spaces, a page of services. Every spot has a folder of its own in its owner's spots/,
// named after the spot's id — the millisecond it was made, in Unix time, as
// an item's is — in which spot.json is the spot, as item.json is an item in
// items/. A spot is an item (see db.js), written as one with `spot: true`;
// it is only kept apart.
//
// Spots were called stores before, kept in stores/<id>/store.json with
// `store: true`, and pages before that, kept in pages/<id>/page.json with
// `page: true`; the server moves them to where they are now when it starts
// (moveOldSpots). Before that a page.json was of a shape of its own — a
// name, a location, no price — which the server makes an item of when it
// starts (see readOldSpots), keeping what it was as spot.json.moved.
export const SPOT_FILE = "spot.json";

// Whether a spot.json is a spot as it is kept now: an item.
const isItemSpot = (spot) => spot.spot === true;
// Where an account's pages were all kept, in one list, before they had folders.
const OLD_PAGES_FILE = "pages.json";
// And where they were kept after that, when each had a folder.
const OLD_PAGES_DIR = "pages";
const OLD_PAGE_FILE = "page.json";
// And after that, when they were called stores.
const OLD_STORES_DIR = "stores";
const OLD_STORE_FILE = "store.json";
const SPOT_ID_RE = /^[1-9]\d*$/;

export const spotsDir = (userId) => path.join(userDir(userId), "spots");

export function spotDir(userId, folder) {
  const name = String(folder ?? "");
  if (!ITEM_FOLDER_RE.test(name)) throw new Error(`not a spot's folder: ${name}`);
  return path.join(spotsDir(userId), name);
}

export function spotFolders(userId) {
  try {
    return fs
      .readdirSync(spotsDir(userId), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && ITEM_FOLDER_RE.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// What one JSON file holds, where it is an object; null where the file is not
// there. One that is there and cannot be read is an error.
function readJsonObject(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} is not an object`);
  return value;
}

function readSpot(userId, folder) {
  const spot = readJsonObject(path.join(spotDir(userId, folder), SPOT_FILE));
  return spot ? { ...spot, id: folder } : null;
}

// A record from when spots were called something else, in `dir`, as it is
// kept now: <oldFile> (and what was kept beside it as <oldFile>.moved) named
// spot.json, and the mark that it is one (`page: true`, `store: true`) said
// as `spot: true`.
function renameSpotRecord(dir, oldFile) {
  for (const suffix of ["", ".moved"]) {
    const file = path.join(dir, oldFile + suffix);
    if (fs.existsSync(file)) fs.renameSync(file, path.join(dir, SPOT_FILE + suffix));
  }
  const record = readJsonObject(path.join(dir, SPOT_FILE));
  if (record && (record.page === true || record.store === true)) {
    const { page, store, ...rest } = record;
    writeJson(path.join(dir, SPOT_FILE), { ...rest, spot: true });
  }
}

// The spots an account had from before they were called so — pages/<id>/
// with page.json, `page: true`; stores/<id>/ with store.json, `store: true`
// — moved to spots/<id>/ with spot.json, `spot: true`, once. One of the
// shape from before pages were items is moved as it is, for readOldSpots to
// make an item of.
function moveFoldersToSpots(userId, oldDir, oldFile) {
  const old = path.join(userDir(userId), oldDir);
  let entries;
  try {
    entries = fs.readdirSync(old, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !ITEM_FOLDER_RE.test(entry.name)) continue;
    const from = path.join(old, entry.name);
    const to = spotDir(userId, entry.name);
    if (fs.existsSync(to)) {
      console.warn(`rab: ${from} was not moved: ${to} is already there`);
      continue;
    }
    renameSpotRecord(from, oldFile);
    fs.mkdirSync(spotsDir(userId), { recursive: true });
    fs.renameSync(from, to);
  }
  // What is left — a crawler's lock file, a folder that could not be moved —
  // stays; the folder goes only where it is empty.
  try {
    fs.rmdirSync(old);
  } catch {}
}

// The spots an account deleted when they were called stores, in
// deleted/spots/ as they were then: each store.json named spot.json and
// marked `spot: true`, once.
function renameDeletedStores(userId) {
  for (const folder of foldersIn(deletedDir(userId, true))) {
    const dir = deletedItemDir(userId, folder, true);
    if (fs.existsSync(path.join(dir, OLD_STORE_FILE)) && !fs.existsSync(path.join(dir, SPOT_FILE))) renameSpotRecord(dir, OLD_STORE_FILE);
  }
}

// Spots from before they were kept as they are now, put the way they are
// now, once: pages/ and stores/ moved to spots/ (above); and before that, the one list
// an account had given a folder for each page in it, and kept beside them as
// pages.json.moved. A spot whose id was drawn at random is given the
// millisecond it was made for its id and its folder's name, and still says
// what it was called then (`was`), so a link to it from then still finds it.
export function moveOldSpots(userId) {
  moveFoldersToSpots(userId, OLD_PAGES_DIR, OLD_PAGE_FILE);
  moveFoldersToSpots(userId, OLD_STORES_DIR, OLD_STORE_FILE);
  renameDeletedStores(userId);
  const old = path.join(userDir(userId), OLD_PAGES_FILE);
  if (fs.existsSync(old)) {
    for (const spot of readList(userId, OLD_PAGES_FILE)) {
      if (!spot?.id || !ITEM_FOLDER_RE.test(String(spot.id))) continue;
      if (!fs.existsSync(path.join(spotDir(userId, spot.id), SPOT_FILE))) writeSpot(userId, spot);
    }
    fs.renameSync(old, `${old}.moved`);
  }
  const taken = new Set(spotFolders(userId));
  for (const folder of [...taken]) {
    if (SPOT_ID_RE.test(folder)) continue;
    const spot = readSpot(userId, folder);
    if (!spot) continue;
    let stamp = Date.parse(spot.createdAt);
    if (!Number.isFinite(stamp)) stamp = Date.now();
    while (taken.has(String(stamp))) stamp += 1;
    const id = String(stamp);
    taken.add(id);
    fs.renameSync(spotDir(userId, folder), spotDir(userId, id));
    writeSpot(userId, { ...spot, id, was: spot.was ?? folder });
  }
}

// The spots an account has that are still of the old shape and not yet an
// item: what the server makes items of when it starts (see db.js).
export function readOldSpots(userId) {
  moveOldSpots(userId);
  return spotFolders(userId)
    .map((folder) => readSpot(userId, folder))
    .filter((spot) => spot && !isItemSpot(spot));
}

// A spot's folder given another name: what an old spot whose id is already
// an item's is moved to.
export function moveSpotDir(userId, from, to) {
  fs.renameSync(spotDir(userId, from), spotDir(userId, to));
}

function writeSpot(userId, spot) {
  const dir = spotDir(userId, spot.id);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, SPOT_FILE), spot);
}

/* ---------------------------------------------------------------- requests */

// Every request ("I need") has a folder of its own in its maker's requests/,
// named after the request's id, in which request.json is the request and the
// pictures beside it are its own — as an item has.
export const REQUEST_FILE = "request.json";
// What they were all kept in once, one list to an account: read the first
// time and put into folders (see readRequests).
const OLD_REQUESTS_FILE = "requests.json";
const REQUEST_FOLDER_RE = /^[a-z0-9]+$/;

export const requestsDir = (userId) => path.join(userDir(userId), "requests");

export function requestDir(userId, id) {
  const name = String(id ?? "");
  if (!REQUEST_FOLDER_RE.test(name)) throw new Error(`not a request's folder: ${name}`);
  return path.join(requestsDir(userId), name);
}

// The names of the request folders an account has.
export function requestFolders(userId) {
  try {
    return fs
      .readdirSync(requestsDir(userId), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && REQUEST_FOLDER_RE.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export function writeRequest(userId, request) {
  const dir = requestDir(userId, request.id);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, REQUEST_FILE), request);
}

// A request's folder under another name — its new id — photographs and all.
export function moveRequestDir(userId, from, to) {
  fs.renameSync(requestDir(userId, from), requestDir(userId, to));
}

// A request's whole folder, gone: the request and its photographs.
export function removeRequestDir(userId, id) {
  fs.rmSync(requestDir(userId, id), { recursive: true, force: true });
}

// Every request an account has. A folder with no request.json in it is not a
// request and is passed over; one that cannot be read is an error. The
// folder's name is the request's id, whatever the file says. An account still
// keeping them as one list has each put into a folder of its own first, and
// the list set aside (requests.json.moved) rather than thrown away.
export function readRequests(userId) {
  const old = path.join(userDir(userId), OLD_REQUESTS_FILE);
  if (fs.existsSync(old)) {
    for (const request of readList(userId, OLD_REQUESTS_FILE)) {
      if (!REQUEST_FOLDER_RE.test(String(request?.id ?? ""))) continue;
      if (!fs.existsSync(path.join(requestDir(userId, request.id), REQUEST_FILE))) writeRequest(userId, request);
    }
    fs.renameSync(old, `${old}.moved`);
  }
  const requests = [];
  for (const folder of requestFolders(userId)) {
    const request = readJsonObject(path.join(requestDir(userId, folder), REQUEST_FILE));
    if (request) requests.push({ ...request, id: folder });
  }
  return requests;
}

/* ------------------------------------------------------------------- lists */

// A list kept in one of a user's files; empty where the file is not there yet.
// A file that is there and cannot be read is an error, not an empty list: the
// next save would otherwise write that emptiness over whatever is in it.
export function readList(userId, name) {
  let text;
  try {
    text = fs.readFileSync(path.join(userDir(userId), name), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`${path.join(userDir(userId), name)} is not a list`);
  return parsed;
}

export function writeList(userId, name, list) {
  const dir = userDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, name), list);
}

// One thing kept in one of a user's files, as an object; empty where the file
// is not there yet. As with a list, a file that is there and cannot be read is
// an error.
export function readRecord(userId, name) {
  let text;
  try {
    text = fs.readFileSync(path.join(userDir(userId), name), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${path.join(userDir(userId), name)} is not a record`);
  return parsed;
}

export function writeRecord(userId, name, record) {
  const dir = userDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, name), record);
}
