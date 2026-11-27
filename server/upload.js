import { unzipSync } from "fflate";
import { ITEM_FILE, SOURCE_FILE, SPOT_FILE, TEXT_LANGUAGES } from "./files.js";
import { isStoredName } from "./images.js";

// A public folder, or a piece of it, sent as a zip: data/users/_public/ as
// another server has it, or as a crawler left it (see data/crawlers) —
// locations.json, and items/<made>/ with item.json, source.json and the
// photographs in each — or spots/<made>/ with spot.json in place of
// item.json, for a spot (stores/<made>/ with store.json or pages/<made>/ with page.json, from a sender from
// before spots were called so, is taken as one) (rab push sends one item to
// a zip). The
// folder may be at the top of the zip or inside one folder or more ("public/",
// "_public/"); where it is, is wherever locations.json or the first item is.
// Anything else in it is passed over, the Finder's own leavings included.
//
// An item's other languages come with it: item.en.json, item.zh.json and
// item.ja.json beside item.json (spot.en.json and so on beside a spot's) —
// each its name, what it is and its description in that language (see
// files.js). They are read into the item as its `translations`, which is how
// it is kept in memory, and written back out as the same files.
//
// What it comes to, as mergePublic (db.js) takes it: { locations, items:
// [{ folder, item, source, files }] }, `files` being the photographs by name.
// Or { error } for a zip that cannot be read or has nothing of the kind in it.

const ITEM_ENTRY_RE = /^(items|spots|stores|pages)\/(\d+)\/([^/]+)$/;
const ROOT_RE = /^(.*?)(?:locations\.json|items\/\d+\/item\.json|spots\/\d+\/spot\.json|stores\/\d+\/store\.json|pages\/\d+\/page\.json)$/;

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

// The language a file beside an item's own is in — "ja" for item.ja.json —
// or null for a file that is not one of them.
function languageOf(file, own) {
  const match = file.match(/^(.+)\.([a-z]{2})\.json$/);
  return match && `${match[1]}.json` === own && TEXT_LANGUAGES.includes(match[2]) ? match[2] : null;
}

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
  if (!roots.length) return { error: "There is no locations.json, no items/<id>/item.json and no spots/<id>/spot.json in the zip" };
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
      const [, under, folder, file] = match;
      if (!byFolder.has(folder)) byFolder.set(folder, { folder, item: null, source: null, files: {} });
      const entry = byFolder.get(folder);
      const isSpot = under !== "items";
      const own = under === "items" ? ITEM_FILE : under === "spots" ? SPOT_FILE : under === "stores" ? "store.json" : "page.json";
      const language = languageOf(file, own);
      if (language) {
        // One of its other languages: only the three things that are translated.
        const words = json(bytes, name);
        if (isRecord(words)) {
          entry.translations ??= {};
          entry.translations[language] = {
            title: String(words.title ?? ""),
            what: String(words.what ?? ""),
            description: String(words.description ?? ""),
          };
        }
      } else if (file === own) {
        const item = json(bytes, name);
        if (!isRecord(item)) throw new Error(`${name} is not an item`);
        const { page, store, ...rest } = item;
        entry.item = isSpot ? { ...rest, spot: true } : item;
      } else if (file === SOURCE_FILE) {
        const source = json(bytes, name);
        if (isRecord(source)) entry.source = source;
      } else if (isStoredName(file)) {
        entry.files[file] = bytes;
      }
    }
    // A folder with no item.json in it is not an item, as on the disk. What
    // it says in other languages is the files beside it, whatever item.json
    // itself may say of them.
    const items = [...byFolder.values()]
      .filter((entry) => entry.item)
      .map(({ translations, ...entry }) => {
        const { translations: stale, ...item } = entry.item;
        return { ...entry, item: translations ? { ...item, translations } : item };
      });
    return { locations, items };
  } catch (error) {
    return { error: error.message };
  }
}
