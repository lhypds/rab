// One small drawing per category, kept in one place because each is drawn in
// several: in the head of a pin on the map, beside the category's name in the
// item form, and on the item's own page. A shape that has to read as the same
// thing in all of them is drawn once.
//
// Every drawing is on a 24-unit grid, as hairlines with no fill, and is made of
// parts: a string is a path, and [cx, cy, r] is a circle. They are drawn plain
// on purpose — in a pin's head one of these is about ten pixels across, where a
// detail is a smudge and a silhouette is all that is read.
const ICONS = {
  /* ------------------------------------------------------------- things */
  car: ["M3 11h18v6H3z", "M6 11l2-5h8l2 5", [7.5, 17.5, 1.8], [16.5, 17.5, 1.8]],
  bike: [[6, 16, 3.5], [18, 16, 3.5], "M6 16l4-8h5l3 8", "M10 8l4 8"],
  camera: ["M3 8h4l2-3h6l2 3h4v11H3z", [12, 13, 3.5]],
  "video-camera": ["M3 7h12v10H3z", "M15 11l6-3v8l-6-3"],
  projector: ["M3 9h18v8H3z", [8, 13, 2.5], "M14 13h4", "M6 17v2.5", "M18 17v2.5"],
  "3d-printer": ["M4 4h16v16H4z", "M4 8h16", "M12 8v4", "M9 16h6"],
  audio: ["M6 3h12v18H6z", [12, 15, 3], [12, 7.5, 1]],
  electronics: ["M7 7h10v10H7z", "M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"],
  tools: ["M14 4l6 6-3 3-6-6z", "M12.5 8.5 4 17l3 3 8.5-8.5"],
  camping: ["M12 4 2 20h20z", "M12 11l-4 9M12 11l4 9"],
  sports: [[12, 12, 9], "M3 12h18", "M12 3c4 3 4 15 0 18M12 3c-4 3-4 15 0 18"],
  clothing: ["M8 3 2 7l3 4 2-1v11h10V10l2 1 3-4-6-4c-1 2-7 2-8 0z"],
  /* ------------------------------------------------------------- spaces */
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10", "M10 20v-6h4v6"],
  "meeting-room": ["M3 10h18v3H3z", "M6 13v7M18 13v7", "M9 6h6"],
  studio: ["M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z", "M5 11a7 7 0 0 0 14 0", "M12 18v3"],
  storage: ["M3 4h18v5H3z", "M5 9v11h14V9", "M10 13h4"],
  "event-space": ["M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8z"],
  workspace: ["M4 5h16v10H4z", "M12 15v4", "M8 19h8"],
  parking: ["M4 4h16v16H4z", "M10 17V8h3a2.5 2.5 0 0 1 0 5h-3"],
  /* ----------------------------------------------------------- services */
  photography: ["M5 3h14v18H5z", [12, 10, 2.5], "M8 18a4 4 0 0 1 8 0"],
  teaching: ["M2 9l10-5 10 5-10 5z", "M6 11.5V16c3 3 9 3 12 0v-4.5", "M22 9v6"],
  repair: ["M15 4a5 5 0 0 0-4.6 6.9L4 17.3 6.7 20l6.4-6.4A5 5 0 0 0 20 9l-3 3-3-1-1-3 3-3z"],
  moving: ["M2 6h11v10H2z", "M13 10h5l3 3v3h-8z", [6, 17.5, 2], [17, 17.5, 2]],
  cleaning: ["M12 3v9", "M7 12h10l2 9H5z", "M9 16v5M12 16v5M15 16v5"],
  design: ["M4 20l1-5L16 4l4 4L9 19z", "M14 6l4 4"],
  guide: [[12, 12, 9], "M15.5 8.5l-2 5-5 2 2-5z"],
  translation: ["M3 6h10", "M8 4v2", "M5 6c0 3 3 6 6 7", "M11 6c0 3-3 6-7 7", "M13 20l4-9 4 9", "M14.5 17h5"],
  music: ["M9 18V5l11-2v13", [6.5, 18, 2.5], [17.5, 16, 2.5]],
  fitness: ["M2 9v6", "M5 6v12", "M19 6v12", "M22 9v6", "M5 12h14"],
  beauty: [[6, 6, 3], [6, 18, 3], "M8.5 8 20 19", "M8.5 16 20 5"],
  massage: [[5, 9.5, 2], "M8 12h13", "M3 15h18", "M6 15v5", "M18 15v5"],
  "pet-care": [[6, 10, 1.8], [10, 6, 1.8], [14, 6, 1.8], [18, 10, 1.8], "M8 17c0-3 2-5 4-5s4 2 4 5c0 2-2 2-4 2s-4 0-4-2z"],
  childcare: ["M3 5h2l3 9h10", "M7 9h13a6 6 0 0 1-6 5", [9, 18, 1.8], [17, 18, 1.8]],
  care: ["M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"],
  cooking: ["M4 10h16v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z", "M2 10h20", "M9 6V4", "M15 6V4"],
  driver: [[12, 12, 9], [12, 12, 2.5], "M3.5 10h17", "M12 14.5V21"],
  delivery: ["M3 8l9-4 9 4v9l-9 4-9-4z", "M3 8l9 4 9-4", "M12 12v9", "M7.5 6l9 4"],
  gardening: ["M12 21v-9", "M12 12c0-4-3-6-7-6 0 4 3 6 7 6z", "M12 15c0-3 3-5 7-5 0 3-3 5-7 5z", "M8 21h8"],
  "it-support": ["M5 5h14v10H5z", "M2 19h20l-2-4H4z"],
  programming: ["M8 7l-5 5 5 5", "M16 7l5 5-5 5", "M14 4l-4 16"],
  videography: ["M3 9h18v11H3z", "M3 9l2-5 16 2-1 3", "M8 4.5l2 4.5", "M13 5.5l2 3.5"],
  writing: ["M6 3h9l4 4v14H6z", "M15 3v4h4", "M9 12h7", "M9 16h7"],
  consulting: ["M3 5h18v11H10l-5 4v-4H3z", "M8 9h8", "M8 12h5"],
  "event-help": ["M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z", "M10 20a2 2 0 0 0 4 0"],
  handyman: ["M4 4h10l4 4H4z", "M9 8h3v13H9z"],
};

// What stands in for a category nobody chose, or the one called "other": the
// kind itself — a box for a thing, a doorway for a space, people for a
// service.
const KIND_ICONS = {
  item: ["M3 8l9-5 9 5v8l-9 5-9-5z", "M3 8l9 5 9-5", "M12 13v8"],
  space: ["M5 21V3h14v18", "M3 21h18", "M10 21v-6h4v6"],
  // People, more than one: somebody in front and another behind their
  // shoulder — and not the one person the account button in the bar is.
  service: [[9, 8, 3.5], "M2 21c0-3.6 3.1-6 7-6s7 2.4 7 6", "M15.5 4.7a3.5 3.5 0 0 1 0 6.6", "M18 15.4c2.4.8 4 2.8 4 5.6"],
};

export function iconParts(kind, category) {
  return ICONS[category] ?? KIND_ICONS[kind] ?? KIND_ICONS.item;
}

// The same parts as markup, for the one place that is built by hand rather than
// rendered: a pin on the map is a DOM node the map places, not a React one.
export function iconMarkup(kind, category) {
  return iconParts(kind, category)
    .map((part) =>
      typeof part === "string"
        ? `<path d="${part}"/>`
        : `<circle cx="${part[0]}" cy="${part[1]}" r="${part[2]}"/>`,
    )
    .join("");
}
