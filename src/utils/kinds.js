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
