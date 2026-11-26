import { useEffect, useState } from "react";
import { Header, MapView } from "../../components/index.js";

// Which way the home page is being read: on the map, or as lists. Kept for the
// tab's life, so the way back from an item's page is to the view it was opened
// from; a new visit opens on the map.
const VIEW_KEY = "rab:home-view";

function keptView() {
  try {
    return sessionStorage.getItem(VIEW_KEY) === "list" ? "list" : "map";
  } catch {
    return "map";
  }
}

// What rab opens on: the map, and everything out for rent standing on it —
// or, from the pair of buttons in the bar, the same things as lists.
// `active`: false while it is kept out of sight under an item's page (see
// App) — its bar is put away then, so that the bar of the page over it is the
// only one answering what the page asks of a bar, and "v" does nothing.
export default function HomePage({ active = true }) {
  const [view, setView] = useState(keptView);
  // What is being looked for among what is here: typed in the bar, read by the
  // list and the pins.
  const [query, setQuery] = useState("");
  const choose = (next) => {
    setView(next);
    try {
      sessionStorage.setItem(VIEW_KEY, next);
    } catch {
      // Opens on the map next time, which is the worst this costs.
    }
  };
  // "v" turns the page over, from the map to the lists and back: pressed
  // anywhere that is not being typed into, with no sheet open over the page.
  useEffect(() => {
    if (!active) return undefined;
    const turn = (event) => {
      if (event.key.toLowerCase() !== "v" || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const at = event.target;
      if (at instanceof HTMLElement && (at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName))) return;
      if (document.querySelector("[data-modal]")) return;
      event.preventDefault();
      choose(view === "list" ? "map" : "list");
    };
    window.addEventListener("keydown", turn);
    return () => window.removeEventListener("keydown", turn);
  }, [view, active]);

  return (
    <div className="home-page">
      {active && <Header view={view} onView={choose} query={query} onQuery={setQuery} />}
      <main className="home-main">
        <MapView view={view} query={query} onQuery={setQuery} active={active} />
      </main>
    </div>
  );
}
