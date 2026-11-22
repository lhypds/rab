import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Where everything that belongs to somebody is kept: one folder per account,
// named after the account's id, under data/users/.
//
//   data/users/<id>/items.json      what they have out for rent, calendar included
//   data/users/<id>/bookings.json   every rental they are one side of
//   data/users/<id>/messages.json   their side of every conversation
//   data/users/<id>/images/         the photographs they uploaded
//
// db.sqlite knows the account — its name, its password, when it was made — and
// nothing of what the account has done.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const dataDir = process.env.RAB_DATA || path.resolve(__dirname, "..", "data");
export const usersDir = path.join(dataDir, "users");

export function userDir(userId) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`not a user id: ${userId}`);
  return path.join(usersDir, String(id));
}

// The ids of the accounts that have a folder.
export function userFolders() {
  try {
    return fs
      .readdirSync(usersDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[1-9]\d*$/.test(entry.name))
      .map((entry) => Number(entry.name));
  } catch {
    return [];
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
