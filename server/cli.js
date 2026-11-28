import net from "node:net";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

// rab's commands for whoever looks after the server — run as ./rab from the
// project's root:
//
//   rab user list                      every account
//   rab user <username> items          what an account has out for rent
//   rab user <username> pass <new>     give an account a new password
//                                      (`rab user _admin pass <new>` is how the
//                                      admin account is first given one)
//   rab user delete <username>         delete an account and everything it has
//   rab public push [-f <folder>] [-u <url>]
//                                      send what of a public folder the server
//                                      at <url> does not have yet, an item at a
//                                      time, to be merged into _public's
//                                      (/api/public) — and what it has too but
//                                      changed longer ago (updatedAt) than here,
//                                      to replace it; without -f, this source's
//                                      own data/users/_public
//   rab public pull [-f <folder>] [-u <url>]
//                                      fetch what the server's _public has
//                                      changed more lately than here (same
//                                      id), to replace it — mirror's 2nd step
//   rab public mirror [-f <folder>] [-u <url>] [--yes]
//                                      push; pull what the server has newer
//                                      than here; and delete on the server, in
//                                      one request, what the folder does not have
//   rab public purge [-u <url>] [--yes]
//                                      delete every item and spot of the
//                                      server's _public (its places stay)
//
// The user commands read and write the same data/users/ and db.sqlite the
// server does (and the same .env says where those are). Listing is safe at any
// time, and so is a password. Deleting is not done under a running server,
// which holds the folders in memory and would write part of what was deleted
// back: stop it first.
//
// rab public push, pull, mirror and purge go through a running server instead — this
// machine's, on its port, unless -u <url> (or RAB_HOST, in .env, say) names
// another — signed in as _admin: with RAB_TOKEN, a session token of _admin's,
// if there is one, and otherwise with _admin's password, RAB_PASSWORD (in
// .env, say), or asked for here. It asks the server
// what it holds, and sends only the places and items it does not: the places
// in one zip, then the items' folders, several to a zip and a few zips at once.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // no .env file — use the ambient environment as-is
}

const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;

const USAGE = `Usage:
  rab user list                      list every account
  rab user <username> items          list what an account has out for rent
  rab user <username> pass <new>     set an account's password (${PASSWORD_MIN}–${PASSWORD_MAX} characters)
  rab user delete <username> [--yes] delete an account and everything it has
  rab public push [-f <folder>] [-u <url>]
                                     send the items of a public folder the server does not have,
                                     and those it has with an older updatedAt than here (replaced)
                                     (data/users/_public here, without -f), to the server at <url>
                                     (this machine's, without -u, or RAB_HOST)
  rab public pull [-f <folder>] [-u <url>]
                                     fetch the items the server has with a newer updatedAt than here,
                                     to replace them (what the folder does not have is not fetched)
  rab public mirror [-f <folder>] [-u <url>] [--yes]
                                     push, pull what the server has newer than here, then delete on
                                     the server what the folder does not have
                                     (asks first, unless --yes)
  rab public purge [-u <url>] [--yes]
                                     delete every item and spot in the server's _public
                                     (asks first, unless --yes)`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Columns as wide as their widest cell, the way `ls -l` lines things up.
function table(rows) {
  if (rows.length === 0) return;
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
  for (const row of rows) {
    console.log(row.map((cell, column) => String(cell).padEnd(widths[column])).join("  ").trimEnd());
  }
}

// Whether a server is answering on rab's port on this machine.
function serverRunning() {
  const port = Number(process.env.PORT) || 3016;
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(port);
    });
    for (const event of ["error", "timeout"]) {
      socket.once(event, () => {
        socket.destroy();
        resolve(null);
      });
    }
  });
}

// A password asked for without showing it as it is typed.
function askHidden(question) {
  return new Promise((resolve) => {
    const input = process.stdin;
    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    let typed = "";
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          resolve(typed);
          return;
        }
        if (char === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") typed = typed.slice(0, -1);
        else typed += char;
      }
    };
    input.on("data", onData);
  });
}

