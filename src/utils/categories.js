// What can be put out for rent: every listing is an item, and an item has one
// of these categories — a thing, a place or somebody's time alike. "other" is
// last: it is what is picked when nothing above it fits. The server keeps the
// slugs; the words for them are in the i18n files, under `category.*`.
export const CATEGORIES = [
  "car",
  "bike",
  "camera",
  "video-camera",
  "drone",
  "binoculars",
  "projector",
  "audio",
  "musical-instrument",
  "computer",
  "game-console",
  "electronics",
  "kitchen-appliance",
  "cleaning-appliance",
  "beauty-appliance",
  "tools",
  "camping",
  "sports",
  "clothing",
  "home",
  "meeting-room",
  "studio",
  "music-studio",
  "storage",
  "event-space",
  "workspace",
  "parking",
  "photography",
  "teaching",
  "repair",
  "moving",
  "cleaning",
  "design",
  "3d-printing",
  "guide",
  "translation",
  "music",
  "fitness",
  "beauty",
  "massage",
  "pet-care",
  "childcare",
  "care",
  "cooking",
  "driver",
  "delivery",
  "gardening",
  "it-support",
  "programming",
  "videography",
  "writing",
  "consulting",
  "event-help",
  "handyman",
  "adult",
  "other",
];

// Categories only grown-ups are shown: an account that has said when it was
// born and is ADULT_AGE or older (see the account sheet). The server leaves
// them out of everything it sends anybody else, and the lists here leave them
// out of their choices — `adult` is whether whoever is looking may see them.
export const ADULT_CATEGORIES = ["adult"];
export const ADULT_AGE = 18;

export const isAdultCategory = (slug) => ADULT_CATEGORIES.includes(slug);

// The categories, without the grown-up ones unless `adult`.
export function categoriesFor(adult = false) {
  return CATEGORIES.filter((slug) => adult || !isAdultCategory(slug));
}

// How old somebody born on `birthdate` ("YYYY-MM-DD") is on `today` (the same
// form), in whole years; null for a date that is not one.
export function ageOn(birthdate, today) {
  const born = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthdate ?? ""));
  const now = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today ?? ""));
  if (!born || !now) return null;
  const age = Number(now[1]) - Number(born[1]);
  return `${now[2]}${now[3]}` < `${born[2]}${born[3]}` ? age - 1 : age;
}

// What an item is called by where it is listed among others — in a row, in a
// pin's card: its category, or "Item" for one with none.
export function sortLabel(item, t) {
  if (item.category) return t(`category.${item.category}`, item.category);
  // A page with no category of its own is called what it is.
  return item.store ? t("store.one") : t("item.uncategorized");
}

// The home page's address for a category ("" for all of them): /, /c/camera.
// The address is what gets sent to somebody, so it says what the page is
// narrowed to.
export function homePath(category) {
  return category ? `/c/${category}` : "/";
}

// What the home page used to call its three kinds, before every listing was an
// item: an address from then still opens the map, on its category if it had
// one (/things/camera, /all/other).
const OLD_HEADS = ["things", "spaces", "services", "all"];

// What such an address narrows the home page to — { category, old } — or null
// where the path is not one of the home page's: a category there is not is no
// address at all. `old` is whether it is an address from before, to be
// replaced by its own.
export function homeFilter(pathname) {
  const [head, slug = "", ...more] = pathname.replace(/^\/|\/$/g, "").split("/");
  if (more.length > 0) return null;
  if (!head) return { category: "", old: false };
  if (head === "c") return slug && CATEGORIES.includes(slug) ? { category: slug, old: false } : null;
  if (!OLD_HEADS.includes(head) || (head === "all" && !slug)) return null;
  if (slug && !CATEGORIES.includes(slug)) return null;
  return { category: slug, old: true };
}
