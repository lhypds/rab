import fs from "node:fs";
import path from "node:path";
import { ITEM_FILE, accountFolders, dataDir, itemDir, itemFolders, readList, userDir, userFolders, usersDir, writeItem, writeList } from "./files.js";

// rab used to keep everything in db.sqlite and every photograph in one folder,
// data/images/. This moves a database from then into the users' folders (see
// files.js), once: the items, the calendar's exceptions, the bookings and the
// messages are written out as files, the photographs follow their items, and
// the tables they came from are dropped. A copy of the database as it was is
// left beside it first.

function list(text) {
  try {
    const parsed = JSON.parse(text ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

export function moveIntoFolders(db, databasePath) {
  if (!hasTable(db, "items")) return;

  const backup = `${databasePath}.before-folders`;
  if (!fs.existsSync(backup)) db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);

  const files = new Map();
  const folder = (userId) => {
    if (!files.has(userId)) files.set(userId, { items: [], bookings: new Map(), messages: [] });
    return files.get(userId);
  };
  for (const { id } of db.prepare("SELECT id FROM users").all()) folder(id);

  const days = new Map();
  if (hasTable(db, "item_days")) {
    for (const row of db.prepare("SELECT * FROM item_days ORDER BY day").all()) {
      if (!days.has(row.item_id)) days.set(row.item_id, []);
      days.get(row.item_id).push({ day: row.day, available: row.available === 1, price: row.price });
    }
  }

  const owners = new Map();
  for (const row of db.prepare("SELECT * FROM items ORDER BY created_at").all()) {
    owners.set(row.id, row.user_id);
    folder(row.user_id).items.push({
      id: row.id,
      title: row.title,
      description: row.description,
      kind: row.kind ?? "item",
      category: row.category ?? "",
      mode: row.mode ?? "day",
      rates: list(row.rates),
      hours: list(row.hours),
      price: row.price,
      currency: row.currency,
      located: (row.has_location ?? 1) === 1,
      latitude: row.latitude,
      longitude: row.longitude,
      place: row.place,
      region:
        row.region_name && row.region_south != null
          ? {
              name: row.region_name,
              detail: row.region_detail ?? "",
              bbox: [row.region_west, row.region_south, row.region_east, row.region_north],
            }
          : null,
      images: list(row.images),
      active: row.active === 1,
      days: days.get(row.id) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    });
  }

  if (hasTable(db, "bookings")) {
    for (const row of db.prepare("SELECT * FROM bookings ORDER BY id").all()) {
      const ownerId = owners.get(row.item_id);
      if (ownerId === undefined) continue;
      const booking = {
        id: row.id,
        itemId: row.item_id,
        ownerId,
        renterId: row.renter_id,
        start: row.start_day,
        end: row.end_day,
        startTime: row.start_time ?? null,
        endTime: row.end_time ?? null,
        total: row.total,
        currency: row.currency,
        note: row.note,
        status: row.status,
        slots: row.slots ? list(row.slots) : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      folder(ownerId).bookings.set(booking.id, booking);
      folder(row.renter_id).bookings.set(booking.id, booking);
    }
  }

  if (hasTable(db, "messages")) {
    for (const row of db.prepare("SELECT * FROM messages ORDER BY id").all()) {
      const line = {
        id: row.id,
        body: row.body,
        kind: row.kind,
        bookingId: row.booking_id,
        time: row.created_at,
        read: row.read_at !== null,
      };
      // A side that had deleted the conversation simply does not get the line.
      if (!row.hidden_from) folder(row.from_user).messages.push({ ...line, with: row.to_user, mine: true });
      if (!row.hidden_to) folder(row.to_user).messages.push({ ...line, with: row.from_user, mine: false });
    }
  }

  // The photographs go where their items went. Copied first and removed after,
  // since two items of two owners may carry the same picture.
  const oldImages = path.join(dataDir, "images");
  const moved = new Set();
  for (const [userId, { items }] of files) {
    for (const name of items.flatMap((item) => item.images.flatMap((image) => [image.name, image.thumb]))) {
      const from = path.join(oldImages, path.basename(String(name ?? "")));
      if (!name || !fs.existsSync(from)) continue;
      const images = path.join(userDir(userId), "images");
      fs.mkdirSync(images, { recursive: true });
      fs.copyFileSync(from, path.join(images, path.basename(from)));
      moved.add(from);
    }
  }

  for (const [userId, { items, bookings, messages }] of files) {
    writeList(userId, "items.json", items);
    writeList(userId, "bookings.json", [...bookings.values()]);
    writeList(userId, "messages.json", messages);
  }

  // Only now that everything is on disk do the old copies go.
  db.exec("DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS bookings; DROP TABLE IF EXISTS item_days; DROP TABLE items;");
  for (const file of moved) fs.rmSync(file, { force: true });
  try {
    // Goes if nothing is left in it; a picture no item carried stays where it was.
    fs.rmdirSync(oldImages);
  } catch {}

  console.log(`rab: moved ${owners.size} items into data/users/ — the database as it was is ${backup}`);
}

// An account's items used to be one list, items.json, and its photographs one
// folder, images/. Each item is given a folder of its own, with item.json and
// the item's photographs in it (see files.js), once: an account that still has
// an items.json is one not moved yet. The folders are named after the items'
// ids as they were then, and given their proper names next (see
// renameItemFolders and renumberItems).
export function moveItemsIntoFolders() {
  const users = userFolders();
  const oldImages = (userId) => path.join(userDir(userId), "images");
  const copied = new Set();
  let count = 0;
  let any = false;
  for (const userId of users) {
    const file = path.join(userDir(userId), "items.json");
    if (!fs.existsSync(file)) continue;
    any = true;
    for (const item of readList(userId, "items.json")) {
      const dir = itemDir(userId, item.id);
      fs.mkdirSync(dir, { recursive: true });
      const names = (item.images ?? []).flatMap((image) => [image?.name, image?.thumb]);
      for (const name of new Set(names.filter(Boolean).map((name) => path.basename(String(name))))) {
        // In its owner's images, unless it was somebody else's upload.
        const from = [userId, ...users].map((id) => path.join(oldImages(id), name)).find((place) => fs.existsSync(place));
        if (!from) continue;
        fs.copyFileSync(from, path.join(dir, name));
        copied.add(from);
      }
      writeItem(userId, item);
      count += 1;
    }
    // Only now that every item of the list is on disk does the list go.
    fs.rmSync(file);
  }
  if (!any) return;

  // Copied first and removed after, since two items may carry the same
  // picture. A picture no item carried was sent and never used: it waits in
  // uploads/, where such pictures now wait.
  for (const file of copied) fs.rmSync(file, { force: true });
  for (const userId of users) {
    let left;
    try {
      left = fs.readdirSync(oldImages(userId));
    } catch {
      continue;
    }
    const uploads = path.join(userDir(userId), "uploads");
    if (left.length > 0) fs.mkdirSync(uploads, { recursive: true });
    for (const name of left) fs.renameSync(path.join(oldImages(userId), name), path.join(uploads, name));
    fs.rmdirSync(oldImages(userId));
  }

  console.log(`rab: moved ${count} items into folders of their own, under data/users/<username>/items/`);
}

// An item's folder used to be named after the item's id. One that still is —
// any whose name is not a number — is named after the millisecond its item was
// made, in Unix time, once. Two made in the same one cannot both have it: the
// later one found takes the next millisecond that is free, in anybody's
// folder, so that an item can change account and keep its folder's name.
export function renameItemFolders() {
  const users = userFolders();
  const taken = new Set(users.flatMap((userId) => itemFolders(userId)));
  let count = 0;
  for (const userId of users) {
    for (const name of itemFolders(userId)) {
      if (/^\d+$/.test(name)) continue;
      let item;
      try {
        item = JSON.parse(fs.readFileSync(path.join(itemDir(userId, name), ITEM_FILE), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const made = Date.parse(item?.createdAt);
      let stamp = Number.isFinite(made) ? made : Date.now();
      while (taken.has(String(stamp))) stamp += 1;
      taken.add(String(stamp));
      fs.renameSync(itemDir(userId, name), itemDir(userId, String(stamp)));
      count += 1;
    }
  }
  if (count > 0) console.log(`rab: named ${count} item folders after when their items were made`);
}

// An item's id used to be eight letters and digits drawn at random, with its
// folder named after when it was made. The folder's name is the id now: an
// item.json that still says another id is given its folder's, once, and keeps
// the old one as `was`, so an address handed out under it still opens. The
// bookings that point at the item are made to point at it by its new id.
export function renumberItems() {
  const users = userFolders();
  const renamed = new Map();
  for (const userId of users) {
    for (const folder of itemFolders(userId)) {
      let item;
      try {
        item = JSON.parse(fs.readFileSync(path.join(itemDir(userId, folder), ITEM_FILE), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!item || item.id == null || String(item.id) === folder) continue;
      renamed.set(String(item.id), folder);
      writeItem(userId, { ...item, id: folder, was: String(item.id) });
    }
  }
  if (renamed.size === 0) return;
  for (const userId of users) {
    const bookings = readList(userId, "bookings.json");
    if (!bookings.some((booking) => renamed.has(String(booking.itemId)))) continue;
    writeList(
      userId,
      "bookings.json",
      bookings.map((booking) => (renamed.has(String(booking.itemId)) ? { ...booking, itemId: renamed.get(String(booking.itemId)) } : booking)),
    );
  }
  console.log(`rab: gave ${renamed.size} items the time they were made as their id`);
}

/* ---------------------------------------------------------- accounts' ids */

// An account's id is the millisecond it was made, in Unix time, and its
// user.json says that and not when it was made as well. The accounts from
// when the database numbered them — 1, 2, 3 — are given the millisecond their
// user.json says they were made, once, and everything that points at an
// account by its id follows: each side of a booking, the other end of a line
// of a conversation, a session. And no user.json goes on saying when.
//
// This is done before it is known which folder is whose (see db.js), so the
// files are read where they lie. The user.json files are written last: a
// start that fails part-way finds the old ids still in them and does the rest
// again, what has already changed being left as it is.
const FIRST_STAMP = 1e12;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function writeJson(file, value) {
  const partial = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(partial, file);
}

export function renumberAccounts(db, userFile) {
  const accounts = accountFolders(userFile).filter(({ record }) => Number.isSafeInteger(Number(record.id)) && Number(record.id) > 0);
  if (!accounts.some(({ record }) => Number(record.id) < FIRST_STAMP || "createdAt" in record)) return;

  // The new id of each account that has an old one: when it was made — the
  // next millisecond that is free, should two have been made in the same one.
  const taken = new Set(accounts.map(({ record }) => Number(record.id)).filter((id) => id >= FIRST_STAMP));
  const newIds = new Map();
  for (const { record } of accounts) {
    const id = Number(record.id);
    if (id >= FIRST_STAMP || newIds.has(id)) continue;
    const made = Date.parse(record.createdAt);
    let stamp = Number.isFinite(made) && made >= FIRST_STAMP ? made : Date.now();
    while (taken.has(stamp)) stamp += 1;
    taken.add(stamp);
    newIds.set(id, stamp);
  }
  const renumbered = (id) => newIds.get(id) ?? id;

  if (newIds.size > 0) {
    for (const { username } of accounts) {
      const rewrite = (name, fields) => {
        const file = path.join(usersDir, username, name);
        const list = readJson(file);
        if (!Array.isArray(list)) return;
        let changed = false;
        for (const entry of list) {
          for (const field of fields) {
            if (!newIds.has(entry?.[field])) continue;
            entry[field] = newIds.get(entry[field]);
            changed = true;
          }
        }
        if (changed) writeJson(file, list);
      };
      rewrite("bookings.json", ["ownerId", "renterId"]);
      rewrite("messages.json", ["with"]);
    }
    const move = db.prepare("UPDATE sessions SET user_id = ? WHERE user_id = ?");
    for (const [from, to] of newIds) move.run(to, from);
  }

  for (const { username, record } of accounts) {
    const { id, createdAt, ...about } = record;
    writeJson(path.join(usersDir, username, userFile), { id: renumbered(Number(id)), ...about });
  }
  if (newIds.size > 0) console.log(`rab: gave ${newIds.size} accounts the millisecond they were made for an id`);
}