// A server's answer, as JSON where it is; an error, with what it said, where
// it failed.
async function answerOf(response) {
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON — an nginx page, say
  }
  if (!response.ok) throw new Error(`${response.status} ${body?.error ?? (text.trim().slice(0, 200) || response.statusText)}`);
  return body;
}

// The public folder in what was named: the folder itself where locations.json
// items/ or spots/ is in it, or the one folder inside it that has them
// ("_public/").
const isPublicFolder = (fs, at) => ["locations.json", "items", "spots"].some((name) => fs.existsSync(path.join(at, name)));

function publicFolder(fs, dir) {
  const isOne = (at) => isPublicFolder(fs, at);
  let entries;
  try {
    if (!fs.statSync(dir).isDirectory()) fail(`${dir} is not a folder`);
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    fail(`Cannot read ${dir}: ${error.code === "ENOENT" ? "no such folder" : error.message}`);
  }
  if (isOne(dir)) return dir;
  const inside = entries.filter((entry) => entry.isDirectory() && isOne(path.join(dir, entry.name)));
  if (inside.length === 1) return path.join(dir, inside[0].name);
  fail(`There is no locations.json, no items/ and no spots/ in ${dir}`);
}

function readJson(fs, file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// What push, pull and mirror are given: -f <folder>, -u <url>, and --yes
// (mirror's, to delete without asking). The server is RAB_HOST where -u is not
// given, and this machine's own where neither is; the folder is this source's
// own _public where -f is not.
function remoteArgs(args) {
  let file = null;
  let host = process.env.RAB_HOST || null;
  let yes = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-f" || arg === "--file") file = args[++i];
    else if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg === "-u" || arg === "--url" || arg === "--host") host = args[++i];
    else if (/^--(url|host)=/.test(arg)) host = arg.slice(arg.indexOf("=") + 1);
    else if (arg === "-y" || arg === "--yes") yes = true;
    else if (!arg.startsWith("-") && !file) file = arg;
    else fail(USAGE);
  }
  // Where the server keeps it: RAB_DATA, as in files.js, or data/.
  if (!file) file = path.join(process.env.RAB_DATA || path.join(root, "data"), "users", "_public");
  if (!host) host = `http://127.0.0.1:${Number(process.env.PORT) || 3016}`;
  if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
  return { file, host: host.replace(/\/+$/, ""), yes };
}

// What is here: the places, and each item folder with an item.json in it —
// and each spot folder (spots/) with a spot.json in it — with the key the
// crawler knows it by, when it was last changed, and the folder it is in
// (`under`: "items" or "spots").
function localPublic(fs, folder) {
  const list = readJson(fs, path.join(folder, "locations.json"));
  const locations = Array.isArray(list) ? list.filter((each) => each && typeof each === "object" && !Array.isArray(each)) : [];
  const items = [];
  for (const [under, file] of [["items", "item.json"], ["spots", "spot.json"]]) {
    const dir = path.join(folder, under);
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || !fs.existsSync(path.join(dir, entry.name, file))) continue;
      items.push({
        id: entry.name,
        under,
        key: readJson(fs, path.join(dir, entry.name, "source.json"))?.key ?? null,
        updatedAt: readJson(fs, path.join(dir, entry.name, file))?.updatedAt ?? null,
      });
    }
  }
  items.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return { locations, items };
}

// Which of `items` and `places` the other side does not have — by id, by the
// crawler's key, by address — `other` being { items, locations } as GET
// /api/public gives them, or as localPublic does.
// Of `held`, the places that repeat an address another of them has and are
// not the one kept for it: the one whose id `here` has, or else the first.
function extraPlaces(held, here) {
  const ours = new Set(here.map((each) => each.id));
  const kept = new Map();
  for (const each of held) {
    if (!each.address) continue;
    const first = kept.get(each.address);
    if (!first || (!ours.has(first.id) && ours.has(each.id))) kept.set(each.address, each);
  }
  return held.filter((each) => each.address && kept.get(each.address) !== each);
}

