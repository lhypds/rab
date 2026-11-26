import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Checkbox } from "../../ui/index.js";
import styles from "./store.module.css";

// Which pages a new item goes on, asked on the sheet it is made on (ItemModal):
// any number of one's own pages, ticked. Every item is on at least one page:
// the default page — the one named after one's account, which the server lists
// first — is ticked to start with, and the last page ticked cannot be
// unticked. `value` is the list of the pages' ids.
export default function StoreField({ value, onChange, disabled = false, hintClassName }) {
  const { t } = useTranslation();
  const [own, setOwn] = useState(null);

  // One's own pages, read once when the field is first shown.
  useEffect(() => {
    let cancelled = false;
    api
      .getStoreChoices()
      .then((answer) => !cancelled && setOwn(answer.stores ?? []))
      .catch(() => !cancelled && setOwn([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // With nothing ticked — at the start, or after the form is opened afresh —
  // the default page is.
  const fallback = (own ?? []).find((store) => store.default) ?? own?.[0];
  useEffect(() => {
    if (fallback && value.length === 0) onChange([fallback.id]);
  }, [fallback, value.length, onChange]);

  const toggle = (id, on) => onChange(on ? [...value.filter((each) => each !== id), id] : value.filter((each) => each !== id));

  return (
    <div className="field">
      <span className="field-label">{t("publish.storeLabel")}</span>
      {own && own.length > 0 && (
        <ul className={styles.found}>
          {own.map((store) => (
            <li key={store.id}>
              <Checkbox
                className={styles.choice}
                checked={value.includes(store.id)}
                onChange={(on) => toggle(store.id, on)}
                disabled={disabled || (value.length === 1 && value[0] === store.id)}
              >
                {store.thumb && <img src={store.thumb} alt="" loading="lazy" />}
                <span>{store.default ? `${store.title} (${t("store.default")})` : store.title}</span>
              </Checkbox>
            </li>
          ))}
        </ul>
      )}
      <span className={hintClassName}>{t("publish.storeHint")}</span>
    </div>
  );
}
