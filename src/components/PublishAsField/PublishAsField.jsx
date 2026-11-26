import { useTranslation } from "react-i18next";

export const PUBLISH_AS = ["item", "store"];

// What is being published, asked first on the sheet the bar's Publish opens
// (ItemModal): one item — a thing, a space, a service — or a store, which the
// site calls a spot: a collection of items already posted — a shop of
// things, a venue of spaces, someone's services. Everything else on the sheet
// is asked of both alike; a store is kept apart, with the items on it.
export default function PublishAsField({ value, onChange, disabled = false, hintClassName }) {
  const { t } = useTranslation();
  return (
    <div className="field">
      {/* "Add a", and the pair on the same line after it. */}
      <div className="field-inline">
        <span className="field-label">{t("publish.as")}</span>
        {/* Two buttons side by side, as the top bar's map and lists are, the
            one in force turned over — each its mark and then its name. */}
        <span className="button-pair" role="group" aria-label={t("publish.as")}>
          <button type="button" className="pair-button" aria-pressed={value === "item"} onClick={() => onChange("item")} disabled={disabled}>
            {/* A box: one thing. */}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
              <path d="m3 8 9 5 9-5" />
              <path d="M12 13v8" />
            </svg>
            {t("publish.item")}
          </button>
          <button type="button" className="pair-button" aria-pressed={value === "store"} onClick={() => onChange("store")} disabled={disabled}>
            {/* A pin: a spot, with things at it. */}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
              <path d="M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
            </svg>
            {t("publish.store")}
          </button>
        </span>
      </div>
      {/* What each of the two is, both said whichever is picked, each under
          its name. (publish.storeHint is the spot boxes' own, under
          StoreField.) */}
      <div className="field-hints">
        <span className={hintClassName}>
          <strong>{t("publish.item")}</strong>{t("publish.colon")}{t("publish.itemHint")}
        </span>
        <span className={hintClassName}>
          <strong>{t("publish.store")}</strong>{t("publish.colon")}{t("publish.pageHint")}
        </span>
      </div>
    </div>
  );
}
