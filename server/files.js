import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Where everything that belongs to somebody is kept: one folder per account,
// named after the account's username, under data/users/.
//
//   data/users/<username>/items/<made>/item.json   one thing they have out for rent, calendar included
//   data/users/<username>/items/<made>/<name>      that item's photographs, beside it
//   data/users/<username>/uploads/                 photographs sent and not yet an item's (see images.js)
//   data/users/<username>/user.json                the account itself: its id (when it was made, in
//                                                  Unix time), its password, its email address, how
//                                                  it is reached
//   data/users/<username>/bookings.json            every rental they are one side of
//   data/users/<username>/messages.json            their side of every conversation
//   data/users/<username>/bookmarks.json           the items they have kept to come back to
//   data/users/<username>/stores/<made>/store.json one store they made of their items — what the site
//                                                  shows as a page: a store, a page of spaces or of
//                                                  services — an item like any other (`store: true`)
//                                                  with the ids of the items on it (`itemIds`), kept
//                                                  apart from the items
//   data/users/<username>/stores/<made>/<name>     that store's photographs, beside it
//   data/users/<username>/deleted/items/<made>/    an item deleted, its folder moved here whole (item.json,
//                                                  with deletedAt, and its photographs)
//   data/users/<username>/deleted/spots/<made>/    a store deleted, the same (store.json)
//
// A deleted item is not served, listed or sent anywhere (rab public push
// reads items/ and stores/ only), but it is still read when the server starts:
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
  return { ...item, id: folder };
}

// Every item an account has. A folder with no item.json in it is not an item
// and is passed over; one that cannot be read is an error, as with a list.
// The account's stores among them: each an item like any other, kept in its
// own folder under stores/ rather than items/ (see the stores below). And the
// ones it has deleted, under deleted/ — each with when it was deleted, which
// one put there by hand without it is taken to be when it was last changed.
export function readItems(userId) {
  const items = [];
  for (const folder of itemFolders(userId)) {
    const item = readItem(userId, folder);
    if (item) items.push(item);
  }
  for (const folder of storeFolders(userId)) {
    const store = readStore(userId, folder);
    if (store && isItemStore(store)) items.push({ ...store, store: true });
  }
  for (const { folder, store } of deletedFolders(userId)) {
    const read = readJsonObject(path.join(deletedItemDir(userId, folder, store), store ? STORE_FILE : ITEM_FILE));
    if (!read || (store && !isItemStore(read))) continue;
    const deletedAt = read.deletedAt || read.updatedAt || new Date().toISOString();
    items.push({ ...read, id: folder, deletedAt, ...(store ? { store: true } : null) });
  }
  return items;
}

/* ----------------------------------------------------------------- deleted */

// Where an account's deleted items are moved to: deleted/items/ and, for its
// stores, deleted/spots/.
const deletedDir = (userId, store) => path.join(userDir(userId), "deleted", store ? "spots" : "items");