function missingFrom(other, { items, locations }) {
  const ids = new Set(other.items.map((each) => each.id));
  const keys = new Set(other.items.filter((each) => each.key).map((each) => JSON.stringify(each.key)));
  const placeIds = new Set(other.locations.map((each) => each.id));
  const addresses = new Set(other.locations.filter((each) => each.address).map((each) => each.address));
  return {
    items: items.filter((each) => !ids.has(each.id) && !(each.key && keys.has(JSON.stringify(each.key)))),
    locations: locations.filter((each) => !placeIds.has(each.id) && !(each.address && addresses.has(each.address))),
  };
}

// Which of `items` the other side has too — by id, or by the crawler's key —
// but changed longer ago than here, or with no time there where here has one:
// the ones to send again, to replace what is there. One whose time is not
// known here is left as it is.
const timeOf = (value) => {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : null;
};

function olderIn(other, items) {
  const byId = new Map(other.items.map((each) => [each.id, each]));
  const byKey = new Map(other.items.filter((each) => each.key).map((each) => [JSON.stringify(each.key), each]));
  return items.filter((each) => {
    const there = byId.get(each.id) ?? (each.key ? byKey.get(JSON.stringify(each.key)) : undefined);
    if (!there) return false;
    const mine = timeOf(each.updatedAt);
    const theirs = timeOf(there.updatedAt);
    return mine !== null && (theirs === null || theirs < mine);
  });
}

// Which of what the server holds this folder has too, under the same id, but
// changed longer ago than there: the ones pull fetches again, to replace its
// own. Again, one whose time either side does not know is left as it is.
function newerThere(here, held) {
  const mine = new Map(here.items.map((each) => [each.id, each]));
  return held.items.filter((each) => {
    const local = mine.get(each.id);
    if (!local) return false;
    const ours = timeOf(local.updatedAt);
    const theirs = timeOf(each.updatedAt);
    return ours !== null && theirs !== null && ours < theirs;
  });
}

// Signed in to the server as _admin for one command, and out again after,
// unless the token was given — that one is whoever gave it's to keep. The
// password is RAB_PASSWORD (in .env, say), or asked for here.
async function adminSession(host) {
  const request = async (url, options) => {
    try {
      return await fetch(`${host}${url}`, options);
    } catch (error) {
      throw new Error(`Cannot reach ${host}: ${error.cause?.code ?? error.message}`);
    }
  };
  let token = process.env.RAB_TOKEN || null;
  const signedIn = !token;
  if (!token) {
    let password = process.env.RAB_PASSWORD;
    if (!password) {
      if (!process.stdin.isTTY) fail("Give _admin's password in RAB_PASSWORD, or a session token in RAB_TOKEN.");
      password = await askHidden(`_admin's password on ${host}: `);
    }
    try {
      const login = await answerOf(
        await request("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "_admin", password }),
        }),
      );
      token = login.token;
    } catch (error) {
      fail(error.message);
    }
  }
  const auth = { Authorization: `Bearer ${token}` };
  const held = async () => {
    const asked = await request("/api/public", { headers: auth });
    // A server from before GET /api/public answers it with the 404 of any
    // path it does not know.
    if (asked.status === 404) throw new Error(`${host} does not say what it holds (GET /api/public): its server is older than this rab; update it first`);
    return answerOf(asked);
  };
  const close = async () => {
    if (signedIn) await fetch(`${host}/api/logout`, { method: "POST", headers: auth }).catch(() => {});
  };
  return { request, auth, held, close };
}

// How the items are sent: packed several to a zip — as many as come to
// BATCH_BYTES, however many that is: items without photographs (a kilobyte
// each) go by the thousand — and that many zips on their way at once.
const BATCH_BYTES = 20 * 1024 * 1024;
const BATCH_PARALLEL = 4;

