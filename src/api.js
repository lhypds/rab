const tokenKey = "rab:session-token";

let sessionToken = "";
try {
  sessionToken = localStorage.getItem(tokenKey) || "";
} catch {
  // Storage is unavailable; the session lasts as long as the page does.
}

function keepSession(data) {
  if (!data?.token) return data;
  sessionToken = data.token;
  try {
    localStorage.setItem(tokenKey, sessionToken);
  } catch {
    // See above.
  }
  return data;
}

function dropSession() {
  sessionToken = "";
  try {
    localStorage.removeItem(tokenKey);
  } catch {
    // See above.
  }
}

export function authHeaders() {
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
}

export function hasSession() {
  return Boolean(sessionToken);
}

const REQUEST_TIMEOUT_MS = 30 * 1000;

async function request(path, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, signal: sourceSignal, ...fetchOptions } = options;
  const headers = {
    ...(typeof fetchOptions.body === "string" ? { "Content-Type": "application/json" } : null),
    ...fetchOptions.headers,
    ...authHeaders(),
  };
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(sourceSignal?.reason);
  if (sourceSignal?.aborted) abort();
  else sourceSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(path, { credentials: "omit", ...fetchOptions, headers, signal: controller.signal });
    if (response.status === 204) return null;
    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      data = {};
    }
    if (!response.ok) {
      if (response.status === 401 && data.code === "LOGIN_REQUIRED") dropSession();
      const error = new Error(data.error || "Request failed");
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  } catch (error) {
    if (!timedOut) throw error;
    const timeout = new Error("Request timed out");
    timeout.code = "REQUEST_TIMEOUT";
    throw timeout;
  } finally {
    clearTimeout(timer);
    sourceSignal?.removeEventListener("abort", abort);
  }
}

const send = (method, path, body, options) =>
  request(path, { method, ...(body === undefined ? null : { body: JSON.stringify(body) }), ...options });
const name = (username) => encodeURIComponent(username);

/* ------------------------------------------------------------------ account */

export const getSession = () => request("/api/session");
export const checkUsername = (username) => send("POST", "/api/username", { username });
export const login = (username, password) => send("POST", "/api/login", { username, password }).then(keepSession);
// What opening an account takes on this server: { email } — whether it asks
// for an address and a code mailed there.
export const signupRules = () => request("/api/signup");
// Opening an account, in two goes where it does: a code is mailed to the address, and the
// account is made when the code comes back with the rest.
export const sendSignupCode = (username, password, email, lang) =>
  send("POST", "/api/users/code", { username, password, email, lang });
export const createUser = (username, password, email, code) =>
  send("POST", "/api/users", { username, password, email, code }).then(keepSession);
export const logout = () => send("POST", "/api/logout").finally(dropSession);
export const getUser = (username) => request(`/api/users/${name(username)}`);
export const getMine = () => request("/api/mine");
// The stores somebody made of their items — what the site shows as pages: a
// store of things, a page of spaces, their services. A store is an item
// (made, read, changed and deleted as one, with `store: true`); what is its
// own is which of the account's items are on it.
export const addToStore = (id, itemId) => send("POST", `/api/stores/${name(id)}/items`, { itemId });
export const setStoreItems = (id, itemIds) => send("PUT", `/api/stores/${name(id)}/items`, { itemIds });
// The pages a new item can go on: the account's own, its default first — or,
// with `shared`, somebody else's (the public account's) found by `q`.
export const getStoreChoices = ({ shared = false, q = "" } = {}) =>
  request(`/api/stores/choices${shared ? `?shared=1&q=${encodeURIComponent(q)}` : ""}`);
// The account's own address — { email, verify } — apart from the ways it says
// it is reached: `verify` is whether a new one is proved by a code mailed to
// it, which is then asked for first and sent back with the address.
export const getAccount = () => request("/api/account");
export const sendEmailCode = (email, lang) => send("POST", "/api/account/email/code", { email, lang });
export const setAccountEmail = (email, code) => send("PUT", "/api/account/email", { email, code });
export const setBirthdate = (birthdate) => send("PUT", "/api/account/birthdate", { birthdate });

/* ----------------------------------------------------------------- requests */

// What people are looking for ("I need"), rather than offering.
export const getRequests = (options) => request("/api/requests", options);
export const getRequest = (id, options) => request(`/api/requests/${name(id)}`, options);
export const createRequest = (wanted) => send("POST", "/api/requests", wanted);
export const updateRequest = (id, wanted) => send("PUT", `/api/requests/${name(id)}`, wanted);
export const deleteRequest = (id) => send("DELETE", `/api/requests/${name(id)}`);

