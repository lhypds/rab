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
//   rab user delete <username>         delete an account and everything it has
//
// They read and write the same db.sqlite and data/users/ the server does (and
// the same .env says where those are). Listing is safe at any time, and so is
// a password. Deleting is not done under a running server, which holds the
// folders in memory and would write part of what was deleted back: stop it
// first.

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
  rab user delete <username> [--yes] delete an account and everything it has`;

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

const args = process.argv.slice(2);
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