// The places, then the items' folders, packed into zips: what push and mirror
// send. The number that failed.
async function sendMissing(fs, session, folder, send) {
  const { zipSync } = await import("fflate");
  const post = async (zip) =>
    answerOf(await session.request("/api/public", { method: "POST", headers: { ...session.auth, "Content-Type": "application/zip" }, body: zip }));
  let failed = 0;
  if (send.locations.length) {
    try {
      const merged = await post(zipSync({ "locations.json": new TextEncoder().encode(JSON.stringify(send.locations)) }));
      const places = merged.locations;
      console.log(`Places: ${places.added} added, ${places.replaced} replaced, ${places.dropped} left out (the list is full)`);
    } catch (error) {
      failed += 1;
      console.log(`Places failed: ${error.message}`);
    }
  }

  // Each item's folder as it is, item.json (spot.json for a spot),
  // source.json and the photographs; the photographs stored as they are,
  // being compressed.
  const filesOf = ({ id, under }) => {
    const dir = path.join(folder, under, id);
    const files = {};
    let bytes = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const data = fs.readFileSync(path.join(dir, entry.name));
      bytes += data.length;
      files[`${under}/${id}/${entry.name}`] = entry.name.endsWith(".json") ? data : [data, { level: 0 }];
    }
    return { files, bytes };
  };

  // The items in batches, by size; one bigger than a batch on
  // its own goes alone.
  const batches = [];
  let batch = [];
  let size = 0;
  for (const item of send.items) {
    let bytes = 0;
    try {
      const dir = path.join(folder, item.under, item.id);
      for (const name of fs.readdirSync(dir)) bytes += fs.statSync(path.join(dir, name)).size;
    } catch {
      // read again when it is packed, and failed there
    }
    if (batch.length && size + bytes > BATCH_BYTES) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(item);
    size += bytes;
  }
  if (batch.length) batches.push(batch);

  const counts = { added: 0, replaced: 0, skipped: 0 };
  let done = 0;
  // A server from before zips of more than one item takes them one at a time;
  // one that takes only so many to a zip says how many (`most`).
  let single = false;
  let most = Infinity;
  const sendBatch = async (items) => {
    const files = {};
    for (const item of items) Object.assign(files, filesOf(item).files);
    const zip = zipSync(files);
    const merged = await post(zip);
    counts.added += merged.items.added.length;
    counts.replaced += merged.items.replaced.length;
    counts.skipped += merged.items.skipped.length;
    for (const id of merged.items.skipped) console.log(`${id} passed over (another account's item has that id)`);
    return zip.length;
  };
  const run = async (items) => {
    try {
      if (single && items.length > 1) throw new Error("one at a time");
      if (items.length > most) throw new Error(`send at most ${most} at a time`);
      const bytes = await sendBatch(items);
      done += items.length;
      console.log(`[${done}/${send.items.length}] ${items.length} sent (${megabytes(bytes)})`);
    } catch (error) {
      if (items.length > 1 && (single || /one at a time/.test(error.message))) {
        single = true;
        for (const item of items) await run([item]);
        return;
      }
      const fewer = /at most (\d+) at a time/.exec(error.message);
      if (fewer && Number(fewer[1]) >= 1 && Number(fewer[1]) < items.length) {
        most = Number(fewer[1]);
        for (let at = 0; at < items.length; at += most) await run(items.slice(at, at + most));
        return;
      }
      // A proxy that gave up waiting for the server's answer (502, 504): the
      // batch took it too long, so it goes again in two halves — what of it
      // the server did take in is replaced by the same.
      const status = /^(50[24]) /.exec(error.message)?.[1];
      if (status && items.length > 1) {
        console.log(`${items.length} at once took the server too long (${status}); sending them again in halves`);
        const half = Math.ceil(items.length / 2);
        await run(items.slice(0, half));
        await run(items.slice(half));
        return;
      }
      failed += items.length;
      done += items.length;
      // The ids of a few, not of thousands; a proxy's page as its one line.
      const ids = items.slice(0, 5).map((each) => each.id).join(", ") + (items.length > 5 ? `, … (${items.length})` : "");
      const why = status ? `${status} the server took too long to answer` : error.message;
      console.log(`[${done}/${send.items.length}] ${ids} failed: ${why}`);
    }
  };
  // A few batches on their way at once, each worker taking the next.
  let next = 0;
  const worker = async () => {
    while (next < batches.length) await run(batches[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_PARALLEL, batches.length) }, worker));

  if (send.items.length) console.log(`Items sent: ${counts.added} added, ${counts.replaced} replaced, ${counts.skipped} passed over, ${failed} failed`);
  return failed;
}

