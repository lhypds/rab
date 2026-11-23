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
export function readItems(userId) {
  const items = [];
  for (const folder of itemFolders(userId)) {
    const item = readItem(userId, folder);
    if (item) items.push(item);
  }
  return items;
}

export function writeItem(userId, item) {
  const dir = itemDir(userId, item.id);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, ITEM_FILE), item);
}

// An item's whole folder — the item and its photographs — from one account's
// items to another's: what is done when an item becomes the public account's.
export function moveItemDir(fromUserId, toUserId, folder) {
  const from = itemDir(fromUserId, folder);
  const to = itemDir(toUserId, folder);
  if (from === to || !fs.existsSync(from)) return;
  fs.mkdirSync(itemsDir(toUserId), { recursive: true });
  if (fs.existsSync(to)) {
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  } else {
    fs.renameSync(from, to);
  }
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
