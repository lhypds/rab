import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { useNavigate } from "../../ui/index.js";
import { priceLine } from "../../utils/format.js";
import { sortLabel } from "../../utils/kinds.js";
import UserName, { dotted } from "../UserName/index.js";
import styles from "./search.module.css";

const SEARCH_DELAY_MS = 250;

// The box in the middle of the top bar: what is out for rent, by what it says
// about itself. The map's own search finds places; this one finds things,
// wherever they are — including the ones with no place on the map at all.
export default function ItemSearch() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setItems(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .searchItems(text, { signal: controller.signal })
        .then((data) => {
          setItems(data.items ?? []);
          setActive(-1);
        })
        .catch(() => {});
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // A press anywhere else puts the answers away without emptying the box.
  useEffect(() => {
    const outside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  function go(item) {
    setQuery("");
    setItems(null);
    setOpen(false);
    navigate(`/i/${item.id}`);
  }

  function steer(event) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && (query || open)) {
      event.stopPropagation();
      setQuery("");
      setOpen(false);
      return;
    }
    if (!items?.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current === -1 && step === -1 ? items.length - 1 : (current + step + items.length) % items.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(items[active] ?? items[0]);
    }
  }

  return (
    <div ref={wrapperRef} className={styles.search} role="search">
      <div className={styles.field}>
        <svg className={styles.glass} viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-4.5-4.5" />
        </svg>
        <input
          className={styles.input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={steer}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              setQuery("");
              setItems(null);
            }}
            aria-label={t("map.searchClear")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
      {open && items && (
        <ul className={styles.results}>
          {items.length === 0 && <li className={styles.note}>{t("search.empty")}</li>}
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className={index === active ? `${styles.result} ${styles.active}` : styles.result}
                onPointerEnter={() => setActive(index)}
                onClick={() => go(item)}
              >
                {item.thumb && <img className={styles.thumb} src={item.thumb} alt="" width="32" height="32" />}
                <span className={styles.lines}>
                  <strong>{item.title}</strong>
                  <span>
                    {dotted([
                      priceLine(item, i18n.language, t),
                      sortLabel(item, t),
                      item.place,
                      item.owner && <UserName name={item.owner} inside />,
                    ])}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
