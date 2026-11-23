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
    "3d-printer",
    "audio",
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
  space: ["home", "meeting-room", "studio", "storage", "event-space", "workspace", "parking", "other"],
  service: [
    "photography",
    "teaching",
    "repair",
    "moving",
    "cleaning",
    "design",
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
    "other",
  ],
};

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
