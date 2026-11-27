import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton } from "../ui/index.js";

// Whether a list is drawn as rows or as cards with their photographs, kept by
// the browser: the same for every list on Mine and on somebody's profile.
const VIEW_KEY = "rab:mine-view";
function keptView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "cards" ? "cards" : "list";
  } catch {
    return "list";
  }
}

// Which of the two it is (`cards`), and the pair of buttons that says which
// (`viewPair`), to stand beside the heading of what is shown — as on a spot's
// page, beside the heading of the items on it.
export function useListView() {
  const { t } = useTranslation();
  const [view, setViewState] = useState(keptView);
  const setView = (next) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Rows again next time.
    }
  };
  const cards = view === "cards";
  const viewPair = (
    <span className="topbar-view" role="group" aria-label={t("store.itemsView")}>
      <ActionButton tooltip={t("store.viewCards")} tooltipLeft aria-pressed={cards} onClick={() => setView("cards")}>
        <svg viewBox="0 0 24 24">
          {/* 田: one square, crossed through the middle. */}
          <path d="M4 4h16v16H4z" />
          <path d="M12 4v16" />
          <path d="M4 12h16" />
        </svg>
      </ActionButton>
      <ActionButton tooltip={t("store.viewList")} aria-pressed={!cards} onClick={() => setView("list")}>
        <svg viewBox="0 0 24 24">
          <path d="M9 6h11" />
          <path d="M9 12h11" />
          <path d="M9 18h11" />
          <path d="M4 6h.01" />
          <path d="M4 12h.01" />
          <path d="M4 18h.01" />
        </svg>
      </ActionButton>
    </span>
  );
  return { cards, viewPair };
}