// "31840 items, 3415 spots, 3049 places": a spot is an item folder under
// spots/ (`under` here, `spot` as the server gives it), a place a saved
// location in locations.json.
function counted({ items = [], locations }) {
  const spots = items.filter((each) => each.under === "spots" || each.spot).length;
  const parts = [`${items.length - spots} items`, `${spots} spots`];
  if (locations) parts.push(`${locations.length} places`);
  return parts.join(", ");
}

// What mirror deletes on the server, in one request (POST /api/public/delete)
// that takes as long as it takes; a server from before it, one DELETE at a
// time. The number that failed.
async function deleteHeld(session, host, drop) {
  const deleting = drop.items.length + drop.locations.length;
  console.log(`Deleting ${counted(drop)} on ${host}…`);
  const started = Date.now();
  const response = await session.request("/api/public/delete", {
    method: "POST",
    headers: { ...session.auth, "Content-Type": "text/plain" },
    body: JSON.stringify({ items: drop.items.map((each) => each.id), locations: drop.locations.map((each) => each.id) }),
  });
  if (response.status !== 404) {
    const done = await answerOf(response);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`Deleted on ${host}: ${done.items.deleted} items and spots, ${done.locations.deleted} places, in ${seconds}s`);
    const missing = done.items.missing.length + done.locations.missing.length;
    if (missing) console.log(`${missing} were not there any more: ${[...done.items.missing, ...done.locations.missing].join(", ")}`);
    return 0;
  }
  let deleted = 0;
  let failed = 0;
  const remove = async (what, id) => {
    try {
      await answerOf(await session.request(`/api/public/${what}/${encodeURIComponent(id)}`, { method: "DELETE", headers: session.auth }));
      deleted += 1;
    } catch (error) {
      failed += 1;
      console.log(`Deleting ${what === "items" ? "item" : "place"} ${id} failed: ${error.message}`);
    }
  };
  for (const { id } of drop.items) await remove("items", id);
  for (const { id } of drop.locations) await remove("locations", id);
  console.log(`Deleted on ${host}: ${deleted} of ${deleting}`);
  return failed;
}

// rab push / rab mirror [-f <folder>] [-u <url>]: what the server does not
// have, and what it has older than here, sent. Mirror then fetches what the
// server has newer than here (a pull, of those it has under the same id only)
// and deletes there what is not here — by the items/ and spots/ folders' ids,
// keeping one the server holds under a key of an item here (it is that item,
// merged under the server's id) — so that its _public is this folder's.
async function sendPublic(args, { mirror = false } = {}) {
  const { file, host, yes } = remoteArgs(args);
  const fs = await import("node:fs");
  const folder = publicFolder(fs, path.resolve(file));
  const here = localPublic(fs, folder);
  console.log(`${folder}: ${counted(here)}`);

  const session = await adminSession(host);
  let failed = 0;
  try {
    const held = await session.held();
    console.log(`${host} has ${counted(held)}`);
    const send = missingFrom(held, here);
    // And what it has too, but older than here: sent again, to replace it.
    const newer = olderIn(held, here.items);
    console.log(`To send: ${counted({ items: send.items })} new, ${counted({ items: newer })} newer than the server's, ${send.locations.length} places`);
    send.items = [...send.items, ...newer].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    // The same as rab public pull.
    const take = mirror ? newerThere(here, held) : [];
    if (mirror) console.log(`To fetch: ${counted({ items: take })} newer on ${host} than here`);
    const drop = mirror ? missingFrom(here, held) : { items: [], locations: [] };
    // The server keeps one place per address (see mergePublic), but may still
    // hold more from before: all but one go too — the one with an id here, or
    // else the first.
    if (mirror) drop.locations = [...drop.locations, ...extraPlaces(held.locations, here.locations)];
    if (mirror) console.log(`To delete on ${host}: ${counted(drop)}`);

    const deleting = drop.items.length + drop.locations.length;
    if (deleting && !yes) {
      if (!process.stdin.isTTY) throw new Error("Deleting on the server is not done without --yes when nobody is there to ask.");
      const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await prompt.question(`This deletes ${counted(drop)} on ${host} for good. Type yes to go on: `);
      prompt.close();
      if (answer.trim() !== "yes") throw new Error("Nothing was sent or deleted.");
    }

    failed += await sendMissing(fs, session, folder, send);
    if (take.length) failed += await fetchItems(fs, session, folder, here, take);
    if (deleting) failed += await deleteHeld(session, host, drop);
  } catch (error) {
    console.error(error.message);
    failed += 1;
  } finally {
    await session.close();
  }
  if (failed) process.exit(1);
}

