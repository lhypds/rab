import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { dataDir, deletedFolders, deletedItemDir, heldDir, itemDir, itemFolders, spotDir, spotFolders, userDir, userFolders, requestDir, requestFolders } from "./files.js";

// Where photographs are kept: beside the item they are of, in the item's own
// folder, data/users/<username>/items/<item id>/ (see files.js) — one file per picture, named
// after its own bytes. A picture is sent before the item it is for is saved,
// and until then it waits in data/users/<username>/uploads/, in the folder of
// whoever sent it; saving the item takes it from there (see keepImages).
//
// Public by definition — they are pictures of things put out for rent — so a
// picture is asked for by its name alone and there is nothing to decide about
// who may see what.

const uploadsDir = (userId) => path.join(userDir(userId), "uploads");

// Which folders each picture is in, by its name, so serving one does not look
// through every item's each time: read off the disk once, and kept up as
// pictures are stored and moved. `waiting` is which of those folders are
// somebody's uploads rather than an item's.
let places = null;
const waiting = new Set();

function note(name, dir) {
  if (!places.has(name)) places.set(name, new Set());
  places.get(name).add(dir);
}

function survey() {
  places = new Map();
  waiting.clear();
  for (const userId of userFolders()) {
    const uploads = uploadsDir(userId);
    waiting.add(uploads);
    const kept = [
      ...itemFolders(userId).map((folder) => itemDir(userId, folder)),
      ...spotFolders(userId).map((folder) => spotDir(userId, folder)),
      // A deleted item's pictures still show where its bookings are listed.
      ...deletedFolders(userId).map(({ folder, spot }) => deletedItemDir(userId, folder, spot)),
      // A request's are beside it in its folder, as an item's are.
      ...requestFolders(userId).map((folder) => requestDir(userId, folder)),
    ];
    for (const dir of [uploads, ...kept]) {
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) if (isStoredName(name)) note(name, dir);
    }
  }
}

// The browser compresses before it uploads, so this is a ceiling on a mistake
// — a RAW file, a video — rather than a size a photo is expected to be.
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// What every picture is stored as: WebP, no longer than this on its long side.
// The browser sends exactly that already (see src/utils/image.js) and is kept
// byte for byte; anything else — the phone app's JPEG, an old Safari's, a file
// sent as it was — is brought to it here.
const STORED_MAX = 1600;
const STORED_QUALITY = 82;

// The other types are what was stored before everything became WebP, and are
// still served.
const IMAGE_TYPES = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  avif: "image/avif",
};

// 32 hex characters of the bytes' digest plus the sniffed extension. No
// separator and no second dot, so a name that passes this cannot address
// anything outside the folder it is joined to.
const STORED_NAME_RE = new RegExp(`^[0-9a-f]{32}\\.(${Object.keys(IMAGE_TYPES).join("|")})$`);

export function isStoredName(name) {
  return typeof name === "string" && STORED_NAME_RE.test(name);
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The format the bytes actually are. The request's Content-Type is never
// trusted for it: what is written here is served back with a type attached.
function sniffExtension(buffer) {
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC)) return "png";
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("latin1", 0, 6))) return "gif";
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 4, 8) === "ftyp" &&
    ["avif", "avis"].includes(buffer.toString("latin1", 8, 12))
  ) {
    return "avif";
  }
  return null;
}

// The picture as WebP within STORED_MAX, turned the way its EXIF says it is
// held — or null for bytes that are not a picture after all.
async function toWebp(buffer, extension) {
  try {
    if (extension === "webp") {
      const { width, height, pages } = await sharp(buffer).metadata();
      if (Math.max(width, height) <= STORED_MAX && !(pages > 1)) return buffer;
    }
    return await sharp(buffer)
      .autoOrient()
      .resize({ width: STORED_MAX, height: STORED_MAX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: STORED_QUALITY })
      .toBuffer();
  } catch {
    return null;
  }
}

// Any picture's bytes as the bytes to keep and the name to keep them under —
// null for what is not a picture. Naming the file after its digest stores the
// same photo once however often it is sent, and lets the URL be cached forever.
export async function asStored(sent) {
  const sentAs = sniffExtension(sent);
  if (!sentAs) return null;
  const buffer = await toWebp(sent, sentAs);
  if (!buffer) return null;
  return { name: `${crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32)}.webp`, buffer };
}

export async function spotImage(userId, sent) {
  const picture = await asStored(sent);
  if (!picture) return null;
  const { name, buffer } = picture;
  const dir = uploadsDir(userId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, name), buffer);
  if (!places) survey();
  waiting.add(dir);
  note(name, dir);
  return { name, url: `/api/images/${name}`, bytes: buffer.length, type: IMAGE_TYPES.webp };
}

