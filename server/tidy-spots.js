// Tidies the crawled spots of the public account, data/users/_public/spots/:
//
//   - the kind of place the crawler put after the name, in full-width brackets
//     — "祇園 某店（美容室）", "和漣 別邸 〈一棟貸し町家〉" — is taken off the name
//     and made its "what" (unless it has one already);
//   - the address the description starts with — the spot's `place`, then
//     "。" — is taken off the description, the place being shown on its own.
//
// Half-width brackets are left alone: there they hold the name in Latin
// letters, "美容室カレン(Karen)". A spot already tidied is left as it is, so
// this can be run again as the crawler adds more.
//
//   node server/tidy-spots.js           say what would change
//   node server/tidy-spots.js --write   change it
//
// The server reads the folders when it starts, so restart it afterwards.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = process.env.RAB_DATA || path.resolve(__dirname, "..", "data");
const spotsDir = path.join(dataRoot, "users", "_public", "spots");
const write = process.argv.includes("--write");

// As long as the item form lets a "what" be (see WHAT_MAX in index.js).
const WHAT_MAX = 40;
// What the crawler sometimes caught in place of a kind: dropped, not kept.
const JUNK = new Set(["このお仕事の詳細を見る"]);
const KIND_AT_END = /\s*(?:（([^（）]*)）|〈([^〈〉]*)〉)\s*$/;

function tidy(spot) {
  const next = { ...spot };
  // Only the last bracket, and only once: one still left — "（KCTP）" — is part
  // of the name.
  const kind = !spot.what && spot.title?.match(KIND_AT_END);
  if (kind) {
    const what = (kind[1] ?? kind[2]).trim();
    next.title = spot.title.slice(0, kind.index).trim();
    if (what && !JUNK.has(what)) next.what = what.slice(0, WHAT_MAX);
  }
  const place = spot.place?.trim();
  if (place && spot.description?.startsWith(place)) {
    const rest = spot.description.slice(place.length);
    if (/^[。.．、,，\s]/.test(rest) || rest === "") next.description = rest.replace(/^[。.．、,，\s]+/, "");
  }
  return next;
}

// The fields in the order they were, with "what" just after the title.
function ordered(spot) {
  const out = {};
  for (const [key, value] of Object.entries(spot)) {
    if (key === "what") continue;
    out[key] = value;
    if (key === "title" && spot.what !== undefined) out.what = spot.what;
  }
  return out;
}

let seen = 0;
let named = 0;
let described = 0;
const shown = [];
for (const folder of fs.readdirSync(spotsDir)) {
  const file = path.join(spotsDir, folder, "spot.json");
  if (!fs.existsSync(file)) continue;
  seen += 1;
  const spot = JSON.parse(fs.readFileSync(file, "utf8"));
  const next = tidy(spot);
  const titleChanged = next.title !== spot.title || next.what !== spot.what;
  const descriptionChanged = next.description !== spot.description;
  if (!titleChanged && !descriptionChanged) continue;
  if (titleChanged) named += 1;
  if (descriptionChanged) described += 1;
  if (shown.length < 8) shown.push(`${spot.title}\n  → ${next.title}  [${next.what ?? ""}]\n  → ${(next.description ?? "").slice(0, 60)}`);
  if (write) {
    const partial = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(partial, `${JSON.stringify(ordered(next), null, 2)}\n`);
    fs.renameSync(partial, file);
  }
}

console.log(shown.join("\n"));
console.log(`\n${seen} spots: ${named} names and ${described} descriptions ${write ? "changed" : "to change (run with --write)"}`);