// How pull fetches: FETCH_ITEMS to a request (POST /api/public/items, one zip
// back), and that many requests on their way at once.
const FETCH_ITEMS = 50;
const FETCH_PARALLEL = 4;

// One item's files, out of an unzipped batch, written beside the others and
// moved into place whole, the way a crawler does, for a server running on this
// folder to take in — in the stead of the one here, where there is one, which
// is set aside until the new one is in. Whether it replaced one.
function placeItem(fs, folder, local, id, entries) {
  // A spot comes as spots/<id>/spot.json and goes in spots/; an item in
  // items/.
  const under = `spots/${id}/spot.json` in entries ? "spots" : "items";
  const file = under === "spots" ? "spot.json" : "item.json";
  const dir = path.join(folder, under);
  fs.mkdirSync(dir, { recursive: true });
  const into = path.join(dir, `.${id}.${process.pid}.tmp`);
  fs.rmSync(into, { recursive: true, force: true });
  fs.mkdirSync(into, { recursive: true });
  for (const [name, bytes] of Object.entries(entries)) {
    const match = name.match(/^(items|spots)\/(\d+)\/([^/]+)$/);
    if (!match || match[1] !== under || match[2] !== id || match[3].startsWith(".")) continue;
    fs.writeFileSync(path.join(into, match[3]), bytes);
  }
  if (!fs.existsSync(path.join(into, file))) {
    fs.rmSync(into, { recursive: true, force: true });
    throw new Error(`the server sent no ${file} for it`);
  }
  // The one here — under items/ or spots/, whichever it was — set aside, and
  // put back if the new one cannot be moved in.
  const target = path.join(dir, id);
  const was = local.has(id) ? path.join(folder, local.get(id).under, id) : target;
  let aside = null;
  if (fs.existsSync(was)) {
    aside = path.join(path.dirname(was), `.${id}.${process.pid}.old`);
    fs.rmSync(aside, { recursive: true, force: true });
    fs.renameSync(was, aside);
  }
  try {
    fs.renameSync(into, target);
  } catch (error) {
    if (aside) fs.renameSync(aside, was);
    throw error;
  }
  if (aside) fs.rmSync(aside, { recursive: true, force: true });
  return Boolean(aside);
}

