// What can be put out for rent, in three kinds — a thing, a space, somebody's
// time — and under each the sorts of it people most often have. The server
// keeps the slugs; the words for them are in the i18n files, under `kind.*`
// and `category.*`.
export const KINDS = ["item", "space", "service"];

export const CATEGORIES = {
  item: [
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
    "other",
  ],
  space: ["home", "meeting-room", "studio", "music-studio", "storage", "event-space", "workspace", "parking", "other"],
  service: [
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
  ],
};

// Categories only grown-ups are shown: an account that has said when it was
// born and is ADULT_AGE or older (see the account sheet). The server leaves
// them out of everything it sends anybody else, and the lists here leave them
// out of their choices — `adult` is whether whoever is looking may see them.
export const ADULT_CATEGORIES = ["adult"];
export const ADULT_AGE = 18;

export const isAdultCategory = (slug) => ADULT_CATEGORIES.includes(slug);

// A kind's categories, without the grown-up ones unless `adult`.
export function categoriesFor(kind, adult = false) {
  return (CATEGORIES[kind] ?? []).filter((slug) => adult || !isAdultCategory(slug));
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
// pin's card: its category when it has one, and only otherwise its kind.
// "Other" alone says nothing, so it says which kind's it is: "Other (Things)".
export function sortLabel(item, t) {
  const kind = t(`kind.${item.kind}`);
  if (!item.category) return kind;
  const name = t(`category.${item.category}`, item.category);
  return item.category === "other" ? t("item.categoryWithin", { name, kind }) : name;
}

// What the home page's address calls each kind, and "all" where a category is
// chosen with no kind: /things, /things/camera, /all/other. The address is
// what gets sent to somebody, so it says what the page is narrowed to.
const KIND_PATHS = { item: "things", space: "spaces", service: "services" };

// The one kind a category belongs to, or null where it is in more than one
// ("other" is in all three) or in none.
function onlyKindOf(slug) {
  const kinds = KINDS.filter((kind) => CATEGORIES[kind].includes(slug));
  return kinds.length === 1 ? kinds[0] : null;
}

// The home page's address for a kind (null for all) and a category ("" for
// all of them). A category chosen with no kind chooses the kind it belongs
// to as well: /things/camera, and /all/other only for the one every kind has.
export function homePath(kind, category) {
  const head = KIND_PATHS[kind ?? onlyKindOf(category)];
  if (category) return `/${head ?? "all"}/${category}`;
  return head ? `/${head}` : "/";
}

// What such an address narrows the home page to — { kind, category } — or
// null where the path is not one of the home page's: a category the kind does
// not have is no address at all.
export function homeFilter(pathname) {
  const [head, slug = "", ...more] = pathname.replace(/^\/|\/$/g, "").split("/");
  if (more.length > 0) return null;
  if (!head) return { kind: null, category: "" };
  const kind = KINDS.find((each) => KIND_PATHS[each] === head) ?? null;
  if (!kind && (head !== "all" || !slug)) return null;
  if (slug && !(kind ? [kind] : KINDS).some((each) => CATEGORIES[each].includes(slug))) return null;
  return { kind: kind ?? onlyKindOf(slug), category: slug };
}
