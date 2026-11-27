import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import { isAdultCategory } from "../src/utils/categories.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

try {
  // real environment variables take precedence over .env entries
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // no .env file — use the ambient environment as-is
}

const {
  checkPassword,
  countUnread,
  createBooking,
  createItem,
  createMessage,
  createUser,
  emailTaken,
  deleteConversation,
  deleteExpiredSessions,
  deleteItem,
  deleteLocation,
  deleteSession,
  getBookmarkedItems,
  getBooking,
  getBookingsByRenter,
  getBookingsForItem,
  getBookingsForItemByRenter,
  getBookingsForOwner,
  getBookingsToReview,
  getContacts,
  getConversation,
  getDays,
  getDaysBetween,
  getItem,
  addLocations,
  getLocations,
  findSpot,
  findSharedSpot,
  findSharedSpots,
  getSpots,
  defaultSpot,
  keepItemsOnSpots,
  spotItems,
  spotItemKinds,
  spotsWith,
  setSpotItems,
  getItemImages,
  getItemReviews,
  getItemsAt,
  getItemsByUser,
  getItemsInBox,
  getRating,
  getReviewsOf,
  getSession,
  getTaken,
  getThreads,
  getUser,
  hasOwnOverlap,
  isBookmarked,
  overlapping,
  readConversation,
  saveContacts,
  saveLocation,
  SPOTS_MAX,
  saveSession,
  searchItems,
  setBookingStatus,
  setBookmark,
  setCancelRequest,
  setReview,
  setDays,
  touchSession,
  transaction,
  updateItem, PUBLIC_ID, PUBLIC_NAME,
  adoptPublicItems,
  warmPublicKeys,
  getBirthdate,
  isAdult,
  setBirthdate,
  ADMIN_ID,
  getEmail,
  setEmail,
  mergePublic,
  heldPublic,
  holdsPublic,
  purgePublicItem,
  purgePublicLocations,
  publicLocations,
  createRequest,
  deleteRequest,
  updateRequest,
  anonymousPeer,
  getUserById,
  answeredBy,
  getRequest,
  getRequestHeld,
  requestIdNow,
  saidOfRequest,
  getRequests,
  getRequestsByUser,
  requestImageNames,
} = await import("./db.js");
const { heldDir, isSpotFolder } = await import("./files.js");
const { MAX_IMAGE_BYTES, imageFile, isStoredName, keepImages, keepRequestImages, keepSpotImages, noteItemImages, pinImageFile, spotImage } = await import(
  "./images.js"
);
const { mailConfigured, sendMail } = await import("./mail.js");
const { MODES, roundPrice, readMinDuration, tooShort, dayBands, dayPrice, listPrice, openByRule, parseHours, parseRates, readDayList, readCancel, readContacts, readDeposit, readDayHours, readInquiryUnit, readOpenDays, readPriceUnit, readUnit, timeQuote } = await import("./rates.js");
const { lookupRegion } = await import("./region.js");
const { readPublicZip } = await import("./upload.js");
const { OpenAI, canDescribe, classifyListing, describeImage, describeObject, describeRequest } = await import("./describe.js");

const port = Number(process.env.PORT) || 3016;
const isProduction = process.env.NODE_ENV === "production";

/* -------------------------------------------------------------------- rules */

// A username is nearly one a Unix system would take: letters, digits, - and _,
// 32 characters at most, starting with a letter or a digit and not a number —
// "318yang" is a name, "318" is not. A name starting with _ is the server's
// own to give: "_public" is the account nobody has, and "_admin" the one that
// looks after the site (see db.js). (Capitals are
// folded to lower case before this is asked.)
const USERNAME_RE = /^(?!\d+$)[a-z0-9][a-z0-9_-]{0,31}$/;
const USERNAME_HINT = "A username is 1–32 characters: letters, digits, - and _, starting with a letter or a digit and not a number";
// What a name could be before that rule: all digits, CJK characters, _ at the
// front. Nobody
// can take such a name any more; whoever already has one still signs in by it.
const EARLIER_USERNAME_RE =
  /^[a-z0-9_\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}-]{1,32}$/u;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;
const PASSWORD_HINT = `A password is ${PASSWORD_MIN}–${PASSWORD_MAX} characters`;

// How long a session lasts unused. Presenting the token pushes the expiry out
// again, at most once a day, so a device somebody keeps using stays signed in.
const sessionAgeMs = 30 * 24 * 60 * 60 * 1000;
const sessionRenewMs = 24 * 60 * 60 * 1000;

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 2000;
const PLACE_MAX = 120;
const REGION_MAX = 120;
const IMAGES_MAX = 100;
const CATEGORY_RE = /^[a-z0-9-]{0,32}$/;
const PRICE_MAX = 100_000_000;
const CURRENCIES = new Set(["JPY", "CNY", "USD", "EUR"]);
const NOTE_MAX = 500;
const REVIEW_MAX = 500;
// How many of the things said about somebody their page is sent.
const REVIEWS_SHOWN = 50;
const MESSAGE_MAX = 1000;
// The longest single rental, and how far ahead the calendar reaches.
const BOOKING_MAX_DAYS = 90;
const CALENDAR_DAYS = 366;

deleteExpiredSessions(Date.now());

// A crawler left running (data/crawlers) keeps putting new items in the public
// account's folder; they are on the map within the minute, without a restart.
const ADOPT_EVERY_MS = 60 * 1000;
setInterval(() => {
  try {
    for (const id of adoptPublicItems()) noteItemImages(PUBLIC_ID, id);
  } catch (error) {
    console.error(error);
  }
}, ADOPT_EVERY_MS).unref();

function normalizeUsername(value) {
  return String(value ?? "").trim().normalize("NFKC").toLowerCase();
}

// A profile lives at /u/<name> and an item at /i/<id>, so no name can shadow
// one of rab's own pages; these are refused only so nobody can pass for the
// site or for the people who run it. Each is refused however it is dressed:
// with - and _ in it, with digits after it, with "rab" or "official" beside
// it — "admin", "_admin_", "admin01", "rab-admin" and "official_support" are
// all the one name. Only a name that comes to exactly one of these: "admin"
// inside a longer word ("badminton") is nobody passing for anybody.
const RESERVED_NAMES = new Set([
  "rab", "admin", "admins", "administrator", "administrators", "administration", "sysadmin", "superadmin",
  "root", "superuser", "sudo", "system", "sys", "owner", "master", "webmaster", "hostmaster", "postmaster",
  "staff", "team", "official", "operator", "moderator", "moderators", "mod", "mods",
  "support", "help", "helpdesk", "service", "customerservice", "customersupport", "contact", "info",
  "security", "abuse", "noreply", "mailer", "mail", "email", "billing", "payment", "payments",
  "login", "logout", "signin", "signup", "register", "account", "accounts", "mine", "others", "me", "user", "users",
  "public", "api", "www", "null", "undefined", "anonymous", "guest", "everyone", "all", "bot", "test",
  "kanri", "kanrisha", "unei", "uneisha", "guanli", "guanliyuan", "kefu",
]);

function reservedName(username) {
  const bare = username.replace(/[-_]/g, "").replace(/\d+$/, "");
  if (RESERVED_NAMES.has(bare)) return true;
  // And one of them with the site's own name or "official" at either end.
  const inner = bare.replace(/^(rab|official|the)+/, "").replace(/(rab|official)+$/, "");
  return inner === "" || RESERVED_NAMES.has(inner);
}

const RESERVED_FAULT = { error: "That username is not available", code: "USERNAME_RESERVED" };

function usernameFault(username) {
  return USERNAME_RE.test(username) ? null : { error: USERNAME_HINT, code: "USERNAME_INVALID" };
}

// The account of a name as it was typed, under today's rule or the earlier one.
function knownUser(username) {
  return USERNAME_RE.test(username) || EARLIER_USERNAME_RE.test(username) ? getUser(username) : null;
}

function usablePassword(value) {
  const password = String(value ?? "");
  return password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX ? password : null;
}

function text(value, max) {
  return String(value ?? "").trim().normalize("NFC").slice(0, max);
}

/* --------------------------------------------------------------------- days */

// A day is a calendar date and nothing more: "2026-11-19", no clock and no
// zone. A rental is counted in days at the place the item is, and both sides
// read the same square of the same calendar wherever they are sitting.
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value) {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

// The hour something is picked up or brought back: "09:30", on the clock of
// the place the item is.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isTime(value) {
  return typeof value === "string" && TIME_RE.test(value);
}

function addDays(day, count) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

// The earliest day anybody could still be calling today. The server keeps UTC
// and a reader west of it is still in yesterday, so the floor is one day back.
function earliestDay() {
  return addDays(new Date().toISOString().slice(0, 10), -1);
}

/* ----------------------------------------------------------------- sessions */

// The session is in one place: the Authorization header, set deliberately by
// the client. Nothing a browser attaches on its own authenticates anything, so
// a hostile page cannot spend a reader's session.
function sessionToken(req) {
  return /^Bearer\s+([^\s]+)$/i.exec(String(req.headers.authorization ?? ""))?.[1] ?? null;
}

function sessionHash(token) {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function currentSession(req) {
  const token = sessionToken(req);
  const tokenHash = token ? sessionHash(token) : null;
  const session = tokenHash ? getSession(tokenHash) : null;
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt <= now) {
    deleteSession(tokenHash);
    return null;
  }
  if (session.expiresAt - now <= sessionAgeMs - sessionRenewMs) {
    session.expiresAt = now + sessionAgeMs;
    touchSession(tokenHash, session.expiresAt);
  }
  return { tokenHash, ...session };
}

function startSession(user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  deleteExpiredSessions(now);
  saveSession(sessionHash(token), user.id, now + sessionAgeMs);
  return token;
}

// Most of rab can be read without an account — the map and an item's page are
// the things people are sent links to — so the session is read on every request
// and only demanded where something is being written or is somebody's own.
function readSession(req, _res, next) {
  const session = currentSession(req);
  req.user = session ? getUser(session.username) : null;
  next();
}

// The account as the browser is told about it: who it is, and whether it may
// be shown the grown-up categories (see categories.js) — for its lists to offer
// them. What it may see is decided here, whatever the browser thinks.
function accountOf(user) {
  return { ...user, adult: isAdult(user.id) };
}

// Whether whoever is asking may see an item: anybody may, but an item in a
// grown-up category only its owner or an account old enough for it.
function mayView(viewer, item) {
  if (!isAdultCategory(item.category)) return true;
  return Boolean(viewer) && (viewer.id === item.ownerId || isAdult(viewer.id));
}

const AGE_FAULT = { error: "Set your date of birth on your account to see this", code: "AGE_REQUIRED" };

function requireSession(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please sign in", code: "LOGIN_REQUIRED" });
  next();
}

/* ---------------------------------------------------------------------- app */

const app = express();
app.set("trust proxy", true);
// Answers squeezed for the way there: the map's items run to megabytes as
// written, and a fraction of that compressed. Pictures are compressed already
// and are left as they are.
app.use(compression());
app.use(express.json({ limit: "256kb" }));
app.use("/api", readSession);

app.get("/api/session", requireSession, (req, res) => {
  res.json({ user: accountOf(req.user), unread: countUnread(req.user.id) });
});

// Signing in is asked in two goes, the name and then the password. This is the
// first: it signs nobody in and says whether the name is an account at all, so
// the screen can ask "create it?" about a name nobody has rather than open an
// account on a typo.
app.post("/api/username", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  // The account that is nobody's is not one to sign in to.
  if (username === PUBLIC_NAME) return res.status(409).json(RESERVED_FAULT);
  const user = knownUser(username);
  if (user) return res.json({ username: user.username });
  // Not an account — and, where the name breaks the rule, not one that could
  // be made either, which is said now rather than after a password is chosen.
  const fault = usernameFault(username);
  if (fault) return res.status(400).json(fault);
  // Nor one that passes for the site: said now too. An account that already
  // has such a name, from before it was refused, was answered above.
  if (reservedName(username)) return res.status(409).json(RESERVED_FAULT);
  res.status(404).json({ error: "No such user", code: "USER_NOT_FOUND" });
});

app.post("/api/login", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const user = username === PUBLIC_NAME ? null : knownUser(username);
  if (!user) return res.status(404).json({ error: "No such user", code: "USER_NOT_FOUND" });
  if (!checkPassword(username, String(req.body?.password ?? ""))) {
    return res.status(401).json({ error: "Wrong password", code: "PASSWORD_WRONG" });
  }
  res.json({ user: accountOf(user), token: startSession(user), unread: countUnread(user.id) });
});

app.post("/api/logout", (req, res) => {
  const session = currentSession(req);
  if (session) deleteSession(session.tokenHash);
  res.status(204).end();
});


