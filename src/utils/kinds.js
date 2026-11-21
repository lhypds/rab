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
    "projector",
    "3d-printer",
    "audio",
    "electronics",
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
