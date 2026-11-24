import { unzipSync } from "fflate";
import { ITEM_FILE, SOURCE_FILE } from "./files.js";
import { isStoredName } from "./images.js";

// A public folder, or a piece of it, sent as a zip: data/users/_public/ as
// another server has it, or as a crawler left it (see data/crawlers) —
// locations.json, and items/<made>/ with item.json, source.json and the
// photographs in each (rab public sends one item to a zip). The
// folder may be at the top of the zip or inside one folder or more ("public/",
// "_public/"); where it is, is wherever locations.json or the first item is.
// Anything else in it is passed over, the Finder's own leavings included.
//
// What it comes to, as mergePublic (db.js) takes it: { locations, items:
// [{ folder, item, source, files }] }, `files` being the photographs by name.
// Or { error } for a zip that cannot be read or has nothing of the kind in it.

const ITEM_ENTRY_RE = /^items\/(\d+)\/([^/]+)$/;
const ROOT_RE = /^(.*?)(?:locations\.json|items\/\d+\/item\.json)$/;

function skipped(name) {
  return name.endsWith("/") || name.split("/").some((part) => part === "__MACOSX" || part.startsWith("._"));
}

function json(bytes, name) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${name} is not JSON`);
  }
}

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function readPublicZip(buffer) {
  let entries;
  try {
    entries = unzipSync(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length), {
      filter: (file) => !skipped(file.name),
    });
  } catch {
    return { error: "That is not a zip file" };
  }
  const roots = Object.keys(entries)
    .map((name) => name.match(ROOT_RE)?.[1])
    .filter((root) => root !== undefined)
    .sort((a, b) => a.length - b.length);
  if (!roots.length) return { error: "There is no locations.json and no items/<id>/item.json in the zip" };
  const root = roots[0];

  try {
    let locations = [];
    const byFolder = new Map();
    for (const [name, bytes] of Object.entries(entries)) {
      if (!name.startsWith(root)) continue;
      const inside = name.slice(root.length);
      if (inside === "locations.json") {
        const list = json(bytes, name);
        if (!Array.isArray(list)) throw new Error(`${name} is not a list`);
        locations = list.filter(isRecord);
        continue;
      }
      const match = inside.match(ITEM_ENTRY_RE);
      if (!match) continue;
      const [, folder, file] = match;
      if (!byFolder.has(folder)) byFolder.set(folder, { folder, item: null, source: null, files: {} });
      const entry = byFolder.get(folder);
      if (file === ITEM_FILE) {
        const item = json(bytes, name);
        if (!isRecord(item)) throw new Error(`${name} is not an item`);
        entry.item = item;
      } else if (file === SOURCE_FILE) {
        const source = json(bytes, name);
        if (isRecord(source)) entry.source = source;
      } else if (isStoredName(file)) {
        entry.files[file] = bytes;
      }
    }
    // A folder with no item.json in it is not an item, as on the disk.
    const items = [...byFolder.values()].filter((entry) => entry.item);
    return { locations, items };
  } catch (error) {
    return { error: error.message };
  }
}