// Whether rab uses email at all. A setting, ENABLE_EMAIL in .env, and off
// unless it says so. What it turns on so far is one thing: opening an account
// asks for an email address and the code mailed to it. Without it an account
// is a name and a password, as it always was.
const ENABLE_EMAIL = /^(1|true|yes|on)$/i.test(String(process.env.ENABLE_EMAIL ?? "").trim());

// What opening an account takes here, for the form to ask for the right
// things before it asks for any.
app.get("/api/signup", (req, res) => {
  res.json({ email: ENABLE_EMAIL });
});

// With the setting on, an account is opened in two goes. The first says who
// and at what address, and a code is mailed there; the second brings the code
// back, which is what shows the address is theirs, and only then is there an
// account.
//
// The codes waiting to come back, by address. Kept in memory and nowhere
// else: a server that restarts forgets them, and the reader asks for another.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const CODE_RESEND_MS = 60 * 1000;
const codes = new Map();

const readEmail = (value) => {
  const email = String(value ?? "").trim().toLowerCase();
  return email.length <= EMAIL_MAX && EMAIL_RE.test(email) ? email : null;
};

// What a new account is asked for, checked — or what is wrong with it, as the
// answer to send back.
function newAccount(body) {
  const username = normalizeUsername(body?.username);
  const fault = usernameFault(username);
  if (fault) return { status: 400, fault };
  const password = usablePassword(body?.password);
  if (!password) return { status: 400, fault: { error: PASSWORD_HINT, code: "PASSWORD_INVALID" } };
  if (reservedName(username)) return { status: 409, fault: RESERVED_FAULT };
  if (getUser(username)) return { status: 409, fault: { error: "That username is taken", code: "USER_EXISTS" } };
  // No address is asked for, or kept, where the setting is off.
  if (!ENABLE_EMAIL) return { username, password, email: null };
  const email = readEmail(body?.email);
  if (!email) return { status: 400, fault: { error: "Enter an email address", code: "EMAIL_INVALID" } };
  if (emailTaken(email)) return { status: 409, fault: { error: "That email address already has an account", code: "EMAIL_TAKEN" } };
  return { username, password, email };
}

// The mail the code goes out in, in the language the form was being read in.
const CODE_MAIL = {
  en: (code) => ({
    subject: `${code} is your rab code`,
    text: `Your rab verification code is ${code}.\n\nIt is good for ${CODE_MINUTES} minutes. If you did not ask for it, ignore this mail.`,
  }),
  zh: (code) => ({
    subject: `rab 验证码：${code}`,
    text: `你的 rab 验证码是 ${code}。\n\n${CODE_MINUTES} 分钟内有效。如果不是你本人申请的，请忽略这封邮件。`,
  }),
  ja: (code) => ({
    subject: `rab 認証コード：${code}`,
    text: `rab の認証コードは ${code} です。\n\n${CODE_MINUTES}分間有効です。心当たりがない場合は、このメールを無視してください。`,
  }),
};

// A code mailed to an address for an account's name — one being opened, or
// one changing its address — and kept to be brought back. Null where it went,
// or what went wrong, as the answer to send back.
async function mailCode(email, username, lang) {
  // One mail a minute to an address, so the button cannot be leaned on.
  const waiting = codes.get(email);
  if (waiting && Date.now() - waiting.sentAt < CODE_RESEND_MS) {
    return { status: 429, fault: { error: "A code was just sent. Wait a minute before asking for another.", code: "CODE_TOO_SOON" } };
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const mail = (CODE_MAIL[String(lang ?? "").slice(0, 2)] ?? CODE_MAIL.en)(code);
  if (mailConfigured()) {
    try {
      await sendMail({ to: email, ...mail });
    } catch (error) {
      console.error(`[mail] ${error.message}`);
      return { status: 502, fault: { error: "The email could not be sent", code: "MAIL_FAILED" } };
    }
  } else if (isProduction) {
    console.error("[mail] not configured: set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and RAB_MAIL_FROM");
    return { status: 503, fault: { error: "The email could not be sent", code: "MAIL_FAILED" } };
  } else {
    // Worked on with no mail set up: the code is said here instead of sent.
    console.log(`[mail] not configured — the code for ${email} is ${code}`);
  }
  codes.set(email, {
    username,
    hash: sessionHash(code),
    expires: Date.now() + CODE_MINUTES * 60 * 1000,
    tries: 0,
    sentAt: Date.now(),
  });
  return null;
}

// The code that went to that address for that name, brought back: still good
// and not guessed at too often. A wrong one counts; the right one is used
// once. Null where it is the code, or what is wrong, as the answer to send.
function spendCode(email, username, given) {
  const waiting = codes.get(email);
  if (!waiting || waiting.username !== username || waiting.expires < Date.now()) {
    codes.delete(email);
    return { status: 400, fault: { error: "That code has expired. Ask for a new one.", code: "CODE_EXPIRED" } };
  }
  if (waiting.tries >= CODE_TRIES) {
    codes.delete(email);
    return { status: 429, fault: { error: "Too many wrong codes. Ask for a new one.", code: "CODE_EXPIRED" } };
  }
  const hash = sessionHash(String(given ?? "").replace(/\D/g, ""));
  if (hash.length !== waiting.hash.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(waiting.hash))) {
    waiting.tries += 1;
    return { status: 400, fault: { error: "That is not the code", code: "CODE_WRONG" } };
  }
  codes.delete(email);
  return null;
}

app.post("/api/users/code", async (req, res) => {
  if (!ENABLE_EMAIL) return res.status(404).json({ error: "Email verification is not in use", code: "VERIFY_OFF" });
  const account = newAccount(req.body);
  if (account.fault) return res.status(account.status).json(account.fault);
  const failed = await mailCode(account.email, account.username, req.body?.lang);
  if (failed) return res.status(failed.status).json(failed.fault);
  res.status(204).end();
});

app.post("/api/users", (req, res) => {
  const account = newAccount(req.body);
  if (account.fault) return res.status(account.status).json(account.fault);
  const { username, password, email } = account;
  // Without the setting there is no code to bring back.
  if (!ENABLE_EMAIL) {
    const user = createUser(username, password);
    return res.status(201).json({ user: accountOf(user), token: startSession(user), unread: 0 });
  }
  const wrong = spendCode(email, username, req.body?.code);
  if (wrong) return res.status(wrong.status).json(wrong.fault);
  const user = createUser(username, password, email);
  res.status(201).json({ user: accountOf(user), token: startSession(user), unread: 0 });
});

// The signed-in account's own address: the one the account is known by, apart
// from the ways it says it is reached (see /api/contacts). Any account may set
// one, change it, or — where the server does not ask for one — take it away;
// one account to an address. `verify` is whether a new one has to be proved
// with a code mailed to it first, which it does wherever signing up does.
app.get("/api/account", requireSession, (req, res) => {
  res.json({ email: getEmail(req.user.id), verify: ENABLE_EMAIL, birthdate: getBirthdate(req.user.id) });
});

// The address an account is asking to have, checked — or what is wrong with it.
function newEmail(req) {
  const email = readEmail(req.body?.email);
  if (!email) return { status: 400, fault: { error: "Enter an email address", code: "EMAIL_INVALID" } };
  if (emailTaken(email, req.user.id)) {
    return { status: 409, fault: { error: "That email address already has an account", code: "EMAIL_TAKEN" } };
  }
  return { email };
}

app.post("/api/account/email/code", requireSession, async (req, res) => {
  if (!ENABLE_EMAIL) return res.status(404).json({ error: "Email verification is not in use", code: "VERIFY_OFF" });
  const asked = newEmail(req);
  if (asked.fault) return res.status(asked.status).json(asked.fault);
  const failed = await mailCode(asked.email, req.user.username, req.body?.lang);
  if (failed) return res.status(failed.status).json(failed.fault);
  res.status(204).end();
});

app.put("/api/account/email", requireSession, (req, res) => {
  // Sent empty, the address is taken away — where an account may be without.
  if (String(req.body?.email ?? "").trim() === "") {
    if (ENABLE_EMAIL) return res.status(400).json({ error: "Enter an email address", code: "EMAIL_INVALID" });
    setEmail(req.user.id, null);
    return res.json({ email: null });
  }
  const asked = newEmail(req);
  if (asked.fault) return res.status(asked.status).json(asked.fault);
  // The one it has already is not proved again.
  if (ENABLE_EMAIL && asked.email !== getEmail(req.user.id)) {
    const wrong = spendCode(asked.email, req.user.username, req.body?.code);
    if (wrong) return res.status(wrong.status).json(wrong.fault);
  }
  setEmail(req.user.id, asked.email);
  res.json({ email: asked.email });
});

// When the account says it was born: "YYYY-MM-DD", or "" to take it away. It
// is what lets it see the grown-up categories, and nobody else is shown it.
const BIRTH_EARLIEST = "1900-01-01";
app.put("/api/account/birthdate", requireSession, (req, res) => {
  const wanted = String(req.body?.birthdate ?? "").trim();
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (wanted !== "") {
    const real = /^\d{4}-\d{2}-\d{2}$/.test(wanted) && new Date(`${wanted}T00:00:00Z`).toISOString().slice(0, 10) === wanted;
    if (!real || wanted < BIRTH_EARLIEST || wanted > today) {
      return res.status(400).json({ error: "Enter a real date of birth", code: "BIRTHDATE_INVALID" });
    }
  }
  setBirthdate(req.user.id, wanted || null);
  res.json({ birthdate: getBirthdate(req.user.id), adult: isAdult(req.user.id) });
});

// Who somebody is: when they joined, how the people they have dealt with rate
// them and what those people said, and what they have out for rent.
app.get("/api/users/:username", (req, res) => {
  const user = getUser(normalizeUsername(req.params.username));
  // The account that is nobody's has no page.
  if (!user || user.id === PUBLIC_ID) return res.status(404).json({ error: "No such user" });
  res.json({
    user: { username: user.username, createdAt: user.createdAt },
    rating: getRating(user.id),
    reviews: getReviewsOf(user.id).slice(0, REVIEWS_SHOWN),
    // Not somebody else's that this account wrote down: those are nobody's
    // by name, and are not listed as this account's.
    items: getItemsByUser(user.id, { publicOnly: true }).filter((item) => !item.shared && mayView(req.user, item)).map(publicItem),
    // All their spots — the default one first, which every account has —
    // each with how many of its items are shown and the first one's picture.
    spots: spotSummaries(user, req.user),
  });
});

/* -------------------------------------------------------------------- spots */

// A spot is an item (see db.js): made, changed, booked and deleted by the
// item routes, with `spot: true` when it is made. What is its own is which of
// the account's items are on it.
const SPOT_ITEMS_MAX = 200;

// The items on a spot, as whoever is looking may see them: its owner every
// one, anybody else the published ones they may see.
function itemsInSpot(spot, viewer) {
  const own = viewer?.id === spot.ownerId;
  return spotItems(spot, { publicOnly: !own })
    .filter((item) => own || mayView(viewer, item))
    .map(publicItem);
}

// A spot as a row in a list gets it: how many items it shows, not the items.
function spotSummary(spot, viewer) {
  const items = itemsInSpot(spot, viewer);
  return {
    ...publicItem(spot),
    count: items.length,
    // How many of them are out for anybody to see.
    published: items.filter((item) => item.active).length,
    // Its row wears its own first photograph, or else its first item's.
    thumb: spot.thumb ?? items[0]?.thumb ?? null,
  };
}

// An account's spots, as a list gets them: to anybody but its owner only the
// published ones they may see.
function spotSummaries(user, viewer) {
  const own = viewer?.id === user.id;
  return getSpots(user.id)
    .filter((spot) => own || (spot.active && mayView(viewer, spot)))
    .map((spot) => spotSummary(spot, viewer));
}

// Of the ids sent for a spot's items, the account's own items — any of them:
// a spot takes things, spaces and services alike — each once, in the order
// sent.
function spotItemIds(userId, ids) {
  const own = new Set(getItemsByUser(userId).filter((item) => !item.shared).map((item) => item.id));
  return [...new Set(ids.map(String))].filter((id) => own.has(id)).slice(0, SPOT_ITEMS_MAX);
}

// Which of the account's items are on one of its spots, and in what order:
// the whole list, as the sheet for it sends it.
app.put("/api/spots/:id/items", requireSession, (req, res) => {
  const spot = findSpot(req.user.id, req.params.id);
  if (!spot) return res.status(404).json({ error: "No such spot" });
  if (!Array.isArray(req.body?.itemIds)) return res.status(400).json({ error: "Send the items as a list" });
  setSpotItems(req.user.id, spot.id, spotItemIds(req.user.id, req.body.itemIds));
  // An item taken off the last spot it was on goes back on the default one
  // — which is this one, where it is the default spot being edited.
  keepItemsOnSpots(req.user.id);
  const saved = findSpot(req.user.id, spot.id);
  res.json({ spot: { ...publicItem(saved), items: itemsInSpot(saved, req.user) } });
});

