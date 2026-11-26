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
      <div className="tabs" role="group" aria-label={t("publish.as")}>
        {PUBLISH_AS.map((each) => (
          <button
            key={each}
            type="button"
            className={value === each ? "tab active" : "tab"}
            aria-pressed={value === each}
            onClick={() => value !== each && onChange(each)}
            disabled={disabled}
          >
            {t(`publish.${each}`)}
          </button>
        ))}
      </div>
      {/* What the one picked is. (publish.storeHint is the page boxes' own,
          under StoreField.) */}
      <span className={hintClassName}>{t(value === "store" ? "publish.pageHint" : "publish.itemHint")}</span>
    </div>
  );
}
