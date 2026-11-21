import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Where an item's photographs are kept: data/images/, one file per picture,
// named after its own bytes. Public by definition — they are pictures of things
// put out for rent — so there is one folder and nothing to decide about who may
// see what.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = process.env.RAB_IMAGES || path.resolve(__dirname, "..", "data", "images");

// The browser compresses before it uploads, so this is a ceiling on a mistake
// — a RAW file, a video — rather than a size a photo is expected to be.
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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

// Naming the file after its digest stores the same photo once however often it
// is uploaded, and lets the URL be cached forever.
export async function storeImage(buffer) {
  const extension = sniffExtension(buffer);
  if (!extension) return null;
  const name = `${crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32)}.${extension}`;
  await fsp.mkdir(imagesDir, { recursive: true });
  await fsp.writeFile(path.join(imagesDir, name), buffer);
  return { name, url: `/api/images/${name}`, bytes: buffer.length, type: IMAGE_TYPES[extension] };
}

// Where a stored picture is on disk, with the type to serve it as — null for a
// name this module did not write or a file that is no longer there.
export function imageFile(name) {
  if (!isStoredName(name)) return null;
  const file = path.join(imagesDir, name);
  if (!fs.existsSync(file)) return null;
  return { path: file, type: IMAGE_TYPES[path.extname(name).slice(1)] };
}