// One of the account's own items put on one of its spots — dragged onto it in
// the list of spots — after what is there. `added` is false where it was on
// the spot already. The spot answers as a row in the list does.
app.post("/api/spots/:id/items", requireSession, (req, res) => {
  const spot = findSpot(req.user.id, req.params.id);
  if (!spot) return res.status(404).json({ error: "No such spot" });
  const item = getItemsByUser(req.user.id).find((each) => each.id === String(req.body?.itemId ?? ""));
  if (!item || item.shared) return res.status(400).json({ error: "Choose an item of your own" });
  const itemIds = spotItems(spot).map((each) => each.id);
  if (itemIds.includes(item.id)) return res.json({ added: false, spot: spotSummary(spot, req.user) });
  if (itemIds.length >= SPOT_ITEMS_MAX) return res.status(409).json({ error: "This spot is full" });
  const saved = setSpotItems(req.user.id, spot.id, [...itemIds, item.id]);
  res.json({ added: true, spot: spotSummary(saved, req.user) });
});

// The spots a new item can be put on, for the list on the sheet it is made
// on: the account's own, its default first — or, with `shared=1`, those of
// the public account whose title or place has `q` in it, for somebody
// else's item.
app.get("/api/spots/choices", requireSession, (req, res) => {
  const pick = (spot) => ({ id: spot.id, title: spot.title, place: spot.place ?? null, default: spot.default, thumb: spot.thumb ?? null });
  if (req.query.shared === "1") return res.json({ spots: findSharedSpots(req.query.q).map(pick) });
  res.json({ spots: getSpots(req.user.id).map(pick) });
});

/* -------------------------------------------------------------------- items */

// What goes out about an item to anybody: everything on its page except the
// owner's account id, which is nobody's business.
function publicItem(item) {
  const { ownerId, ...rest } = item;
  return rest;
}

// An item as the map and the lists beside it get it, thousands at a time:
// without its photographs, of which a pin and a row draw only the first — as
// `thumb` and `pin` — and its own page asks for the item whole.
// A spot among them says how many items are on it that the viewer may see,
// and the categories it is in: the one chosen for it first, where there is
// one, and then those of the items on it it is not already in, the most first.
// The map counts it under each of them.
// Only what the map, its bubble, the rows and the filter read: the booking
// rules, calendar and the rest are on the item's own page. Thousands at a
// time, every field left out is megabytes not written, hashed, squeezed and
// read again in the browser.
function listedItem(item, viewer) {
  const listed = {
    id: item.id,
    spot: item.spot,
    title: item.title,
    what: item.what,
    description: item.description,
    category: item.category,
    mode: item.mode,
    price: item.price,
    currency: item.currency,
    located: item.located,
    latitude: roundDegree(item.latitude),
    longitude: roundDegree(item.longitude),
    place: item.place,
    // A row says the area's name where there is no place; its box is not
    // needed here.
    region: item.region ? { name: item.region.name } : null,
    thumb: item.thumb,
    // What it says in other languages, where it says anything in them: a row
    // and a pin's card are read in the reader's own.
    ...(item.translations && { translations: item.translations }),
    pin: item.pin,
    active: item.active,
    shared: item.shared,
    owner: item.owner,
    rating: item.rating,
    // The bubble's Request goes the way its owner said first.
    contacts: item.contacts.slice(0, 1),
  };
  if (!item.spot) return listed;
  const own = viewer?.id === item.ownerId;
  const items = spotItemKinds(item, { publicOnly: !own }).filter((each) => own || mayView(viewer, each));
  return { ...listed, count: items.length, categories: spotCategories(item, items) };
}

// To the millionth of a degree — a hand's breadth — which is as near as a pin
// is put.
const roundDegree = (value) => (value == null ? value : Math.round(value * 1e6) / 1e6);

function spotCategories(spot, items) {
  const counts = new Map();
  for (const each of items) if (each.category) counts.set(each.category, (counts.get(each.category) ?? 0) + 1);
  const theirs = [...counts].sort((a, b) => b[1] - a[1]).map(([category]) => category);
  return [...new Set([spot.category, ...theirs].filter(Boolean))];
}

function parseNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function parsePrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const price = parseNumber(value, 0, PRICE_MAX);
  return price === null ? null : Math.round(price * 100) / 100;
}

// The photographs an item is asking to carry, as the names of files this server
// stored. A name it did not write, or one whose file is gone, is refused rather
// than kept as a picture that will not load.
function parseImages(value) {
  if (!Array.isArray(value) || value.length > IMAGES_MAX) return null;
  const images = [];
  for (const entry of value) {
    const name = String(entry?.name ?? entry?.src ?? "").split("/").pop();
    const thumb = String(entry?.thumb ?? "").split("/").pop() || name;
    if (!isStoredName(name) || !isStoredName(thumb)) return null;
    if (!imageFile(name) || !imageFile(thumb)) return null;
    images.push({
      name,
      thumb,
      width: parseNumber(entry?.width, 1, 20000),
      height: parseNumber(entry?.height, 1, 20000),
    });
  }
  return images;
}

// An item's photographs belong in the item's own folder, whoever uploaded
// them: taken there once the item is saved and has a folder to take them to.
function keepItemImages(item) {
  const names = getItemImages(item.id).flatMap((image) => [image.name, image.thumb]);
  // A spot's are in its folder under spots/ (see files.js).
  if (item.spot) keepSpotImages(item.ownerId, item.id, names);
  else keepImages(item.ownerId, item.id, names);
}

// An area, as the form sends it: what it is called, the line saying where that
// is, and its box as [west, south, east, north]. Null where any of it is
// missing or out of range.
const MORE_REGIONS_MAX = 3;

// Whether one area is inside another: its ground within the other's, and the
// other named in what it is called or in the line saying where it is — 傘鉾町,
// "京都府京都市下京区", is inside 京都市. The ground alone does not say: the box
// round a big town has its neighbours in it too. (The same rule as the form's,
// in ItemModal.jsx.)
function regionWithin(inner, outer) {
  const edge = 0.002;
  const [west, south, east, north] = inner.bbox;
  const [outerWest, outerSouth, outerEast, outerNorth] = outer.bbox;
  if (west < outerWest - edge || south < outerSouth - edge || east > outerEast + edge || north > outerNorth + edge) return false;
  return inner.name.includes(outer.name) || inner.detail.includes(outer.name);
}

// Whether two areas cannot both be an item's: the same one, or one inside the
// other.
function regionsOverlap(a, b) {
  if (!a || !b) return false;
  const same = a.name === b.name && a.bbox.every((edge, index) => Math.abs(edge - b.bbox[index]) < 1e-4);
  return same || regionWithin(a, b) || regionWithin(b, a);
}

function parseRegion(value) {
  const name = text(value?.name, REGION_MAX);
  const bbox = Array.isArray(value?.bbox) && value.bbox.length === 4 ? value.bbox : null;
  if (!name || !bbox) return null;
  const west = parseNumber(bbox[0], -180, 180);
  const south = parseNumber(bbox[1], -90, 90);
  const east = parseNumber(bbox[2], -180, 180);
  const north = parseNumber(bbox[3], -90, 90);
  if (west === null || south === null || east === null || north === null || south > north) return null;
  const round = (number) => Math.round(number * 1e5) / 1e5;
  return { name, detail: text(value?.detail, REGION_MAX), bbox: [west, south, east, north].map(round) };
}

const HOMEPAGE_MAX = 500;
// How many links an item keeps, and how long its few words for what it is.
const LINKS_MAX = 10;
const WHAT_MAX = 40;
const QUANTITY_MAX = 9999;

// An item's own page somewhere else, as its address: http or https, with
// "https://" put in front of one written without. Empty where there is none,
// or where what was written is not an address.
// Its links, as the form sends them — or the one homepage from before there
// could be several: the good ones, each once, a few at most.
function readLinks(body) {
  const sent = Array.isArray(body?.links) ? body.links : body?.homepage ? [body.homepage] : [];
  return [...new Set(sent.map(readHomepage).filter(Boolean))].slice(0, LINKS_MAX);
}

