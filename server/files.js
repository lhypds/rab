import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Where everything that belongs to somebody is kept: one folder per account,
// named after the account's username, under data/users/.
//
//   data/users/<username>/items.json      what they have out for rent, calendar included
//   data/users/<username>/bookings.json   every rental they are one side of
//   data/users/<username>/messages.json   their side of every conversation
//   data/users/<username>/images/         the photographs they uploaded
//
// db.sqlite knows the account — its name, its password, when it was made — and
// nothing of what the account has done.
//
// Everything in the folders, and everything in the server, still points at an
// account by its id; only the folder's name is the username. Which name goes
// with which id is the database's to say, and it says it here (`nameFolders`)
// before any folder is opened.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const dataDir = process.env.RAB_DATA || path.resolve(__dirname, "..", "data");
export const usersDir = path.join(dataDir, "users");

let names = null;

// Told once, by the database: how to get an account's username from its id
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

// The ids of the accounts that have a folder. A folder no account is called
// is left alone and not read.
export function userFolders() {
  return folders()
    .map((name) => names?.idOf(name) ?? null)
    .filter((id) => id !== null);
}

// An account's whole folder, gone: what is done when the account is deleted.
// Asked for by id while the database still knows the name that goes with it.
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

// Written beside the file and moved over it, so a crash mid-write leaves the
// old file whole rather than half of the new one.
export function writeList(userId, name, list) {
  const dir = userDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const partial = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(partial, `${JSON.stringify(list, null, 2)}\n`);
  fs.renameSync(partial, file);
}
