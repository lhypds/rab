import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Select } from "../../ui/index.js";
import styles from "./store.module.css";

// Which page a new item goes on, asked on the sheet it is made on (ItemModal).
// An item need be on no page at all, and is on none unless one is picked: for
// one's own item, one of one's own pages — the default one, which every
// account has, first among them; for somebody else's, one of the pages of somebody
// else's (the public account's), found by name or place among thousands.
// `value` is the page's id, or null for none.
const SEARCH_WAIT = 300;

export default function StoreField({ shared, value, onChange, disabled = false, hintClassName }) {
  const { t } = useTranslation();
  const [own, setOwn] = useState(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState([]);
  const [chosen, setChosen] = useState(null);

  // One's own pages, read once the field is first shown for one's own item.
  useEffect(() => {
    if (shared || own) return undefined;
    let cancelled = false;
    api
      .getStoreChoices()
      .then((answer) => !cancelled && setOwn(answer.stores ?? []))
      .catch(() => !cancelled && setOwn([]));
    return () => {
      cancelled = true;
    };
  }, [shared, own]);

  // Somebody else's pages, looked for a moment after typing stops.
  useEffect(() => {
    if (!shared) return undefined;
    const words = query.trim();
    if (!words) {
      setFound([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .getStoreChoices({ shared: true, q: words })
        .then((answer) => !cancelled && setFound(answer.stores ?? []))
        .catch(() => !cancelled && setFound([]));
    }, SEARCH_WAIT);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shared, query]);

  if (!shared) {
    // None first, and what is taken where nothing else is; then the default
    // page, which the server lists first; then the rest.
    const options = [
      { value: "", label: t("publish.storeNoneOption") },
      ...(own ?? []).map((store) => ({
        value: store.id,
        label: store.default ? `${store.title} (${t("store.default")})` : store.title,
      })),
    ];
    return (
      <div className="field">
        <span className="field-label">{t("publish.storeLabel")}</span>
        {own && (
          <Select
            options={options}
            value={value ?? ""}
            onChange={(id) => onChange(id || null)}
            label={t("publish.storeLabel")}
            searchPlaceholder={options.length > 8 ? t("publish.storeSearch") : undefined}
            emptyLabel={t("publish.storeNone")}
          />
        )}
        <span className={hintClassName}>{t("publish.storeHint")}</span>
      </div>
    );
  }

  return (
    <div className="field">
      <span className="field-label">{t("publish.storeLabel")}</span>
      <input
        className="text-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("publish.storeSearch")}
        disabled={disabled}
      />
      {value && chosen && (
        <div className={styles.chosen}>
          <strong>{chosen.title}</strong>
          <button
            type="button"
            className="small-button"
            disabled={disabled}
            onClick={() => {
              setChosen(null);
              onChange(null);
            }}
          >
            {t("publish.storeClear")}
          </button>
        </div>
      )}
      {found.length > 0 && (
        <ul className={styles.found}>
          {found.map((store) => (
            <li key={store.id}>
              <button
                type="button"
                aria-pressed={value === store.id}
                disabled={disabled}
                onClick={() => {
                  setChosen(store);
                  onChange(store.id);
                }}
              >
                {store.thumb && <img src={store.thumb} alt="" loading="lazy" />}
                <span>{[store.title, store.place].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && found.length === 0 && <span className={hintClassName}>{t("publish.storeNone")}</span>}
      <span className={hintClassName}>{t("publish.storeHintShared")}</span>
    </div>
  );
}
