import { useTranslation } from "react-i18next";

export const PUBLISH_AS = ["item", "store"];

// What is being published, asked first on the sheet the bar's Publish opens
// (ItemModal): one item — a thing, a space, a service — or a store, which the
// site calls a page: a collection of items already posted — a store of
// things, a page of spaces, someone's services. Everything else on the sheet
// is asked of both alike; a store is kept apart, with the items on it.
export default function PublishAsField({ value, onChange, disabled = false, hintClassName }) {
  const { t } = useTranslation();
  return (
    <div className="field">
      <span className="field-label">{t("publish.as")}</span>
      {/* A switch between the two: the item's word on its left, the
          page's on its right, either pressed to pick it, and the switch
          itself flipping from one to the other. */}
      <div className="switch-field">
        <button type="button" className={value === "item" ? "switch-word active" : "switch-word"} onClick={() => onChange("item")} disabled={disabled}>
          {t("publish.item")}
        </button>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={value === "store"}
          aria-label={t("publish.store")}
          onClick={() => onChange(value === "store" ? "item" : "store")}
          disabled={disabled}
        >
          <span className="switch-knob" />
        </button>
        <button type="button" className={value === "store" ? "switch-word active" : "switch-word"} onClick={() => onChange("store")} disabled={disabled}>
          {t("publish.store")}
        </button>
      </div>
      {/* What the one picked is. (publish.storeHint is the page boxes' own,
          under StoreField.) */}
      <span className={hintClassName}>{t(value === "store" ? "publish.pageHint" : "publish.itemHint")}</span>
    </div>
  );
}