function readHomepage(value) {
  const written = typeof value === "string" ? value.trim() : "";
  if (!written || written.length > HOMEPAGE_MAX) return "";
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(written) ? written : `https://${written}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname.includes(".")) return "";
    return url.href.slice(0, HOMEPAGE_MAX);
  } catch {
    return "";
  }
}

// What an item says of itself in each of rab's languages, where it has been
// said in more than one — the phone's scanner has every thing it recognizes
// named in all three: { en, zh, ja }, each { title, what, description }, cut
// to what the item's own may be. A language with no name is left out; null
// where none is left. The item's own title, what and description are the
// default — English, for what the scanner names — and what it says where its
// reader's language is not among them. On the disk each language is a file of
// its own beside item.json (see files.js).
const TEXT_LANGUAGES = ["en", "zh", "ja"];
function readTranslations(value) {
  if (!value || typeof value !== "object") return null;
  const kept = {};
  for (const code of TEXT_LANGUAGES) {
    const words = value[code];
    if (!words || typeof words !== "object") continue;
    const title = text(words.title, TITLE_MAX);
    if (!title) continue;
    kept[code] = { title, what: text(words.what, WHAT_MAX).trim(), description: text(words.description, DESCRIPTION_MAX) };
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

// A whole item, as the form sends it. Returns the fields or a sentence about
// what is wrong with them.
// `sharedMayBeOff`: somebody else's is on when it is first written down; one
// that is already there may have been switched off by the admin, and is then
// left as the request says (see the patch).
function parseItem(body, { regionOptional = false, sharedMayBeOff = false } = {}) {
  const title = text(body?.title, TITLE_MAX);
  if (!title) return { error: "An item needs a name" };
  // The area it is offered in, which every item says — it is what lists an
  // item for the people looking there, and the only place an item without a
  // pin has.
  // One that is offered neither way — not lent out, not for sale — is only
  // written down: what the phone's scanner registers is, until its owner says
  // otherwise. It need say no area, and no way to reach anybody.
  const offered = body?.spot === true || body?.rentable !== false || readDeposit(body?.salePrice, String(body?.currency ?? "")) !== null;
  const region = parseRegion(body?.region);
  if (!region && !regionOptional && offered) {
    return { error: "Say which area it is offered in", code: "REGION_REQUIRED" };
  }
  // The areas it is offered in besides: something that stands between two is
  // listed in both. A few at most, none said twice, and none inside another.
  const moreRegions = [];
  for (const entry of Array.isArray(body?.moreRegions) ? body.moreRegions : []) {
    const more = parseRegion(entry);
    if (!more || [region, ...moreRegions].some((other) => regionsOverlap(other, more))) continue;
    moreRegions.push(more);
    if (moreRegions.length === MORE_REGIONS_MAX) break;
  }
  const category = CATEGORY_RE.test(String(body?.category ?? "")) ? String(body?.category ?? "") : "";
  const currency = String(body?.currency ?? "");
  if (!CURRENCIES.has(currency)) return { error: "Unsupported currency" };

  // The rules that price it. A request from before there were any — a bare
  // price — is one rule: that price, every day.
  // Somebody else's is booked by asking and no other way: a request made
  // here would be nobody's to answer.
  // One that is not lent out at all — only for sale — is settled by asking
  // too: it has no calendar, no rental price, and no request to answer.
  // Neither is allowed too (see `offered` above).
  const rentable = body?.spot === true || body?.rentable !== false;
  const mode = body?.shared === true || !rentable ? "inquiry" : MODES.has(body?.mode) ? body.mode : "day";
  const sent = !rentable ? [{}] : Array.isArray(body?.rates) && body.rates.length > 0 ? body.rates : [{ price: body?.price }];
  // What it costs need not be said: it is then listed as priced on request,
  // and what is asked for here is asked for without a total.
  const unpriced = sent.length === 1 && (sent[0]?.price == null || sent[0].price === "");
  const parsed = unpriced ? { rates: [] } : parseRates(mode, sent, PRICE_MAX);
  if (parsed.error) return { error: parsed.error };
  // The hours it can be had, which only an item booked by the time has.
  const hours = mode === "time" ? parseHours(body?.hours) : { hours: [] };
  if (hours.error) return { error: hours.error, code: hours.code };
  // How the owner is reached, which an item booked by asking has to say.
  // How the owner is reached, whichever way it is booked. Somebody else's has
  // no account to send a message to, so that way is not one of its.
  const contacts = readContacts(body?.contacts).filter((contact) => body?.shared !== true || contact.type !== "message");
  // One that follows its account's contacts — the tick in its form — writes
  // none of its own: it is reached however the account is, now and later.
  const followContacts = body?.followContacts === true && body?.shared !== true;
  if (mode === "inquiry" && offered && !followContacts && contacts.length === 0) {
    return { error: "Say how you can be contacted", code: "CONTACT_REQUIRED" };
  }

  // Where it is, which is optional: a service has no doorway, and not every
  // owner wants a pin on their street. Both numbers or neither.
  const latitude = body?.latitude == null ? null : parseNumber(body.latitude, -90, 90);
  const longitude = body?.longitude == null ? null : parseNumber(body.longitude, -180, 180);
  const located = latitude !== null && longitude !== null;

  const images = parseImages(body?.images ?? []);
  if (!images) return { error: "One of the photos could not be found" };
  return {
    item: {
      title,
      // A few words for what it is, kept apart from its name.
      what: text(body?.what, WHAT_MAX).trim(),
      // How many of it there are — the count on the phone's item page: a
      // whole number from one up, and one where nothing sensible is said.
      quantity: Math.min(QUANTITY_MAX, Math.max(1, Math.floor(Number(body?.quantity)) || 1)),
      // The same said in rab's other languages, where it has been.
      translations: readTranslations(body?.translations),
      description: text(body?.description, DESCRIPTION_MAX),
      // Its own pages somewhere else, where it has any.
      links: readLinks(body),
      category,
      mode,
      rates: parsed.rates,
      hours: hours.hours,
      // The piece of the clock it is booked in, where it is booked by the time.
      unit: readUnit(body?.unit),
      // The shortest stretch one booking may be: a whole number of that unit.
      minDuration: readMinDuration(body?.minDuration, readUnit(body?.unit)),
      // And the stretch of the clock its prices are for.
      // Booked by asking, that may be a whole day as well.
      priceUnit: mode === "inquiry" ? readInquiryUnit(body?.priceUnit) : readPriceUnit(body),
      // The rule for days, and the dates whose hours were wiped (see rates.js).
      openDays: readOpenDays(body?.openDays),
      // The hours of the day one booked by the date is handed over in.
      dayHours: mode === "day" ? readDayHours(body?.dayHours) : null,
      hoursOff: mode === "time" ? readDayList(body?.hoursOff) : [],
      // When a confirmed booking may still be called off by whoever made it.
      cancel: readCancel(body?.cancel),
      // The deposit asked for on top of the price, or null.
      deposit: rentable ? readDeposit(body?.deposit, currency) : null,
      // Whether it is lent out — for temporary use — at all: one that is not
      // is only for sale.
      rentable,
      followContacts,
      // What it is sold for, where it is for sale as well as for rent, or
      // null: a sum read as a deposit is.
      salePrice: readDeposit(body?.salePrice, currency),
      contacts,
      // Whether it is somebody else's rather than the account's own: it is
      // then kept under the public account, which is nobody's, and anybody
      // signed in may change it. It cannot be switched off — except by the
      // admin — which is its owner's to say and not whoever wrote it down — and it
      // is booked by asking (see below), there being nobody here to say yes.
      shared: body?.shared === true,
      // Whether it is a spot: a collection of the account's items (see
      // spots). Said when it is made, and what it is from then on.
      spot: body?.spot === true,
      price: unpriced ? null : listPrice(mode, parsed.rates),
      currency,
      located,
      latitude: located ? Math.round(latitude * 1e6) / 1e6 : 0,
      longitude: located ? Math.round(longitude * 1e6) / 1e6 : 0,
      place: located ? text(body?.place, PLACE_MAX) || null : null,
      region,
      moreRegions: region ? moreRegions : [],
      images,
      active: (body?.shared === true && !sharedMayBeOff) || body?.active !== false,
    },
  };
}

// The days the owner has closed, as the form's calendar sends them: the whole
// list, from today on. What is in it is closed; what was closed and is not in
// it any more is open again. A day somebody already has is left as it is.
function applyClosed(item, closed) {
  if (!Array.isArray(closed)) return;
  const from = earliestDay();
  const until = addDays(from, CALENDAR_DAYS);
  const wanted = new Set(closed.filter((day) => isDay(day) && day >= from && day <= until));
  const current = getDays(item.id, from);
  const reopen = current.filter((day) => !day.available && !wanted.has(day.day)).map((day) => day.day);
  const already = new Set(current.filter((day) => !day.available).map((day) => day.day));
  const close = [...wanted].filter(
    (day) => !already.has(day) && overlapping(item.id, "confirmed", day, day).length === 0,
  );
  if (reopen.length > 0) setDays(item.id, reopen, { available: true, price: null });
  if (close.length > 0) setDays(item.id, close, { available: false, price: null });
}

// The days the owner has opened though the item's rule for days leaves them
// out, as the form's calendar sends them: the whole list, from today on. What
// is in it is open; a day that was opened so and is not in it any more goes
// back to what the rule says.
function applyOpened(item, opened) {
  if (!Array.isArray(opened)) return;
  const from = earliestDay();
  const until = addDays(from, CALENDAR_DAYS);
  const wanted = new Set(opened.filter((day) => isDay(day) && day >= from && day <= until && !openByRule(item, day)));
  const current = getDays(item.id, from);
  const drop = current.filter((day) => day.available && day.price == null && !wanted.has(day.day)).map((day) => day.day);
  const have = new Set(current.map((day) => day.day));
  const add = [...wanted].filter((day) => !have.has(day));
  if (drop.length > 0) setDays(item.id, drop, { available: true, price: null });
  if (add.length > 0) setDays(item.id, add, { available: true, price: null, explicit: true });
}

// The items inside the window of the map somebody is looking at.
app.get("/api/items", (req, res) => {
  const south = parseNumber(req.query.south, -90, 90);
  const north = parseNumber(req.query.north, -90, 90);
  const west = parseNumber(req.query.west, -180, 180);
  const east = parseNumber(req.query.east, -180, 180);
  if (south === null || north === null || west === null || east === null || south > north) {
    return res.status(400).json({ error: "Invalid bounds" });
  }
  res.json({ items: getItemsInBox({ south, north, west, east }).filter((item) => mayView(req.user, item)).map((item) => listedItem(item, req.user)) });
});

// The items offered at a spot: every one whose area has it inside, whether or
// not the item has a pin of its own. The list beside the map.
app.get("/api/items/at", (req, res) => {
  const latitude = parseNumber(req.query.latitude, -90, 90);
  const longitude = parseNumber(req.query.longitude, -180, 180);
  if (latitude === null || longitude === null) return res.status(400).json({ error: "Invalid spot" });
  // The box of the area the spot is in, where the browser knows it: items with
  // a pin inside it are listed too.
  const box = {
    south: req.query.south == null ? null : parseNumber(req.query.south, -90, 90),
    north: req.query.north == null ? null : parseNumber(req.query.north, -90, 90),
    west: req.query.west == null ? null : parseNumber(req.query.west, -180, 180),
    east: req.query.east == null ? null : parseNumber(req.query.east, -180, 180),
  };
  const whole = Object.values(box).every((edge) => edge !== null) && box.south <= box.north;
  res.json({ items: getItemsAt(latitude, longitude, whole ? box : null).filter((item) => mayView(req.user, item)).map((item) => listedItem(item, req.user)) });
});

// Items by what they say about themselves, for the box in the top bar.
app.get("/api/search", (req, res) => {
  const query = text(req.query.q, 60);
  if (query.length < 1) return res.json({ items: [] });
  res.json({ items: searchItems(query, 200).filter((item) => mayView(req.user, item)).slice(0, 20).map(publicItem) });
});

// Which country the request comes from, for where the map opens and where its
// search looks when the browser will not say where it is (see region.js).
app.get("/api/region", async (req, res) => {
  res.json(await lookupRegion(String(req.ip ?? "")));
});

// An item's page: the item, its calendar, and — to the two people a rental is
// between — where things stand. A stranger sees which days are taken; the
// renter also sees their own requests; the owner sees all of them.
// The spots an item is on, as the way to each from the item's own page: a
// name, whose it is (null for somebody else's, which is on the
// public account's spots, if any), and whether it is its owner's default.
function spotsOf(item) {
  if (item.spot) return [];
  return spotsWith(item).map((spot) => ({ id: spot.id, name: spot.title, owner: spot.owner ?? null, default: spot.default }));
}

function itemAnswer(item, viewer) {
  const from = earliestDay();
  const mine = Boolean(viewer && viewer.id === item.ownerId);
  return {
    // `bookmarked`: whether whoever is reading has kept it (see bookmarks).
    item: { ...publicItem(item), mine, bookmarked: Boolean(viewer && isBookmarked(viewer.id, item.id)),
      spots: spotsOf(item),
      // On a spot, the items on it.
      ...(item.spot ? { items: itemsInSpot(item, viewer) } : null),
    },
    // What the people who rented it said of it.
    reviews: getItemReviews(item.id).slice(0, REVIEWS_SHOWN),
    calendar: {
      from,
      until: addDays(from, CALENDAR_DAYS),
      days: getDays(item.id, from),
      taken: getTaken(item.id, from),
    },
    bookings: (!viewer
      ? []
      : mine
        ? getBookingsForItem(item.id)
        : getBookingsForItemByRenter(item.id, viewer.id)
    ).map((booking) => bookingFor(viewer, booking)),
  };
}

app.get("/api/items/:id", (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: "No such item", code: "ITEM_NOT_FOUND" });
  if (!mayView(req.user, item)) return res.status(403).json(AGE_FAULT);
  res.json(itemAnswer(item, req.user));
});

// Where somebody else's item is put is one of the public account's places
// from then on (its locations.json), for the next such item to be put at: the
// spot, and what it is called — the line written under the pin, or failing
// that the item's name. A spot or an address that is one of them already is not
// added twice.
// The places are read once for however many items: there are thousands of
// each, and reading the file again for every item kept the server from
// starting for minutes.
function rememberPublicPlaces(items) {
  const near = (a, b) => Math.abs(a - b) < 1e-5;
  let places = null;
  // The places by address, and by the square of the map they are in — as wide
  // as two spots may be apart and be one — so that an item is held against
  // the few places near it and not against every one: with tens of thousands
  // of items and thousands of places that was seconds of every start.
  const addresses = new Set();
  const squares = new Map();
  const square = (value) => Math.round(value * 1e5);
  const note = (place) => {
    if (place.address) addresses.add(place.address);
    if (typeof place.latitude !== "number" || typeof place.longitude !== "number") return;
    const key = `${square(place.latitude)},${square(place.longitude)}`;
    if (!squares.has(key)) squares.set(key, []);
    squares.get(key).push(place);
  };
  const isNear = (item) => {
    const row = square(item.latitude);
    const column = square(item.longitude);
    for (let y = row - 1; y <= row + 1; y += 1) {
      for (let x = column - 1; x <= column + 1; x += 1) {
        const there = squares.get(`${y},${x}`);
        if (there?.some((place) => near(place.latitude, item.latitude) && near(place.longitude, item.longitude))) return true;
      }
    }
    return false;
  };
  // The new ones, written together once every item has been looked at: a
  // write of the whole list for each is what a zip of thousands waits on.
  const fresh = [];
  for (const item of items) {
    if (!item.shared || !item.located || item.latitude == null || item.longitude == null) continue;
    if (!places) {
      places = getLocations(PUBLIC_ID);
      for (const place of places) note(place);
    }
    // One place per address too, as push and mirror count them (rab public).
    if ((item.place && addresses.has(item.place)) || isNear(item)) continue;
    const place = {
      name: text(item.place || item.title, LOCATION_NAME_MAX),
      address: item.place ?? "",
      latitude: item.latitude,
      longitude: item.longitude,
      region: item.region ?? null,
    };
    places.push(place);
    note(place);
    fresh.push(place);
  }
  addLocations(PUBLIC_ID, fresh);
}

const rememberPublicPlace = (item) => rememberPublicPlaces([item]);

// How the signed-in account is reached, as it wrote it on its account's own
// sheet: kept in its folder's user.json, and what an item of its own that is
// booked by asking starts with. Nothing an item says is kept here — only what
// is sent here. A message on rab is not one of them: it has nothing to write.
app.get("/api/contacts", requireSession, (req, res) => {
  res.json({ contacts: getContacts(req.user.id) });
});

app.put("/api/contacts", requireSession, (req, res) => {
  if (!Array.isArray(req.body?.contacts)) return res.status(400).json({ error: "Send the contacts as a list" });
  // A message here on rab is one of the ways, and the primary one until
  // another is put before it: said once at most.
  let messaged = false;
  const contacts = readContacts(req.body.contacts).filter((contact) => {
    if (contact.type !== "message") return true;
    if (messaged) return false;
    messaged = true;
    return true;
  });
  saveContacts(req.user.id, contacts);
  // None written is the message alone again (see getContacts).
  res.json({ contacts: getContacts(req.user.id) });
});

app.post("/api/items", requireSession, (req, res) => {
  // Only one's own is added: nothing is written down for somebody else.
  const parsed = parseItem({ ...req.body, shared: false });
  if (parsed.error) return res.status(400).json({ error: parsed.error, code: parsed.code });
  // Only an account old enough for a grown-up category puts anything in one.
  if (isAdultCategory(parsed.item.category) && !isAdult(req.user.id)) return res.status(403).json(AGE_FAULT);
  const ownerId = req.user.id;
  // An account keeps only so many spots.
  if (parsed.item.spot && getSpots(ownerId).length >= SPOTS_MAX) {
    return res.status(409).json({ error: `An account keeps at most ${SPOTS_MAX} spots`, code: "SPOTS_FULL" });
  }
  // An item goes on every one of the account's spots chosen (`spotIds`, or
  // the one `spotId` from before several could be), after what is there on
  // each — and on the default spot where none is chosen: every item is on at
  // least one. A spot is put on none.
  const spots = [];
  if (!parsed.item.spot) {
    const ids = Array.isArray(req.body?.spotIds) ? req.body.spotIds : req.body?.spotId != null ? [req.body.spotId] : [];
    for (const id of new Set(ids.map(String))) {
      const spot = findSpot(ownerId, id);
      if (!spot) return res.status(404).json({ error: "No such spot" });
      const itemIds = spotItems(spot).map((entry) => entry.id);
      if (itemIds.length >= SPOT_ITEMS_MAX) return res.status(409).json({ error: "This spot is full" });
      spots.push({ spot, itemIds });
    }
    if (spots.length === 0) {
      const spot = defaultSpot(ownerId);
      if (spot) spots.push({ spot, itemIds: spotItems(spot).map((entry) => entry.id) });
    }
  }
  const item = createItem(ownerId, parsed.item);
  const saved = [];
  try {
    keepItemImages(item);
    applyClosed(item, req.body?.closed);
    applyOpened(item, req.body?.opened);
    for (const { spot, itemIds } of spots) {
      const savedSpot = setSpotItems(ownerId, spot.id, [...itemIds, item.id]);
      if (!savedSpot) throw new Error("Could not save the spot");
      saved.push(savedSpot);
    }
  } catch (error) {
    deleteItem(ownerId, item.id);
    throw error;
  }
  res.status(201).json({
    item: { ...publicItem(item), mine: true },
    spots: saved.map((spot) => ({ ...publicItem(spot), items: itemsInSpot(spot, req.user) })),
    // The first of them, as one was answered before several could be chosen.
    ...(saved[0] && { spot: { ...publicItem(saved[0]), items: itemsInSpot(saved[0], req.user) } }),
  });
});

// The item a request is about, where the account asking may change it: its
// own — or anybody's, where the item is somebody else's that an account wrote
// down (`shared`), which is everybody's to keep right. The account that looks
// after the site may change any item at all: edit it, say when it can be had,
// switch it off, delete it.
function ownItem(req, res) {
  const item = getItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: "No such item", code: "ITEM_NOT_FOUND" });
    return null;
  }
  if (item.ownerId !== req.user.id && !item.shared && req.user.id !== ADMIN_ID) {
    res.status(403).json({ error: "That is not your item" });
    return null;
  }
  // Somebody else's in a grown-up category is kept right only by the accounts
  // that may see it.
  if (!mayView(req.user, item) && req.user.id !== ADMIN_ID) {
    res.status(403).json(AGE_FAULT);
    return null;
  }
  return item;
}

app.patch("/api/items/:id", requireSession, (req, res) => {
  const current = ownItem(req, res);
  if (!current) return;
  // A patch: whatever the request leaves out stays as it was, so switching an
  // item off does not have to resend its photographs.
  const stored = {
    ...current,
    images: getItemImages(current.id),
  };
  // An item from before areas were asked for has none, and is not made to
  // find one just to be switched off: it is asked for when the form sends one.
  // Somebody else's stays somebody else's: it is under the public account,
  // and no account can take it for its own. An account's own stays its own:
  // only one's own is added now, and nothing is handed over afterwards.
  // Nor is somebody else's switched off or on by whoever is reading it: that
  // is the admin's alone, and stays as it is through anybody else's change.
  const admin = req.user.id === ADMIN_ID;
  const sent = current.shared
    ? { ...req.body, shared: true, active: admin && "active" in (req.body ?? {}) ? req.body.active : current.active }
    : { ...req.body, shared: false };
  // An item that says itself in several languages, written over in one of
  // them — `lang`, the language the form's reader was reading it in, which is
  // the language of the words it showed and sends back: those words are that
  // language's, and go in its file. The item's own — the default — are
  // changed only by somebody writing in English, which is what the default
  // is in; written in another language, they stand. (The phone sends every
  // language's words itself, as `translations`, and is taken at its word.)
  const lang = TEXT_LANGUAGES.includes(req.body?.lang) ? req.body.lang : null;
  if (current.translations && lang && !("translations" in (req.body ?? {}))) {
    const was = current.translations[lang] ?? { title: current.title, what: current.what ?? "", description: current.description };
    sent.translations = {
      ...current.translations,
      [lang]: {
        title: sent.title ?? was.title,
        what: sent.what ?? was.what,
        description: sent.description ?? was.description,
      },
    };
    if (lang !== "en") {
      delete sent.title;
      delete sent.what;
      delete sent.description;
    }
  }
  const parsed = parseItem(
    { ...stored, ...sent },
    { regionOptional: !current.region && !("region" in (req.body ?? {})), sharedMayBeOff: current.shared },
  );
  if (parsed.error) return res.status(400).json({ error: parsed.error, code: parsed.code });
  if (isAdultCategory(parsed.item.category) && parsed.item.category !== current.category && !isAdult(req.user.id)) {
    return res.status(403).json(AGE_FAULT);
  }
  // Its folder goes where it is kept — the public account's for somebody
  // else's (see updateItem) — and its photographs are put in it.
  const item = updateItem(current.ownerId, current.id, parsed.item);
  keepItemImages(item);
  rememberPublicPlace(parsed.item);
  applyClosed(item, req.body?.closed);
  applyOpened(item, req.body?.opened);
  res.json({ item: { ...publicItem(item), mine: item.ownerId === req.user.id } });
});

app.delete("/api/items/:id", requireSession, (req, res) => {
  const item = ownItem(req, res);
  if (!item) return;
  // Somebody else's is everybody's to keep right and nobody's to throw away:
  // it is deleted by the account that looks after the site, which is asked
  // (see the delete request below).
  if (item.shared && req.user.id !== ADMIN_ID) {
    return res.status(403).json({ error: "Ask the administrator to delete this item", code: "DELETE_BY_REQUEST" });
  }
  // The default spot is the account's from the first, and goes only with the
  // account.
  if (item.default) return res.status(400).json({ error: "The default spot cannot be deleted", code: "DEFAULT_SPOT" });
  removeItem(item);
  res.status(204).end();
});

// An item deleted: whatever was still open on it is closed with it, and said
// so to whoever was waiting on an answer.
function removeItem(item) {
  transaction(() => {
    for (const booking of getBookingsForItem(item.id)) {
      if (booking.status !== "pending" && booking.status !== "confirmed") continue;
      setBookingStatus(booking.id, "cancelled");
      // Said by the account the booking was made with, which for an item
      // since made somebody else's is not the one it is under now.
      createMessage(booking.ownerId, booking.renterId, "", { kind: "cancelled", bookingId: booking.id });
    }
    deleteItem(item.ownerId, item.id);
  });
}

/* ------------------------------------------------------------ to the admin */

// What is sent to the account that looks after the site about an item: each
// is a line in the sender's conversation with it, like any message, which says
// which item it is about (see createMessage) — so the admin reads it in its
// inbox, goes to the item from it, and answers in the same place.
function adminPost(req, res) {
  const item = getItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: "No such item", code: "ITEM_NOT_FOUND" });
    return null;
  }
  // The admin has nobody to send it to but itself.
  if (req.user.id === ADMIN_ID) {
    res.status(400).json({ error: "You are the administrator" });
    return null;
  }
  return item;
}

// Asking for somebody else's item to be deleted, with a word about why: it
// is the admin that deletes one (see the delete above).
app.post("/api/items/:id/delete-request", requireSession, (req, res) => {
  const item = adminPost(req, res);
  if (!item) return;
  if (!item.shared) return res.status(400).json({ error: "Only an item listed for somebody else is deleted by request" });
  createMessage(req.user.id, ADMIN_ID, text(req.body?.note, NOTE_MAX), { kind: "deleteRequest", itemId: item.id });
  res.status(201).json({ sent: true });
});

// Saying something is wrong with an item: what kind of thing, and a word
// about it — which "other" has to have, there being nothing else said.
// "unavailable" is that the thing is not there to be had any more, which
// asks the admin to delete it; "infringement" is that the page uses what is
// somebody's without their leave, which asks the same.
const REPORT_REASONS = new Set(["inaccurate", "unavailable", "infringement", "spam", "scam", "prohibited", "offensive", "other"]);

app.post("/api/items/:id/report", requireSession, (req, res) => {
  const item = adminPost(req, res);
  if (!item) return;
  if (item.ownerId === req.user.id) return res.status(400).json({ error: "You cannot report your own item" });
  const reason = String(req.body?.reason ?? "");
  if (!REPORT_REASONS.has(reason)) return res.status(400).json({ error: "Choose what is wrong with it", code: "REASON_REQUIRED" });
  const note = text(req.body?.note, NOTE_MAX);
  if (reason === "other" && !note) return res.status(400).json({ error: "Say what is wrong with it", code: "NOTE_REQUIRED" });
  createMessage(req.user.id, ADMIN_ID, note, { kind: "report", itemId: item.id, reason });
  res.status(201).json({ sent: true });
});

/* ----------------------------------------------------------------- calendar */

// The owner's answer about a handful of days: whether they can be had, and
// optionally what they cost. `price: null` puts them back to the item's own.
app.put("/api/items/:id/days", requireSession, (req, res) => {
  const item = ownItem(req, res);
  if (!item) return;
  const days = Array.isArray(req.body?.days) ? [...new Set(req.body.days)] : [];
  if (days.length === 0 || days.length > CALENDAR_DAYS || !days.every(isDay)) {
    return res.status(400).json({ error: "Invalid days" });
  }
  const available = req.body?.available !== false;
  const price = parsePrice(req.body?.price);
  if (req.body?.price != null && req.body.price !== "" && price === null) {
    return res.status(400).json({ error: "Invalid price" });
  }
  // A day somebody already has cannot be closed from under them: the booking
  // is cancelled first, which tells them, and then the day is free to close.
  if (!available) {
    const clash = days.find((day) => overlapping(item.id, "confirmed", day, day).length > 0);
    if (clash) {
      return res.status(409).json({ error: `${clash} is already booked`, code: "DAY_BOOKED", day: clash });
    }
  }
  // A day the rule for days leaves out, opened here, is open by its entry.
  const outside = available ? days.filter((day) => !openByRule(item, day)) : [];
  const inside = days.filter((day) => !outside.includes(day));
  if (inside.length > 0) setDays(item.id, inside, { available, price: available ? price : null });
  if (outside.length > 0) setDays(item.id, outside, { available: true, price, explicit: true });
  res.json(itemAnswer(item, req.user));
});

/* ----------------------------------------------------------------- bookings */

function bookingFor(viewer, booking) {
  const { renterId, ownerId, reviewedBy, ...rest } = booking;
  const owned = ownerId === viewer.id;
  // `reviewed`: whether the reader has already said how the other side was.
  return { ...rest, mine: renterId === viewer.id, owned, reviewed: reviewedBy[owned ? "owner" : "renter"] };
}

// Whether a booking is complete: the owner said yes to it and its time has
// passed. It ends at the time it says on the day it says — the end of its last
// slot, its return time, or midnight where it has neither — on a clock the
// server does not know: the clock furthest ahead is taken, fourteen hours on,
// so nobody whose rental is over is told that it is not yet. The reader's own
// clock is what decides when they are asked (see the client's bookingEnded).
function bookingEnded(booking) {
  if (booking.status !== "confirmed") return false;
  const time = booking.slots?.length ? booking.slots.map((slot) => slot.end).sort().at(-1) : booking.endTime || "24:00";
  const [hours, minutes] = time.split(":").map(Number);
  const ends = Date.parse(`${booking.end}T00:00:00Z`) + (hours * 60 + minutes) * 60_000;
  return Number.isFinite(ends) && Date.now() + 14 * 3_600_000 >= ends;
}

// Asking for an item: from one day to another where it is booked by the date,
// or for a stretch of one day's hours where it is booked by the time. Nothing
// is taken off the calendar by asking — only the owner saying yes does that —
// so two people can ask for the same week and the owner chooses.
app.post("/api/items/:id/bookings", requireSession, (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: "No such item", code: "ITEM_NOT_FOUND" });
  if (item.ownerId === req.user.id) return res.status(400).json({ error: "You cannot rent your own item" });
  if (!item.active) return res.status(409).json({ error: "This item is not available", code: "ITEM_INACTIVE" });
  // Booked by asking, it is arranged with its owner and not requested here.
  if (item.mode === "inquiry") {
    return res.status(409).json({ error: "This item is booked by contacting its owner", code: "INQUIRY_ONLY" });
  }

  const bySlot = item.mode === "time";
  const start = req.body?.start;
  const end = bySlot ? start : req.body?.end;
  if (!isDay(start) || !isDay(end) || start > end) return res.status(400).json({ error: "Invalid dates" });
  const from = earliestDay();
  if (start < from || end > addDays(from, CALENDAR_DAYS)) {
    return res.status(400).json({ error: "Those dates are outside the calendar" });
  }
  const days = daysBetween(start, end);
  if (days.length > BOOKING_MAX_DAYS) {
    return res.status(400).json({ error: `A rental is at most ${BOOKING_MAX_DAYS} days` });
  }

  // A rental counted in days also says its hours: when it is picked up on the
  // first day and when it comes back on the last. They are what the two sides
  // meet by; the days are still taken and priced whole.
  const startTime = bySlot ? null : req.body?.startTime;
  const endTime = bySlot ? null : req.body?.endTime;
  if (!bySlot) {
    if (!isTime(startTime) || !isTime(endTime)) {
      return res.status(400).json({ error: "Pick a start and an end time", code: "TIME_REQUIRED" });
    }
    if (start === end && startTime >= endTime) {
      return res.status(400).json({ error: "The end time must be after the start time", code: "TIME_ORDER" });
    }
    // Inside the hours the item is handed over in on each of the two days,
    // where it says any.
    const inside = (day, time) => {
      const bands = dayBands(item, day);
      return !bands || bands.some((band) => time >= band.start && time <= band.end);
    };
    if (!inside(start, startTime) || !inside(end, endTime)) {
      return res.status(400).json({ error: "Pick times inside the hours it is handed over in", code: "TIME_OUTSIDE" });
    }
  }

  // The hours asked for, in whole pieces of the item's unit and inside the hours the item has
  // that day — priced by the item's own rules rather than the request's.
  let slots = null;
  if (bySlot) {
    const from = String(req.body?.startTime ?? "");
    const until = String(req.body?.endTime ?? "");
    const price = timeQuote(item, start, from, until);
    if (price === null) {
      return res.status(400).json({ error: "Pick hours it can be booked for", code: "TIME_UNAVAILABLE" });
    }
    if (tooShort(item, from, until)) {
      return res.status(400).json({ error: "Book a longer stretch", code: "TIME_TOO_SHORT" });
    }
    // An item that says no price has hours that cost nothing that is known.
    slots = [{ start: from, end: until, price: item.price == null ? null : price }];
  }

  try {
    const booking = transaction(() => {
      const overrides = new Map(getDaysBetween(item.id, start, end).map((day) => [day.day, day]));
      // A day can be had where the owner's entry for it says so, and where
      // there is none, where the rule for days has it. (By the time, the rule
      // is already in the hours the day was found to have.)
      const shut = (day) => {
        const entry = overrides.get(day);
        return entry ? entry.available === false : !bySlot && !openByRule(item, day);
      };
      if (days.some(shut)) return { code: "DAYS_UNAVAILABLE" };
      if (overlapping(item.id, "confirmed", start, end, { slots }).length > 0) return { code: "DAYS_UNAVAILABLE" };
      if (hasOwnOverlap(item.id, req.user.id, start, end, slots)) return { code: "ALREADY_REQUESTED" };
      // What it comes to — or null, where any part of it has no price said.
      const parts = bySlot ? slots.map((slot) => slot.price) : days.map((day) => overrides.get(day)?.price ?? dayPrice(item, day));
      const total = parts.some((part) => part == null) ? null : parts.reduce((sum, part) => sum + part, 0);
      const created = createBooking({
        itemId: item.id,
        renterId: req.user.id,
        start,
        end,
        // To the smallest coin of its currency: the yen has nothing after the point.
        total: total === null ? null : roundPrice(total, item.currency),
        currency: item.currency,
        note: text(req.body?.note, NOTE_MAX),
        slots,
        startTime,
        endTime,
      });
      // The request is also a line in the conversation with the owner, which is
      // what puts the dot on their envelope.
      createMessage(req.user.id, item.ownerId, created.note ?? "", { kind: "request", bookingId: created.id });
      return { created };
    });
    if (booking.code === "DAYS_UNAVAILABLE") {
      return res.status(409).json({ error: "Some of that is no longer available", code: booking.code });
    }
    if (booking.code === "ALREADY_REQUESTED") {
      return res.status(409).json({ error: "You have already asked for that", code: booking.code });
    }
    res.status(201).json({ booking: bookingFor(req.user, booking.created), ...itemAnswer(item, req.user) });
  } catch (error) {
    console.error("booking failed", error);
    res.status(500).json({ error: "Could not make the booking" });
  }
});

// What became of a request. The owner confirms or declines a pending one;
// either side may cancel one that is pending or confirmed.
app.patch("/api/bookings/:id", requireSession, (req, res) => {
  const id = Number(req.params.id);
  const booking = Number.isSafeInteger(id) ? getBooking(id) : null;
  if (!booking) return res.status(404).json({ error: "No such booking" });
  const isOwner = booking.ownerId === req.user.id;
  const isRenter = booking.renterId === req.user.id;
  if (!isOwner && !isRenter) return res.status(404).json({ error: "No such booking" });

  // Asking to be let out of a booking, and the owner's no to that. Whoever
  // made a confirmed booking may ask, with a word about why; the owner, who is
  // asked, may turn it down — or agree, which is simply cancelling it (below).
  if ("cancelRequest" in (req.body ?? {})) {
    const asking = req.body.cancelRequest === true;
    const fits = asking
      ? isRenter && booking.status === "confirmed" && !booking.cancelRequested
      : isOwner && booking.status === "confirmed" && booking.cancelRequested;
    if (!fits) return res.status(409).json({ error: "That booking cannot be changed that way", code: "BAD_STATUS" });
    const updated = transaction(() => {
      const changed = setCancelRequest(booking.id, asking);
      createMessage(req.user.id, isOwner ? booking.renterId : booking.ownerId, asking ? text(req.body?.note, NOTE_MAX) : "", {
        kind: asking ? "cancelRequest" : "cancelRefused",
        bookingId: booking.id,
      });
      return changed;
    });
    return res.json({ booking: bookingFor(req.user, updated) });
  }

  const status = String(req.body?.status ?? "");
  const allowed =
    (status === "confirmed" && isOwner && booking.status === "pending") ||
    (status === "declined" && isOwner && booking.status === "pending") ||
    (status === "cancelled" && (booking.status === "pending" || booking.status === "confirmed"));
  if (!allowed) return res.status(409).json({ error: "That booking cannot be changed that way", code: "BAD_STATUS" });

  // Whoever made a booking calls it off by the rule it was made under, once
  // the owner has said yes to it: not at all, or only so many days before it
  // starts. A request still waiting can always be withdrawn, and the owner is
  // not held to the rule — it is theirs. "Today" is the earliest day anybody
  // could still be calling today, so nobody is told too late a day early.
  if (status === "cancelled" && isRenter && booking.status === "confirmed") {
    if (booking.cancel?.mode === "none") {
      return res.status(409).json({ error: "This booking cannot be cancelled", code: "CANCEL_NOT_ALLOWED" });
    }
    if (booking.cancel?.mode === "days" && earliestDay() > addDays(booking.start, -booking.cancel.days)) {
      return res.status(409).json({ error: "It is too late to cancel this booking", code: "CANCEL_TOO_LATE" });
    }
    // By the hour, the booking starts at the time it says on the day it says,
    // on a clock the server does not know: the clock furthest behind is taken,
    // twelve hours back, for the same reason the day above is the earliest.
    if (booking.cancel?.mode === "hours") {
      const time = booking.slots?.[0]?.start ?? booking.startTime ?? "00:00";
      const starts = Date.parse(`${booking.start}T${time === "24:00" ? "23:59" : time}:00Z`);
      if (Date.now() - 12 * 3_600_000 > starts - booking.cancel.hours * 3_600_000) {
        return res.status(409).json({ error: "It is too late to cancel this booking", code: "CANCEL_TOO_LATE" });
      }
    }
  }

  const other = isOwner ? booking.renterId : booking.ownerId;
  const result = transaction(() => {
    if (status === "confirmed") {
      const taking = { exceptId: booking.id, slots: booking.slots };
      if (overlapping(booking.itemId, "confirmed", booking.start, booking.end, taking).length > 0) {
        return { code: "DAYS_UNAVAILABLE" };
      }
      // Saying yes to one request for a week is saying no to the others for it.
      for (const rival of overlapping(booking.itemId, "pending", booking.start, booking.end, taking)) {
        setBookingStatus(rival.id, "declined");
        createMessage(req.user.id, rival.renterId, "", { kind: "declined", bookingId: rival.id });
      }
    }
    const updated = setBookingStatus(booking.id, status);
    createMessage(req.user.id, other, "", { kind: status, bookingId: booking.id });
    return { updated };
  });
  if (result.code) {
    return res.status(409).json({ error: "Those days have already been booked", code: result.code });
  }
  res.json({ booking: bookingFor(req.user, result.updated) });
});

// The bookings that are complete and that the reader has not rated the other
// side of yet: what the sheet that asks for a rating is opened for.
app.get("/api/reviews/pending", requireSession, (req, res) => {
  res.json({
    bookings: getBookingsToReview(req.user.id)
      .filter(bookingEnded)
      .map((booking) => bookingFor(req.user, booking)),
  });
});

// How the other side of a complete booking was: one to five stars, and a word
// about it where there is one. Whoever rented rates the owner and, in stars of
// its own, the item; the owner rates whoever rented. Each side says it once.
app.post("/api/bookings/:id/review", requireSession, (req, res) => {
  const id = Number(req.params.id);
  const booking = Number.isSafeInteger(id) ? getBooking(id) : null;
  if (!booking || (booking.ownerId !== req.user.id && booking.renterId !== req.user.id)) {
    return res.status(404).json({ error: "No such booking" });
  }
  if (!bookingEnded(booking)) {
    return res.status(409).json({ error: "This booking is not complete yet", code: "NOT_COMPLETE" });
  }
  if (booking.reviewedBy[booking.ownerId === req.user.id ? "owner" : "renter"]) {
    return res.status(409).json({ error: "You have already rated this booking", code: "ALREADY_REVIEWED" });
  }
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "A rating is one to five stars" });
  }
  const isRenter = booking.renterId === req.user.id;
  const itemRating = isRenter ? Number(req.body?.itemRating) : null;
  if (isRenter && (!Number.isInteger(itemRating) || itemRating < 1 || itemRating > 5)) {
    return res.status(400).json({ error: "A rating is one to five stars" });
  }
  const updated = setReview(booking.id, req.user.id, { rating, itemRating, comment: text(req.body?.comment, REVIEW_MAX) });
  res.status(201).json({ booking: bookingFor(req.user, updated) });
});

// Everything that is this account's: what it has out for rent, who has asked
// for any of it, and what it has asked for itself.
app.get("/api/mine", requireSession, (req, res) => {
  res.json({
    spots: spotSummaries(req.user, req.user),
    items: getItemsByUser(req.user.id).map(publicItem),
    requests: getBookingsForOwner(req.user.id).map((booking) => bookingFor(req.user, booking)),
    bookings: getBookingsByRenter(req.user.id).map((booking) => bookingFor(req.user, booking)),
    // What it is looking for ("I need") — the ones whose dates have gone too,
    // which the map no longer shows: here is where they are taken down.
    wanted: getRequestsByUser(req.user.id).map((request) => requestFor(req.user, request)),
  });
});

/* ---------------------------------------------------------------- bookmarks */

// The items the signed-in account has kept to come back to (see db.js): the
// list, and one item put on it or taken off — { on }.
app.get("/api/bookmarks", requireSession, (req, res) => {
  res.json({ items: getBookmarkedItems(req.user.id).filter((item) => mayView(req.user, item)).map(publicItem) });
});

app.put("/api/items/:id/bookmark", requireSession, (req, res) => {
  const item = getItem(req.params.id);
  if (!item) return res.status(404).json({ error: "No such item", code: "ITEM_NOT_FOUND" });
  const on = req.body?.on !== false;
  // An account's own items are on /mine: they are not kept here as well.
  if (on && item.ownerId === req.user.id) {
    return res.status(400).json({ error: "This item is your own", code: "OWN_ITEM" });
  }
  if (!setBookmark(req.user.id, item.id, on)) {
    return res.status(409).json({ error: "That is as many bookmarks as an account keeps", code: "BOOKMARKS_FULL" });
  }
  res.json({ bookmarked: on });
});

/* ---------------------------------------------------------------- locations */

// The signed-in account's own places (see db.js), for putting an item at one
// without finding the spot again.
const LOCATION_NAME_MAX = 60;
const LOCATION_ID_RE = /^[a-z0-9-]{1,40}$/;

// The spots of the public account's items from before they were kept: each
// one that is not among its places yet is added, when the server starts.
rememberPublicPlaces(getItemsByUser(PUBLIC_ID).map((item) => ({ ...item, located: item.latitude != null })));

// The public account has places too (`shared`): the ones somebody else's
// things are at — a shop, a hall — kept in its folder like any account's, for
// anybody signed in to put such a thing at. They are every spot such a thing
// has been put at: saving somebody else's item with a spot adds the spot (see
// rememberPublicPlace). One sent here is added too, and none is changed: one
// sent under an id is given an id of its own all the same.
const sharedPlaces = (req) => req.query.shared === "1" || req.body?.shared === true;

/* ---------------------------------------------------------------- requests */

// What somebody is looking for ("I need"): what it is, where, between which
// dates, what they would pay, and how they are reached. A spot is needed —
// the request stands on the map there.
const REQUEST_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// A few photographs of the kind of thing wanted: fewer than an item has.
const REQUEST_IMAGES_MAX = 6;
function parseRequest(body) {
  const title = text(body?.title, TITLE_MAX).trim();
  if (!title) return { error: "Say what you are looking for", code: "TITLE_REQUIRED" };
  // A spot on the map is its maker's to add or not; one without is found by
  // the area it is asked in, which it then has to have.
  const latitude = parseNumber(body?.latitude, -90, 90);
  const longitude = parseNumber(body?.longitude, -180, 180);
  const located = latitude !== null && longitude !== null;
  const region = parseRegion(body?.region);
  if (!located && !region) return { error: "Say where you need it", code: "PLACE_REQUIRED" };
  const day = (value) => (REQUEST_DAY_RE.test(String(value ?? "")) ? String(value) : null);
  let start = day(body?.start);
  let end = day(body?.end);
  if (start && end && end < start) [start, end] = [end, start];
  const currency = CURRENCIES.has(String(body?.currency ?? "")) ? String(body.currency) : "JPY";
  // What they would pay, which may be left unsaid; and what it is for.
  const budget = readDeposit(body?.budget, currency);
  // Asked without a name: nobody else is told whose it is. A message here on
  // rab is still one of its ways: it is written to the request, not the name
  // (see messageTarget).
  const images = parseImages(body?.images ?? []);
  if (!images || images.length > REQUEST_IMAGES_MAX) return { error: "Those photos could not be used", code: "IMAGES_INVALID" };
  const anonymous = body?.anonymous === true;
  // Reached the way its account is — the tick in its form — it writes no
  // ways of its own: the account's, as they are, are what it shows.
  const followContacts = body?.followContacts === true;
  const contacts = followContacts ? [] : readContacts(body?.contacts);
  if (!followContacts && contacts.length === 0) return { error: "Say how you can be contacted", code: "CONTACT_REQUIRED" };
  return {
    request: {
      title,
      images,
      // The area it is asked in: whoever is looking there is shown it, as
      // with an item's. Left out where none was picked.
      region,
      anonymous,
      description: text(body?.description, DESCRIPTION_MAX).trim(),
      category: CATEGORY_RE.test(String(body?.category ?? "")) ? String(body.category) : "other",
      located,
      latitude: located ? latitude : null,
      longitude: located ? longitude : null,
      place: located ? text(body?.place, PLACE_MAX).trim() || null : null,
      start,
      end,
      budget,
      currency,
      followContacts,
      contacts,
    },
  };
}

// A request as one reader is given it: whose it is left out of an anonymous
// one, for everybody — its maker too, who is shown it as everybody else is,
// and the admin — and `mine` said to its maker, who cannot tell by the name
// where there is none.
function requestFor(viewer, request) {
  const mine = Boolean(viewer && request.owner === viewer.username);
  if (!request.anonymous) return { ...request, mine };
  const { owner: _owner, ...rest } = request;
  return { ...rest, mine };
}

// Every request still wanted: few enough to send whole, and the map keeps the
// ones near it.
app.get("/api/requests", (req, res) => {
  res.json({ requests: getRequests().filter((request) => mayView(req.user, request)).map((request) => requestFor(req.user, request)) });
});

app.get("/api/requests/:id", (req, res) => {
  const request = getRequest(req.params.id);
  if (!request) return res.status(404).json({ error: "No such request", code: "REQUEST_NOT_FOUND" });
  if (!mayView(req.user, request)) return res.status(403).json(AGE_FAULT);
  res.json({ request: requestFor(req.user, request) });
});

app.post("/api/requests", requireSession, (req, res) => {
  const parsed = parseRequest(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error, code: parsed.code });
  if (isAdultCategory(parsed.request.category) && !isAdult(req.user.id)) return res.status(403).json(AGE_FAULT);
  const request = createRequest(req.user.id, parsed.request);
  if (!request) return res.status(409).json({ error: "That is as many requests as an account keeps", code: "REQUESTS_FULL" });
  // Its photographs are taken from the uploads into its own folder, beside it.
  keepRequestImages(req.user.id, request.id, requestImageNames(request.id));
  res.status(201).json({ request: requestFor(req.user, request) });
});

// Changed by whoever made it: the whole of it is sent again, as it is to be.
app.put("/api/requests/:id", requireSession, (req, res) => {
  const parsed = parseRequest(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error, code: parsed.code });
  if (isAdultCategory(parsed.request.category) && !isAdult(req.user.id)) return res.status(403).json(AGE_FAULT);
  const request = updateRequest(req.user.id, req.params.id, parsed.request);
  if (!request) return res.status(404).json({ error: "No such request", code: "REQUEST_NOT_FOUND" });
  // Photographs added are taken into its folder, and ones dropped removed.
  keepRequestImages(req.user.id, request.id, requestImageNames(request.id));
  res.json({ request: requestFor(req.user, request) });
});

// Taken down by whoever made it — or by the admin.
app.delete("/api/requests/:id", requireSession, (req, res) => {
  if (!deleteRequest(req.user.id, req.params.id, { any: req.user.id === ADMIN_ID })) {
    return res.status(404).json({ error: "No such request", code: "REQUEST_NOT_FOUND" });
  }
  res.json({ ok: true });
});

app.get("/api/locations", requireSession, (req, res) => {
  res.json({ locations: getLocations(sharedPlaces(req) ? PUBLIC_ID : req.user.id) });
});

app.post("/api/locations", requireSession, (req, res) => {
  const name = text(req.body?.name, LOCATION_NAME_MAX);
  if (!name) return res.status(400).json({ error: "A location needs a name" });
  const latitude = parseNumber(req.body?.latitude, -90, 90);
  const longitude = parseNumber(req.body?.longitude, -180, 180);
  if (latitude === null || longitude === null) return res.status(400).json({ error: "A location needs a spot on the map" });
  const shared = sharedPlaces(req);
  const id = shared || req.body?.id == null ? null : String(req.body.id).toLowerCase();
  if (id !== null && !LOCATION_ID_RE.test(id)) return res.status(400).json({ error: "Invalid location id" });
  const location = saveLocation(shared ? PUBLIC_ID : req.user.id, {
    id,
    name,
    address: text(req.body?.address, PLACE_MAX),
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
    region: parseRegion(req.body?.region),
  });
  if (!location) return res.status(409).json({ error: "That is as many locations as an account keeps", code: "LOCATIONS_FULL" });
  res.status(201).json({ location });
});

app.delete("/api/locations/:id", requireSession, (req, res) => {
  if (!deleteLocation(req.user.id, String(req.params.id).toLowerCase())) {
    return res.status(404).json({ error: "No such location" });
  }
  res.status(204).end();
});

/* ----------------------------------------------------------------- messages */

app.get("/api/unread", requireSession, (req, res) => {
  res.json({ unread: countUnread(req.user.id) });
});

app.get("/api/messages", requireSession, (req, res) => {
  res.json({ conversations: getThreads(req.user.id), unread: countUnread(req.user.id) });
});

// Who an exchange is with, from how it is addressed: a name; or, for one about
// a request asked without a name, "~<request>" — to its maker, who is never
// named to the one writing — and "<name>~<request>" for the maker's way back
// to somebody who wrote. `via` is that request, `anonId` the end of it that
// is not named, and `handle` the address as it is given back.
function messageTarget(req, res) {
  const handle = normalizeUsername(req.params.username);
  const cut = handle.indexOf("~");
  // By the request's id as it is now: one addressed by an id from before ids
  // were times is the same exchange.
  const via = cut === -1 ? null : requestIdNow(handle.slice(cut + 1));
  const name = cut === -1 ? handle : handle.slice(0, cut);
  let target = null;
  if (via === null) {
    target = getUser(name);
  } else if (!name) {
    // What has been said already says whose it is, and outlives the request.
    const request = getRequest(via);
    target = getUserById(anonymousPeer(req.user.id, via)) ?? (request?.anonymous ? getUser(request.owner) : null);
  } else {
    // Only somebody who has written may be answered.
    const writer = getUser(name);
    target = writer && answeredBy(req.user.id, writer.id, via) ? writer : null;
  }
  if (!target) {
    res.status(404).json({ error: "No such user" });
    return null;
  }
  if (target.id === req.user.id) {
    res.status(400).json({ error: "You cannot message yourself" });
    return null;
  }
  return { target, via, handle, anonId: via === null ? null : name ? req.user.id : target.id };
}

// One exchange, oldest first — and asking for it is what marks it read. The
// open sheet repeats this every few seconds, so a line that arrives in front of
// a reader is read by the same request that brought it.
app.get("/api/messages/:username", requireSession, (req, res) => {
  const to = messageTarget(req, res);
  if (!to) return;
  const { target, via } = to;
  readConversation(req.user.id, target.id, via);
  res.json({
    // The address again rather than the name, which one of them hides.
    user: { username: via ? to.handle : target.username },
    messages: getConversation(req.user.id, target.id, undefined, via),
    unread: countUnread(req.user.id),
  });
});

app.post("/api/messages/:username", requireSession, (req, res) => {
  const to = messageTarget(req, res);
  if (!to) return;
  const { target, via, anonId } = to;
  const body = String(req.body?.body ?? "").trim().normalize("NFC");
  if (!body) return res.status(400).json({ error: "Write something" });
  if (body.length > MESSAGE_MAX) {
    return res.status(400).json({ error: `A message is at most ${MESSAGE_MAX} characters` });
  }
  // Written from a request — its page, or its sheet over the map — to whoever
  // asked: the exchange first says which request, as a line that leads to its
  // page, once, ahead of what is said about it.
  const about = req.body?.requestId ? getRequestHeld(String(req.body.requestId)) : null;
  const before =
    about && about.ownerId === target.id && !saidOfRequest(req.user.id, target.id, via, about.id)
      ? createMessage(req.user.id, target.id, "", { kind: "wanted", requestId: about.id, via, anonId })
      : null;
  res.status(201).json({ before, message: createMessage(req.user.id, target.id, body, { via, anonId }) });
});

app.delete("/api/messages/:username", requireSession, (req, res) => {
  const to = messageTarget(req, res);
  if (!to) return;
  deleteConversation(req.user.id, to.target.id, to.via);
  res.status(204).end();
});

/* ------------------------------------------------------------------- images */

// The browser compresses to WebP before it sends, which keeps the wire free of
// an 8 MB phone photo; whatever arrives as something else is made WebP as it
// is stored (see images.js).
// What a photograph is of, for a form that wants filling in: its category,
// a name and a description (see describe.js). Asked by the phone as
// soon as a photo is taken. Nothing is kept: the picture is looked at and gone.
app.post(
  "/api/describe",
  requireSession,
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  async (req, res) => {
    if (!canDescribe()) {
      return res.status(503).json({ error: "This server has no key to describe photos with", code: "DESCRIBE_UNAVAILABLE" });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "The image is empty" });
    }
    try {
      const language = String(req.query.lang ?? "en").slice(0, 2);
      // `objects=1`: the photograph is of an object — the phone's scanner
      // took it — so only the object categories are chosen among, and its
      // short category comes back too, as `what` (see describeObject).
      const listing = req.query.objects === "1" ? await describeObject(req.body) : await describeImage(req.body, language);
      if (!listing) return res.status(422).json({ error: "The photo could not be described", code: "DESCRIBE_FAILED" });
      res.json({
        ...listing,
        title: listing.title.slice(0, TITLE_MAX),
        ...("what" in listing && { what: listing.what.slice(0, WHAT_MAX) }),
        ...(listing.translations && { translations: readTranslations(listing.translations) }),
      });
    } catch (error) {
      describeFault(error, res, "describing a photo");
    }
  },
);

// What went wrong asking the model, said to the form (see describe.js) —
// most specific first: what the caller can do about it differs.
function describeFault(error, res, doing) {
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    console.error("rab: the OpenAI key was refused:", error.message);
    return res.status(503).json({ error: "This server's key to describe photos with was refused", code: "DESCRIBE_UNAVAILABLE" });
  }
  if (error instanceof OpenAI.RateLimitError) {
    return res.status(429).json({ error: "Too many at once. Try again in a moment", code: "DESCRIBE_BUSY" });
  }
  if (error instanceof OpenAI.NotFoundError) {
    // The model named in RAB_DESCRIBE_MODEL is not one this key can use.
    console.error("rab: the model to describe photos with was not found:", error.message);
    return res.status(503).json({ error: "This server's model to describe photos with was not found", code: "DESCRIBE_UNAVAILABLE" });
  }
  if (error instanceof OpenAI.BadRequestError) {
    return res.status(422).json({ error: "It could not be described", code: "DESCRIBE_FAILED" });
  }
  console.error(`rab: ${doing} failed:`, error instanceof OpenAI.APIError ? `${error.status} ${error.message}` : error);
  res.status(502).json({ error: "It could not be described just now", code: "DESCRIBE_FAILED" });
}

// Which category a listing is in, for the button beside it on the form: from
// its name, its few words for what it is, its description and its main
// photograph — sent as the name of a photo this server stored (see
// classifyListing). Nothing is kept.
app.post("/api/classify", requireSession, async (req, res) => {
  if (!canDescribe()) {
    return res.status(503).json({ error: "This server has no key to describe photos with", code: "DESCRIBE_UNAVAILABLE" });
  }
  const name = String(req.body?.image ?? "").split("/").pop();
  const file = name ? imageFile(name) : null;
  try {
    const category = await classifyListing({
      title: text(req.body?.title, TITLE_MAX),
      what: text(req.body?.what, WHAT_MAX),
      description: text(req.body?.description, DESCRIPTION_MAX),
      image: file ? await fs.promises.readFile(file.path) : null,
    });
    if (!category) return res.status(422).json({ error: "Write a name or add a photo first", code: "DESCRIBE_FAILED" });
    res.json({ category });
  } catch (error) {
    describeFault(error, res, "classifying a listing");
  }
});

// A request's category and a few lines for it, from the words typed for what
// is wanted: the brain beside them on the form (see describeRequest). Nothing
// is kept.
app.post("/api/describe-request", requireSession, async (req, res) => {
  if (!canDescribe()) {
    return res.status(503).json({ error: "This server has no key to describe photos with", code: "DESCRIBE_UNAVAILABLE" });
  }
  try {
    const answer = await describeRequest(text(req.body?.title, TITLE_MAX).trim(), String(req.body?.lang ?? "en").slice(0, 2));
    if (!answer) return res.status(422).json({ error: "Say what you are looking for first", code: "DESCRIBE_FAILED" });
    // One the reader is not old enough for is not chosen for them.
    if (isAdultCategory(answer.category) && !isAdult(req.user.id)) answer.category = "other";
    res.json({ ...answer, description: answer.description.slice(0, DESCRIPTION_MAX) });
  } catch (error) {
    describeFault(error, res, "describing a request");
  }
});

app.post(
  "/api/images",
  requireSession,
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  async (req, res, next) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "The image is empty" });
    }
    try {
      const stored = await spotImage(req.user.id, req.body);
      if (!stored) return res.status(415).json({ error: "Unsupported image format" });
      res.json(stored);
    } catch (error) {
      next(error);
    }
  },
);

/* ------------------------------------------------------------ public folder */

// A public folder — data/users/_public/ as another server has it, or as a
// crawler left it — sent by whoever looks after the site a piece at a time,
// and merged into this one's. GET says what is held already, so that only
// what is not is sent (rab push does that); each POST is one zip with one
// item in it, or the places (locations.json), or both, merged into the public
// account's (see upload.js and mergePublic in db.js), the spot of the item
// among its places as well. What comes back is what was added, put in the
// stead of what was there, and passed over.
const PUBLIC_ZIP_MAX = 100 * 1024 * 1024;
// How many items rab public pull may ask for in one zip. What push sends is
// held only by its size (PUBLIC_ZIP_MAX): as many items as fit.
const PUBLIC_ZIP_ITEMS = 2000;

function requireAdmin(req, res, next) {
  if (req.user.id !== ADMIN_ID) return res.status(403).json({ error: "Only the site's own account sends a public folder" });
  next();
}

app.get("/api/public", requireSession, requireAdmin, (req, res) => {
  res.json(heldPublic());
});

app.post(
  "/api/public",
  requireSession,
  requireAdmin,
  express.raw({ type: () => true, limit: PUBLIC_ZIP_MAX }),
  (req, res, next) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "The zip is empty" });
    }
    const sent = readPublicZip(req.body);
    if (sent.error) return res.status(400).json({ error: sent.error });
    try {
      const merged = mergePublic(sent);
      const kept = [];
      for (const id of [...merged.items.added, ...merged.items.replaced]) {
        const names = getItemImages(id).flatMap((image) => [image.name, image.thumb]);
        // One that came deleted is kept as it came, and is nowhere to be put.
        const item = getItem(id);
        if (isSpotFolder(PUBLIC_ID, id)) keepSpotImages(PUBLIC_ID, id, names);
        else keepImages(PUBLIC_ID, id, names);
        if (item) kept.push(item);
      }
      // The places read once for the whole zip, not once for each item in it.
      rememberPublicPlaces(kept);
      res.json(merged);
    } catch (error) {
      next(error);
    }
  },
);

// The other way round, for rab pull: the places whole, and one item's folder
// as a zip — item.json, source.json and its photographs, as POST takes them.
app.get("/api/public/locations", requireSession, requireAdmin, (req, res) => {
  res.json(publicLocations());
});

// One item's folder as zip entries: a spot's as spots/<id>/, with its
// spot.json; an item's as items/<id>/. The photographs stored as they are.
function publicItemFiles(id, files) {
  const dir = heldDir(PUBLIC_ID, id);
  const under = path.basename(path.dirname(dir));
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const bytes = fs.readFileSync(path.join(dir, entry.name));
    files[`${under}/${id}/${entry.name}`] = entry.name.endsWith(".json") ? bytes : [bytes, { level: 0 }];
  }
  return files;
}

app.get("/api/public/items/:id", requireSession, requireAdmin, async (req, res, next) => {
  if (!holdsPublic(req.params.id)) return res.status(404).json({ error: "_public has no such item" });
  try {
    const { zipSync } = await import("fflate");
    res.type("application/zip").send(Buffer.from(zipSync(publicItemFiles(req.params.id, {}))));
  } catch (error) {
    next(error);
  }
});

// Several at once, for rab public pull: a JSON list of ids, sent as
// text/plain, and one zip back with each folder in it as above. An id _public
// does not hold is left out.
app.post(
  "/api/public/items",
  requireSession,
  requireAdmin,
  express.text({ type: "text/plain", limit: "1mb" }),
  async (req, res, next) => {
    let ids;
    try {
      ids = JSON.parse(req.body);
    } catch {
      ids = null;
    }
    if (!Array.isArray(ids)) return res.status(400).json({ error: "Send a list of ids as JSON" });
    if (ids.length > PUBLIC_ZIP_ITEMS) {
      return res.status(400).json({ error: `Ask for at most ${PUBLIC_ZIP_ITEMS} at a time` });
    }
    try {
      const { zipSync } = await import("fflate");
      const files = {};
      for (const id of ids.map(String)) if (holdsPublic(id)) publicItemFiles(id, files);
      res.type("application/zip").send(Buffer.from(zipSync(files)));
    } catch (error) {
      next(error);
    }
  },
);

// And for rab mirror, what the source it is mirrored from does not have,
// taken away outright: an item's folder, the open bookings on it cancelled
// first as when any item is deleted; a place off the list.
app.delete("/api/public/items/:id", requireSession, requireAdmin, (req, res) => {
  const live = getItem(req.params.id);
  if (live && live.ownerId === PUBLIC_ID) removeItem(live);
  if (!purgePublicItem(req.params.id)) return res.status(404).json({ error: "_public has no such item" });
  res.status(204).end();
});

app.delete("/api/public/locations/:id", requireSession, requireAdmin, (req, res) => {
  if (!deleteLocation(PUBLIC_ID, req.params.id)) return res.status(404).json({ error: "_public has no such place" });
  res.status(204).end();
});

// All of what rab mirror deletes in one request: { items: [ids], locations:
// [ids] }, as JSON sent as text/plain — a mirror's list of ids can be longer
// than express.json's limit for everything else. Each item as DELETE
// /api/public/items/:id does it; the places off the list in one write. What
// comes back is how many went, and the ids that were not there to delete.
app.post(
  "/api/public/delete",
  requireSession,
  requireAdmin,
  express.text({ type: "text/plain", limit: "32mb" }),
  (req, res, next) => {
    let asked;
    try {
      asked = JSON.parse(req.body);
    } catch {
      return res.status(400).json({ error: "Send { items, locations } as JSON" });
    }
    const ids = (list) => (Array.isArray(list) ? list.map(String) : []);
    try {
      const items = { deleted: 0, missing: [] };
      for (const id of ids(asked?.items)) {
        const live = getItem(id);
        if (live && live.ownerId === PUBLIC_ID) removeItem(live);
        if (purgePublicItem(id)) items.deleted += 1;
        else items.missing.push(id);
      }
      res.json({ items, locations: purgePublicLocations(ids(asked?.locations)) });
    } catch (error) {
      next(error);
    }
  },
);

// Public, because what they are pictures of is: an item's page is the thing
// that gets shared, and a plain <img> has nowhere to put a session.
app.get("/api/images/:name", (req, res) => {
  const file = imageFile(req.params.name);
  if (!file) return res.status(404).json({ error: "No such image" });
  res.sendFile(file.path, {
    headers: {
      "Content-Type": file.type,
      // Content-addressed, so the bytes behind a name never change.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// The same picture at the size a pin on the map draws it (see pinImageFile).
app.get("/api/images/:name/pin", async (req, res, next) => {
  try {
    const file = await pinImageFile(req.params.name);
    if (!file) return res.status(404).json({ error: "No such image" });
    res.sendFile(file, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

/* -------------------------------------------------------------------- pages */

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// An item's page is what gets pasted into a chat, and a chat app reads the
// page's head rather than running it. So the one page with something to say
// about itself is served with it already said: the item's name, its price and
// its first photograph.
function sharePage(html, req, item, at = null) {
  const origin = `${req.protocol}://${req.get("host")}`;
  const title = `${item.title} — rab`;
  const price = item.price == null ? "" : `${item.price} ${item.currency}`;
  const description = [price, item.place, item.description]
    .filter(Boolean)
    .join(" · ")
    .replace(/\s+/g, " ")
    .slice(0, 200);
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(`${origin}${at ?? `/${item.spot ? "s" : "i"}/${item.id}`}`)}" />`,
    item.images[0] ? `<meta property="og:image" content="${escapeHtml(origin + item.images[0].src)}" />` : "",
    `<meta name="twitter:card" content="${item.images[0] ? "summary_large_image" : "summary"}" />`,
  ];
  return html.replace("<title>rab</title>", tags.filter(Boolean).join("\n    "));
}

