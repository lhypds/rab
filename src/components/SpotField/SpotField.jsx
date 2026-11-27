import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Checkbox } from "../../ui/index.js";
import { spotPath } from "../../utils/spots.js";
import { useAuth } from "../AuthProvider/index.js";
import styles from "./spot.module.css";

// Which pages a new item goes on, asked on the sheet it is made on (ItemModal):
// any number of one's own pages, ticked. Every item is on at least one page:
// the default page — the one named after one's account, which the server lists
// first — is ticked to start with, and the last page ticked cannot be
// unticked. `value` is the list of the pages' ids. Each line has at its right
// end the way to the page itself, opened in a tab of its own so the form is
// not lost.
export default function SpotField({ value, onChange, disabled = false, hintClassName }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [own, setOwn] = useState(null);

  // One's own pages, read once when the field is first shown.
  useEffect(() => {
    let cancelled = false;
    api
      .getSpotChoices()
      .then((answer) => !cancelled && setOwn(answer.spots ?? []))
      .catch(() => !cancelled && setOwn([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // With nothing ticked — at the start, or after the form is opened afresh —
  // the default page is.
  const fallback = (own ?? []).find((spot) => spot.default) ?? own?.[0];
  useEffect(() => {
    if (fallback && value.length === 0) onChange([fallback.id]);
  }, [fallback, value.length, onChange]);

  const toggle = (id, on) => onChange(on ? [...value.filter((each) => each !== id), id] : value.filter((each) => each !== id));

  return (
    <div className="field">
      <span className="field-label">{t("publish.spotLabel")}</span>
      {own && own.length > 0 && (
        <ul className={styles.found}>
          {own.map((spot) => (
            <li key={spot.id}>
              <Checkbox
                className={styles.choice}
                checked={value.includes(spot.id)}
                onChange={(on) => toggle(spot.id, on)}
                disabled={disabled || (value.length === 1 && value[0] === spot.id)}
              >
                {spot.thumb && <img src={spot.thumb} alt="" loading="lazy" />}
                <span>{spot.default ? `${spot.title} (${t("spot.default")})` : spot.title}</span>
              </Checkbox>
              {user && (
                <a
                  className={styles.open}
                  href={spotPath({ ...spot, owner: user.username })}
                  target="_blank"
                  rel="noopener"
                  aria-label={t("map.open")}
                  title={t("map.open")}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M14 4h6v6" />
                    <path d="M20 4l-9 9" />
                    <path d="M18 14v6H4V6h6" />
                  </svg>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <span className={hintClassName}>{t("publish.spotHint")}</span>
    </div>
  );
}