/* -------------------------------------------------------------------- items */

export const getItems = ({ south, north, west, east }, options) =>
  request(`/api/items?south=${south}&north=${north}&west=${west}&east=${east}`, options);
// `bbox` is the area the spot is in, as [west, south, east, north], where known.
export const getItemsAt = ({ latitude, longitude }, bbox, options) =>
  request(
    `/api/items/at?latitude=${latitude}&longitude=${longitude}${
      bbox ? `&west=${bbox[0]}&south=${bbox[1]}&east=${bbox[2]}&north=${bbox[3]}` : ""
    }`,
    options,
  );
export const searchItems = (query, options) => request(`/api/search?q=${encodeURIComponent(query)}`, options);
export const getItem = (id, options) => request(`/api/items/${name(id)}`, options);
export const createItem = (item) => send("POST", "/api/items", item);
export const updateItem = (id, item) => send("PATCH", `/api/items/${name(id)}`, item);
export const deleteItem = (id) => send("DELETE", `/api/items/${name(id)}`);
// The items the signed-in account has kept to come back to, and one of them
// kept (`on`) or let go of.
export const getBookmarks = () => request("/api/bookmarks");
export const setBookmark = (id, on) => send("PUT", `/api/items/${name(id)}/bookmark`, { on });
// What is sent to the administrator about an item, each a message in the
// sender's conversation with them: asking for one listed for somebody else to
// be deleted, and saying what is wrong with one (`reason` is the kind).
export const reportItem = (id, reason, note) => send("POST", `/api/items/${name(id)}/report`, { reason, note });
// What a photograph is of, as a listing would say it: { category, title,
// description }, in the language asked for (see server/describe.js). The
// model takes its time, so this waits longer than most.
export const describePhoto = (blob, lang) =>
  request(`/api/describe?lang=${encodeURIComponent(lang)}`, {
    method: "POST",
    body: blob,
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    timeoutMs: 90 * 1000,
  });
// Which category a listing is in, from what it says and its main photo (the
// address of one this server stored): { category } (see server/describe.js).
export const classifyItem = ({ title, what, description, image }) =>
  send("POST", "/api/classify", { title, what, description, image }, { timeoutMs: 90 * 1000 });
// A request filled in from the words typed for what is wanted:
// { category, description }, in the language asked for.
export const describeRequest = (title, lang) => send("POST", "/api/describe-request", { title, lang }, { timeoutMs: 90 * 1000 });
// The signed-in account's own places, to put an item at.
// `shared` asks for the public account's instead: the places somebody else's
// things are at, which anybody signed in may choose from and add to.
export const getLocations = ({ shared = false } = {}) => request(shared ? "/api/locations?shared=1" : "/api/locations");
export const saveLocation = (location) => send("POST", "/api/locations", location);
export const deleteLocation = (id) => send("DELETE", `/api/locations/${name(id)}`);
// How the signed-in account is reached, as it wrote it on its account's
// sheet: a phone number, an email address, an address.
export const getContacts = () => request("/api/contacts");
export const saveContacts = (contacts) => send("PUT", "/api/contacts", { contacts });
export const setDays = (id, change) => send("PUT", `/api/items/${name(id)}/days`, change);

/* ----------------------------------------------------------------- bookings */

export const requestBooking = (id, booking) => send("POST", `/api/items/${name(id)}/bookings`, booking);
export const setBookingStatus = (bookingId, status) => send("PATCH", `/api/bookings/${bookingId}`, { status });
// Asking the owner to call a booking off, with a word about why — and, from
// the owner, the no to that.
export const askToCancel = (bookingId, note) => send("PATCH", `/api/bookings/${bookingId}`, { cancelRequest: true, note });
export const refuseCancel = (bookingId) => send("PATCH", `/api/bookings/${bookingId}`, { cancelRequest: false });
// The complete bookings the reader has not rated the other side of yet, and
// the rating itself: one to five stars and a word about it.
export const getPendingReviews = () => request("/api/reviews/pending");
// `itemRating` is the item's own stars, from whoever rented it.
export const reviewBooking = (bookingId, rating, comment, itemRating) =>
  send("POST", `/api/bookings/${bookingId}/review`, { rating, comment, itemRating });

/* ----------------------------------------------------------------- messages */

export const getUnread = () => request("/api/unread");
export const getMessages = () => request("/api/messages");
export const getConversation = (username, options) => request(`/api/messages/${name(username)}`, options);
export const sendMessage = (username, body) => send("POST", `/api/messages/${name(username)}`, { body });
export const deleteConversation = (username) => send("DELETE", `/api/messages/${name(username)}`);