// A folder the picture is in, or null.
function findImage(name) {
  if (!places) survey();
  const look = () => {
    for (const dir of places.get(name) ?? []) {
      if (fs.existsSync(path.join(dir, name))) return dir;
    }
    return null;
  };
  const found = look();
  if (found || !places.has(name)) return found;
  // Known, and not where it was: its item's folder has gone to another
  // account, or been taken away. The disk is read again, once — after which
  // the name is either found or no longer known.
  survey();
  return look();
}

// Where a stored picture is on disk, with the type to serve it as — null for a
// name this module did not write or a file that is no longer there.
export function imageFile(name) {
  if (!isStoredName(name)) return null;
  const dir = findImage(name);
  if (dir === null) return null;
  return { path: path.join(dir, name), type: IMAGE_TYPES[path.extname(name).slice(1)] };
}

// The pin's own copy of a picture: the size a pin on the map draws it (32px),
// half again over for a sharper screen. A map can hold thousands of pins at
// once, and each one asking for the list's thumbnail is tens of megabytes;
// this is about 600 bytes each. Made the first time it is asked for and kept
// in data/cache/pins-<size>, named after the picture it is of — whose bytes
// never change, so neither do its own. The size is in the folder's name so a
// change of size is not served from copies made at the old one. Resolves to
// the file's path, or null where there is no such picture.
const PIN_SIZE = 48;
const PIN_QUALITY = 60;
const pinsDir = path.join(dataDir, "cache", `pins-${PIN_SIZE}`);
const pinsMaking = new Map();

export async function pinImageFile(name) {
  const source = imageFile(name);
  if (!source) return null;
  const file = path.join(pinsDir, `${path.basename(name, path.extname(name))}.webp`);
  if (fs.existsSync(file)) return file;
  if (!pinsMaking.has(file)) {
    pinsMaking.set(
      file,
      (async () => {
        await fsp.mkdir(pinsDir, { recursive: true });
        const bytes = await sharp(source.path, { animated: false })
          .rotate()
          .resize(PIN_SIZE, PIN_SIZE, { fit: "cover" })
          .webp({ quality: PIN_QUALITY })
          .toBuffer();
        // Written whole under another name first, so a file half written is
        // never served.
        const partial = `${file}.${process.pid}.part`;
        await fsp.writeFile(partial, bytes);
        await fsp.rename(partial, file);
        return file;
      })().finally(() => pinsMaking.delete(file)),
    );
  }
  return pinsMaking.get(file);
}

// An item's folder that was put there from outside while the server was
// running (see adoptPublicItems in db.js): the pictures in it are served from
// here on.
export function noteItemImages(userId, itemId) {
  if (!places) return survey();
  const dir = heldDir(userId, itemId);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) if (isStoredName(name)) note(name, dir);
}

// Makes an item's folder hold the pictures the item carries, and no others.
// One still waiting in somebody's uploads is moved in; one that is another
// item's as well is copied — the bytes are the same, and the copy is what
// keeps each item's folder whole by itself. A picture the item has stopped
// carrying is removed from its folder.
export function keepImages(userId, itemId, names) {
  keepImagesIn(itemDir(userId, itemId), names);
}

// The same for one of an account's spots, whose photographs are kept beside
// its spot.json in its own folder (see files.js).
export function keepSpotImages(userId, spotId, names) {
  keepImagesIn(spotDir(userId, spotId), names);
}

// And for a request ("I need"), whose photographs are kept beside its
// request.json in its own folder.
export function keepRequestImages(userId, requestId, names) {
  keepImagesIn(requestDir(userId, requestId), names);
}

function keepImagesIn(dir, names) {
  const carried = new Set(names.filter(isStoredName));
  fs.mkdirSync(dir, { recursive: true });
  for (const name of carried) {
    const own = path.join(dir, name);
    if (!fs.existsSync(own)) {
      const from = findImage(name);
      if (from === null) continue;
      fs.copyFileSync(path.join(from, name), own);
      if (waiting.has(from)) {
        fs.rmSync(path.join(from, name), { force: true });
        places.get(name)?.delete(from);
      }
    }
    if (!places) survey();
    note(name, dir);
  }
  for (const name of fs.readdirSync(dir)) {
    if (!isStoredName(name) || carried.has(name)) continue;
    fs.rmSync(path.join(dir, name), { force: true });
    places?.get(name)?.delete(dir);
  }
}
