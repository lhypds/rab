import { useTranslation } from "react-i18next";

export const POST_AS = ["item", "page"];

// What a new post is, asked first on the sheet the bar's Post opens
// (ItemModal): one item — a thing, a space, a service — or a page, which is a
// collection of items already posted: a store, a space, someone's services.
// Everything else on the sheet is asked of both alike; a page is kept apart,
// with the items on it.
export default function PostAsField({ value, onChange, disabled = false, hintClassName }) {
  const { t } = useTranslation();
  return (
    <div className="field">
      <span className="field-label">{t("post.as")}</span>
      <div className="tabs" role="group" aria-label={t("post.as")}>
        {POST_AS.map((each) => (
          <button
            key={each}
            type="button"
            className={value === each ? "tab active" : "tab"}
            aria-pressed={value === each}
            onClick={() => value !== each && onChange(each)}
            disabled={disabled}
          >
            {t(`post.${each}`)}
          </button>
        ))}
      </div>
      <span className={hintClassName}>{t(`post.${value}Hint`)}</span>
    </div>
  );
}
