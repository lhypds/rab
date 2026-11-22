import fs from "node:fs";
import path from "node:path";
import { dataDir, userDir, writeList } from "./files.js";

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
