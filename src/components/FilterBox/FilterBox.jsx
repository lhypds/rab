import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import styles from "./filter.module.css";

// A box that narrows what is already on the page: a glass to say what it is,
// the field, and the cross that empties it once there is something in it.
// Escape empties it, and pressed again — or in an empty field — leaves it.
//
// With `slash`, a "/" pressed anywhere on the page that is not being typed
// into comes to the field — where the box is on screen, and no sheet is open
// over it.
export default function FilterBox({ value, onChange, placeholder, className, slash = false }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);

  useEffect(() => {
    if (!slash) return undefined;
    const reach = (event) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const at = event.target;
      if (at instanceof HTMLElement && (at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName))) return;
      const input = inputRef.current;
      // Not the one that is put away at this width, nor under a sheet.
      if (!input || input.offsetParent === null || document.querySelector("[data-modal]")) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", reach);
    return () => window.removeEventListener("keydown", reach);
  }, [slash]);
  return (
    <div className={className ? `${styles.filter} ${className}` : styles.filter} role="search">
      <svg className={styles.glass} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.5-4.5" />
      </svg>
      <input
        ref={inputRef}
        className={styles.input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape") {
            event.stopPropagation();
            if (value) onChange("");
            else event.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {value && (
        <button type="button" className={styles.clear} onClick={() => onChange("")} aria-label={t("map.searchClear")}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}
