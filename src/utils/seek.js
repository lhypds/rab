// A search asked for from anywhere on the site, for the home page to make:
// the bar's "Ask AI" turns what somebody wants into a word to look for, and
// may be standing on a page that has no list to narrow. The words wait here
// until the home page has them — told at once where it is already standing
// (it is kept under an item's page), and read when it is next put up otherwise.
export const SEEK_EVENT = "rab:seek";

let waiting = "";

export function seek(words) {
  waiting = String(words ?? "").trim();
  window.dispatchEvent(new CustomEvent(SEEK_EVENT, { detail: waiting }));
}

// What is waiting to be looked for, if anything.
export const sought = () => waiting;

// Taken up: it is not looked for a second time.
export function forgetSought() {
  waiting = "";
}

// And the other way: what the home page lists as it stands — the rows of its
// list, narrowed as they are — for the bar's "Ask AI" to be able to choose
// one of them when asked to ("pick one for me"). Told by the page that lists
// (see MapView), read by the bar when something is asked.
// `where` is where the reader stands, as the page has it: { latitude,
// longitude, name, exact } — the place's name, and whether it is where the
// device says they are rather than somewhere they went to look at, or a
// stand-in for a position that is not to be had.
let listed = { items: [], narrowed: false, where: null };

export function setListed(items, narrowed = false, where = null) {
  listed = { items: items ?? [], narrowed, where };
}

export const listedNow = () => listed;