// Each of `take` (ids the server holds) fetched into the folder (placeItem),
// FETCH_ITEMS to a zip and FETCH_PARALLEL zips at once; from a server from
// before POST /api/public/items, one GET at a time. The number that failed.
async function fetchItems(fs, session, folder, here, take) {
  const { unzipSync } = await import("fflate");
  const local = new Map(here.items.map((each) => [each.id, each]));
  const counts = { fetched: 0, replaced: 0, failed: 0 };
  let done = 0;
  let single = false;

  const place = (id, entries) => {
    try {
      if (placeItem(fs, folder, local, id, entries)) counts.replaced += 1;
      else counts.fetched += 1;
    } catch (error) {
      counts.failed += 1;
      console.log(`${id} failed: ${error.message}`);
    }
  };
  const fetchOne = async (id) => {
    const response = await session.request(`/api/public/items/${encodeURIComponent(id)}`, { headers: session.auth });
    if (!response.ok) await answerOf(response);
    return new Uint8Array(await response.arrayBuffer());
  };
  const run = async (ids) => {
    try {
      let zip;
      if (!single) {
        const response = await session.request("/api/public/items", {
          method: "POST",
          headers: { ...session.auth, "Content-Type": "text/plain" },
          body: JSON.stringify(ids),
        });
        if (response.status === 404) single = true;
        else if (!response.ok) await answerOf(response);
        else zip = new Uint8Array(await response.arrayBuffer());
      }
      if (single) {
        for (const id of ids) {
          try {
            const one = await fetchOne(id);
            place(id, unzipSync(one));
          } catch (error) {
            counts.failed += 1;
            console.log(`${id} failed: ${error.message}`);
          }
        }
        done += ids.length;
        console.log(`[${done}/${take.length}] ${ids.length} fetched one at a time`);
        return;
      }
      const entries = unzipSync(zip);
      // The batch's files sorted by the id they are under.
      const byId = new Map(ids.map((id) => [id, {}]));
      for (const [name, bytes] of Object.entries(entries)) {
        const id = name.split("/")[1];
        if (byId.has(id)) byId.get(id)[name] = bytes;
      }
      for (const [id, files] of byId) place(id, files);
      done += ids.length;
      console.log(`[${done}/${take.length}] ${ids.length} fetched (${megabytes(zip.length)})`);
    } catch (error) {
      counts.failed += ids.length;
      done += ids.length;
      console.log(`[${done}/${take.length}] ${ids.join(", ")} failed: ${error.message}`);
    }
  };

  const batches = [];
  for (let i = 0; i < take.length; i += FETCH_ITEMS) batches.push(take.slice(i, i + FETCH_ITEMS).map((each) => each.id));
  let next = 0;
  const worker = async () => {
    while (next < batches.length) await run(batches[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_PARALLEL, batches.length) }, worker));

  console.log(`Items fetched: ${counts.fetched} new, ${counts.replaced} replaced, ${counts.failed} failed`);
  return counts.failed;
}

// rab pull [-f <folder>] [-u <url>]: push the other way round, and the same as
// mirror's second step — what the server's _public has under the same id as
// here but changed more lately, fetched to replace what is here (fetchItems).
// What is newer here is left; what the server has and this folder does not,
// items, spots and places, is left there too.
async function receivePublic(args) {
  const { file, host } = remoteArgs(args);
  const fs = await import("node:fs");
  const folder = publicFolder(fs, path.resolve(file));
  const here = localPublic(fs, folder);
  console.log(`${folder}: ${counted(here)}`);

  const session = await adminSession(host);
  let failed = 0;
  try {
    const held = await session.held();
    console.log(`${host} has ${counted(held)}`);
    const take = newerThere(here, held);
    console.log(`To fetch: ${counted({ items: take })} newer on ${host} than here`);
    if (take.length) failed += await fetchItems(fs, session, folder, here, take);
  } catch (error) {
    console.error(error.message);
    failed += 1;
  } finally {
    await session.close();
  }
  if (failed) process.exit(1);
}

// rab public purge [-u <url>] [--yes]: every item and spot of the server's
// _public deleted, after asking; its places are left as they are.
async function purgePublic(args) {
  const { host, yes } = remoteArgs(args);
  const session = await adminSession(host);
  let failed = 0;
  try {
    const held = await session.held();
    const count = held.items.length;
    const spots = held.items.filter((each) => each.spot).length;
    const what = `${count - spots} items and ${spots} spots`;
    console.log(`${host} has ${what} in _public`);
    if (count === 0) return;
    if (!yes) {
      if (!process.stdin.isTTY) throw new Error("Purging is not done without --yes when nobody is there to ask.");
      const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await prompt.question(`This deletes all ${what} of _public on ${host} for good (its places stay). Type purge to go on: `);
      prompt.close();
      if (answer.trim() !== "purge") throw new Error("Nothing was deleted.");
    }
    let deleted = 0;
    for (const [index, { id }] of held.items.entries()) {
      try {
        await answerOf(await session.request(`/api/public/items/${encodeURIComponent(id)}`, { method: "DELETE", headers: session.auth }));
        deleted += 1;
        console.log(`[${index + 1}/${count}] ${id} deleted`);
      } catch (error) {
        failed += 1;
        console.log(`[${index + 1}/${count}] ${id} failed: ${error.message}`);
      }
    }
    console.log(`Deleted on ${host}: ${deleted} of ${count}`);
  } catch (error) {
    console.error(error.message);
    failed += 1;
  } finally {
    await session.close();
  }
  if (failed) process.exit(1);
}

