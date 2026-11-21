import i18n from "../i18n/index.js";

export const LANGS = ["en", "zh", "ja"];

// The reader picking a language: the words on this page, and the copy this
// browser keeps for the next visit.
export function chooseLang(code) {
  if (!LANGS.includes(code)) return;
  try {
    localStorage.setItem("lang", code);
  } catch {
    // The choice still holds for this visit when storage is unavailable.
  }
  i18n.changeLanguage(code);
}