export function deletedItemDir(userId, folder, store) {
  const name = String(folder ?? "");
  if (!ITEM_FOLDER_RE.test(name)) throw new Error(`not an item's folder: ${name}`);
  return path.join(deletedDir(userId, store), name);
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

// Every folder of an account's deleted items: { folder, store }.
export function deletedFolders(userId) {
  return [
    ...foldersIn(deletedDir(userId, false)).map((folder) => ({ folder, store: false })),
    ...foldersIn(deletedDir(userId, true)).map((folder) => ({ folder, store: true })),
  ];
}

// An item's folder: under deleted/ for one deleted, under stores/ for a store,
// under items/ for anything else.
export const folderOf = (userId, item) =>
  item.deletedAt ? deletedItemDir(userId, item.id, item.store) : item.store ? storeDir(userId, item.id) : itemDir(userId, item.id);

// Every place a folder of that name can be in an account's folder: items/,
// stores/, deleted/items/, deleted/spots/.
const placesOf = (userId, folder) => [
  itemDir(userId, folder),
  storeDir(userId, folder),
  deletedItemDir(userId, folder, false),
  deletedItemDir(userId, folder, true),
];

// Whether an item's folder is where it belongs (folderOf) — not, say, one
// deleted from before deleted items were moved, still in items/.
export const isInPlace = (userId, item) => fs.existsSync(folderOf(userId, item));

// Every folder an account keeps an item in, stores too: { folder, store }.
export function allItemFolders(userId) {
  return [
    ...itemFolders(userId).map((folder) => ({ folder, store: false })),
    ...storeFolders(userId).map((folder) => ({ folder, store: true })),
  ];
}

// The item or store in one folder, as readItems reads it — the store in
// stores/ first, where there is one of the shape it is now. Null where neither
// is.
export function readAnyItem(userId, folder) {
  const store = readStore(userId, folder);
  if (store && isItemStore(store)) return { ...store, store: true };
  return readItem(userId, folder);
}

// The folder an item is in on the disk, wherever it is: stores/ where there
// is one of that name, then items/, then deleted/; items/ where there is none.
export const isStoreFolder = (userId, folder) => fs.existsSync(storeDir(userId, folder));

export function heldDir(userId, folder) {
  const [items, stores, deletedItems, deletedStores] = placesOf(userId, folder);
  return [stores, items, deletedStores, deletedItems].find((dir) => fs.existsSync(dir)) ?? items;
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
  const file = path.join(dir, item.store ? STORE_FILE : ITEM_FILE);
  // A store from before stores were items is written over as the item it is
  // now; what it was is kept beside it, out of the way, the first time.
  if (item.store && !fs.existsSync(`${file}.moved`)) {
    const old = readJsonObject(file);
    if (old && !isItemStore(old)) fs.copyFileSync(file, `${file}.moved`);
  }
  writeJson(file, item);
}

// Where an item came from, as the crawler that wrote it down says
// (data/crawlers): source.json beside item.json (or store.json), with the
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
// store.json, under stores/, for a store), and beside it each of `files` ({
// name: bytes }) — over whatever of those names was there. A folder that is
// not there yet is written beside where it goes, under a name no item's
// folder has, and moved into place, so nothing reading the folders sees half
// of it. An item that was somewhere else before — an item now a store, one
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
  writeJson(path.join(into, item.store ? STORE_FILE : ITEM_FILE), item);
  if (fresh) fs.renameSync(into, dir);
  for (const other of others) fs.rmSync(other, { recursive: true, force: true });
}

// An item's whole folder, gone, wherever it is, deleted/ too: a public item
// taken away outright (rab mirror), not the delete that moves it to deleted/.
export function removeItemDir(userId, folder) {
  for (const dir of placesOf(userId, folder)) fs.rmSync(dir, { recursive: true, force: true });
}