const args = process.argv.slice(2);

if (args[0] === "public") {
  const [, command, ...rest] = args;
  if (command === "push" || command === "mirror") await sendPublic(rest, { mirror: command === "mirror" });
  else if (command === "pull") await receivePublic(rest);
  else if (command === "purge") await purgePublic(rest);
  else fail(USAGE);
  process.exit(0);
}

const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const words = args.filter((arg) => !arg.startsWith("--"));

if (words[0] !== "user" || words.length < 2) fail(USAGE);

// The store is opened only once the command is known to be one: opening it
// reads every folder.
const store = await import("./db.js");

function account(username) {
  const user = username ? store.getUser(String(username).toLowerCase()) : null;
  if (!user) fail(`No account is called ${username ?? ""}`.trim());
  return user;
}

const [, first, second, third] = words;

if (first === "list" && words.length === 2) {
  const users = store.listUsers();
  table([
    ["ID", "USERNAME", "ITEMS", "JOINED"],
    ...users.map((user) => [user.id, user.username, store.countItemsByUser(user.id), user.createdAt.slice(0, 10)]),
  ]);
  console.log(`${users.length} ${users.length === 1 ? "account" : "accounts"}`);
} else if (first === "delete" || second === "delete") {
  // Either order: `rab user delete liu`, `rab user liu delete`.
  const user = account(first === "delete" ? second : first);
  // The two accounts the server makes for itself are always there.
  if (user.username === store.PUBLIC_NAME || user.username === store.ADMIN_NAME) {
    fail(`${user.username} is rab's own account and is not deleted.`);
  }
  const port = await serverRunning();
  if (port) {
    fail(`rab is running on port ${port}. Stop it first (it holds the folders in memory and would write some of this back), then run this again.`);
  }
  const items = store.getItemsByUser(user.id).length;
  if (!flags.has("--yes")) {
    console.log(`This deletes the account ${user.username} for good: its ${items} ${items === 1 ? "item" : "items"}, its photographs, its bookings and its messages — on both sides.`);
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question(`Type ${user.username} to delete it: `);
    prompt.close();
    if (answer.trim() !== user.username) fail("Nothing was deleted.");
  }
  const gone = store.deleteUser(user.id);
  console.log(`Deleted ${user.username}: ${gone.items} items, ${gone.bookings} bookings, conversations with ${gone.conversations} other accounts.`);
} else if (second === "items" && words.length === 3) {
  const user = account(first);
  const items = store.getItemsByUser(user.id);
  table([
    ["ID", "CATEGORY", "STATE", "PRICE", "CREATED", "TITLE"],
    ...items.map((item) => [
      item.id,
      item.category || "-",
      item.active ? "published" : "unlisted",
      `${item.price} ${item.currency}`,
      item.createdAt.slice(0, 10),
      item.title,
    ]),
  ]);
  console.log(`${items.length} ${items.length === 1 ? "item" : "items"}`);
} else if (second === "pass" && words.length === 4) {
  const user = account(first);
  if (third.length < PASSWORD_MIN || third.length > PASSWORD_MAX) {
    fail(`A password is ${PASSWORD_MIN}–${PASSWORD_MAX} characters`);
  }
  store.setPassword(user.id, third);
  console.log(`${user.username} has a new password, and is signed out everywhere.`);
} else {
  fail(USAGE);
}