if (isProduction) {
  const indexPath = path.join(dist, "index.html");
  app.use(express.static(dist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    // An item at /i/<id>, or a spot at /s/<id> —
    // or at its owner's /u/<name>/p/<id>, where it was before.
    const shared = /^\/[is]\/([a-z0-9]{1,32})\/?$/.exec(req.path) ?? /^\/u\/[^/]+\/p\/([a-z0-9]{1,32})\/?$/i.exec(req.path);
    const item = shared ? getItem(shared[1]) : null;
    // A request at /r/<id> says of itself what an item does: what is wanted,
    // what would be paid for it and where — except one only an adult may see.
    const asked = /^\/r\/([a-z0-9]{1,32})\/?$/.exec(req.path);
    const wanted = asked ? getRequest(asked[1]) : null;
    const said = item
      ? [item, null]
      : wanted && !isAdultCategory(wanted.category)
        ? [{ ...wanted, price: wanted.budget ?? null, images: wanted.images ?? [] }, `/r/${wanted.id}`]
        : null;
    if (!said) return res.sendFile(indexPath);
    fs.readFile(indexPath, "utf8", (error, html) => {
      if (error) return next(error);
      res.type("html").send(sharePage(html, req, ...said));
    });
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

app.use((error, req, res, _next) => {
  if (res.headersSent) return;
  if (error?.type === "entity.too.large") return res.status(413).json({ error: "File too large" });
  if (error?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request" });
  console.error(error);
  res.status(500).json({ error: "Server error" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`rab listening on:`);
  console.log(`  Local:   http://localhost:${port}`);
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (iface?.family === "IPv4" && !iface.internal) {
      console.log(`  Network: http://${iface.address}:${port}`);
    }
  }
  // The crawler's keys read in the background, for rab public push to be
  // answered at once (GET /api/public).
  warmPublicKeys().catch((error) => console.error(error));
});
