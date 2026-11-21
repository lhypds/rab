// The draft an item form is holding, handed to the preview page.
//
// The preview is a page of its own in a tab of its own, so the form cannot pass
// it anything directly: the draft is written where both can read it, and the
// preview tab is told when it changes — a write to localStorage raises a
// `storage` event in every other tab of the same site, which is exactly the
// one that needs to hear.
const KEY = "rab:preview";

export function writePreview(draft) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...draft, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function readPreview() {
  try {
    const draft = JSON.parse(localStorage.getItem(KEY) || "null");
    return draft?.item && draft?.calendar ? draft : null;
  } catch {
    return null;
  }
}

// Told whenever the form writes a newer draft. Returns the way to stop.
export function watchPreview(listener) {
  const heard = (event) => {
    if (event.key === KEY) listener(readPreview());
  };
  window.addEventListener("storage", heard);
  return () => window.removeEventListener("storage", heard);
}

// The preview's tab, opened by name so that pressing Preview again brings the
// same tab forward with the newer draft rather than opening another.
export function openPreview() {
  return window.open("/preview", "rab-preview");
}
