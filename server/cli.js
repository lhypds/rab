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
//   rab public -f <zip>                send a public folder, as a zip, to be
//                                      merged into _public's (POST /api/public)
//
// The user commands read and write the same data/users/ and db.sqlite the
// server does (and the same .env says where those are). Listing is safe at any
// time, and so is a password. Deleting is not done under a running server,
// which holds the folders in memory and would write part of what was deleted
// back: stop it first.
//
// rab public goes through a running server instead — this machine's, on its
// port, unless --host <url> (or RAB_HOST) names another — signed in as _admin:
// with RAB_TOKEN, a session token of _admin's, if there is one, and otherwise
// with _admin's password, asked for here (or RAB_PASSWORD).

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
  rab public -f <zip> [--host <url>] merge a public folder, as a zip, into _public's`;

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

// A server's answer, as JSON where it is, and its error said where it failed.
async function answerOf(response) {
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON — an nginx page, say
  }
  if (!response.ok) fail(`${response.status} ${body?.error ?? (text.trim().slice(0, 200) || response.statusText)}`);
  return body;
}

// rab public -f <zip> [--host <url>]
async function sendPublic(args) {
  let file = null;
  let host = process.env.RAB_HOST || null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-f" || arg === "--file") file = args[++i];
    else if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg === "--host") host = args[++i];
    else if (arg.startsWith("--host=")) host = arg.slice("--host=".length);
    else fail(USAGE);
  }
  if (!file) fail(USAGE);
  if (!host) host = `http://127.0.0.1:${Number(process.env.PORT) || 3016}`;
  if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
  host = host.replace(/\/+$/, "");

  const fs = await import("node:fs");
  let zip;
  try {
    zip = fs.readFileSync(path.resolve(file));
  } catch (error) {
    fail(`Cannot read ${file}: ${error.code === "ENOENT" ? "no such file" : error.message}`);
  }
  if (zip.length === 0) fail(`${file} is empty`);

  const request = async (url, options) => {
    try {
      return await fetch(`${host}${url}`, options);
    } catch (error) {
      fail(`Cannot reach ${host}: ${error.cause?.code ?? error.message}`);
    }
  };

  // Signed in for this one upload, and out again after, unless the token was
  // given — that one is whoever gave it's to keep.
  let token = process.env.RAB_TOKEN || null;
  const signedIn = !token;
  if (!token) {
    let password = process.env.RAB_PASSWORD;
    if (!password) {
      if (!process.stdin.isTTY) fail("Give _admin's password in RAB_PASSWORD, or a session token in RAB_TOKEN.");
      password = await askHidden(`_admin's password on ${host}: `);
    }
    const login = await answerOf(
      await request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "_admin", password }),
      }),
    );
    token = login.token;
  }

  console.log(`Sending ${path.basename(file)} (${(zip.length / 1024 / 1024).toFixed(1)} MB) to ${host} …`);
  const response = await request("/api/public", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/zip" },
    body: zip,
  });
  if (signedIn) {
    await fetch(`${host}/api/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  const merged = await answerOf(response);

  const { locations, items } = merged;
  console.log(`Places: ${locations.added} added, ${locations.replaced} replaced, ${locations.dropped} left out (the list is full)`);
  console.log(`Items:  ${items.added.length} added, ${items.replaced.length} replaced, ${items.skipped.length} passed over`);
  for (const folder of items.skipped) console.log(`  passed over: ${folder}`);
}

const args = process.argv.slice(2);

if (args[0] === "public") {
  await sendPublic(args.slice(1));
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
    ...users.map((user) => [user.id, user.username, store.getItemsByUser(user.id).length, user.createdAt.slice(0, 10)]),
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
    ["ID", "KIND", "CATEGORY", "STATE", "PRICE", "CREATED", "TITLE"],
    ...items.map((item) => [
      item.id,
      item.kind,
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