// An item's whole folder — the item and its photographs — from one account's
// items (or stores) to another's: what is done when an item becomes the
// public account's.
export function moveItemDir(fromUserId, toUserId, folder) {
  // The same place in the other account's folder: items/, stores/ or deleted/.
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

/* ------------------------------------------------------------------ stores */

// A store is what the site shows as a page: an item that collects some of
// its owner's other items — a store of things, a page of spaces, a page of
// services. Every store has a folder of its own in its owner's stores/,
// named after the store's id — the millisecond it was made, in Unix time, as
// an item's is — in which store.json is the store, as item.json is an item in
// items/. A store is an item (see db.js), written as one with `store: true`;
// it is only kept apart.
//
// Stores were called pages before, and kept in pages/<id>/page.json with
// `page: true`; the server moves them to where they are now when it starts
// (moveOldStores). Before that a page.json was of a shape of its own — a
// name, a location, no price — which the server makes an item of when it
// starts (see readOldStores), keeping what it was as store.json.moved.
export const STORE_FILE = "store.json";

// Whether a store.json is a store as it is kept now: an item.
const isItemStore = (store) => store.store === true;
// Where an account's pages were all kept, in one list, before they had folders.
const OLD_PAGES_FILE = "pages.json";
// And where they were kept after that, before they were called stores.
const OLD_PAGES_DIR = "pages";
const OLD_PAGE_FILE = "page.json";
const STORE_ID_RE = /^[1-9]\d*$/;

export const storesDir = (userId) => path.join(userDir(userId), "stores");

export function storeDir(userId, folder) {
  const name = String(folder ?? "");
  if (!ITEM_FOLDER_RE.test(name)) throw new Error(`not a store's folder: ${name}`);
  return path.join(storesDir(userId), name);
}

export function storeFolders(userId) {
  try {
    return fs
      .readdirSync(storesDir(userId), { withFileTypes: true })
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

function readStore(userId, folder) {
  const store = readJsonObject(path.join(storeDir(userId, folder), STORE_FILE));
  return store ? { ...store, id: folder } : null;
}

// The pages an account had from before they were called stores — pages/<id>/
// with page.json, `page: true` — moved to stores/<id>/ with store.json,
// `store: true`, once. One of the shape from before pages were items is
// moved as it is, for readOldStores to make an item of.
function movePagesToStores(userId) {
  const old = path.join(userDir(userId), OLD_PAGES_DIR);
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
    const to = storeDir(userId, entry.name);
    if (fs.existsSync(to)) {
      console.warn(`rab: ${from} was not moved: ${to} is already there`);
      continue;
    }
    for (const suffix of ["", ".moved"]) {
      const file = path.join(from, OLD_PAGE_FILE + suffix);
      if (fs.existsSync(file)) fs.renameSync(file, path.join(from, STORE_FILE + suffix));
    }
    const record = readJsonObject(path.join(from, STORE_FILE));
    if (record && record.page === true) {
      const { page, ...rest } = record;
      writeJson(path.join(from, STORE_FILE), { ...rest, store: true });
    }
    fs.mkdirSync(storesDir(userId), { recursive: true });
    fs.renameSync(from, to);
  }
  // What is left — a crawler's lock file, a folder that could not be moved —
  // stays; the folder goes only where it is empty.
  try {
    fs.rmdirSync(old);
  } catch {}
}

// Stores from before they were kept as they are now, put the way they are
// now, once: pages/ moved to stores/ (above); and before that, the one list
// an account had given a folder for each page in it, and kept beside them as
// pages.json.moved. A store whose id was drawn at random is given the
// millisecond it was made for its id and its folder's name, and still says
// what it was called then (`was`), so a link to it from then still finds it.
export function moveOldStores(userId) {
  movePagesToStores(userId);
  const old = path.join(userDir(userId), OLD_PAGES_FILE);
  if (fs.existsSync(old)) {
    for (const store of readList(userId, OLD_PAGES_FILE)) {
      if (!store?.id || !ITEM_FOLDER_RE.test(String(store.id))) continue;
      if (!fs.existsSync(path.join(storeDir(userId, store.id), STORE_FILE))) writeStore(userId, store);
    }
    fs.renameSync(old, `${old}.moved`);
  }
  const taken = new Set(storeFolders(userId));
  for (const folder of [...taken]) {
    if (STORE_ID_RE.test(folder)) continue;
    const store = readStore(userId, folder);
    if (!store) continue;
    let stamp = Date.parse(store.createdAt);
    if (!Number.isFinite(stamp)) stamp = Date.now();
    while (taken.has(String(stamp))) stamp += 1;
    const id = String(stamp);
    taken.add(id);
    fs.renameSync(storeDir(userId, folder), storeDir(userId, id));
    writeStore(userId, { ...store, id, was: store.was ?? folder });
  }
}

// The stores an account has that are still of the old shape and not yet an
// item: what the server makes items of when it starts (see db.js).
export function readOldStores(userId) {
  moveOldStores(userId);
  return storeFolders(userId)
    .map((folder) => readStore(userId, folder))
    .filter((store) => store && !isItemStore(store));
}

// A store's folder given another name: what an old store whose id is already
// an item's is moved to.
export function moveStoreDir(userId, from, to) {
  fs.renameSync(storeDir(userId, from), storeDir(userId, to));
}

function writeStore(userId, store) {
  const dir = storeDir(userId, store.id);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, STORE_FILE), store);
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
