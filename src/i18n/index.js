import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import zh from "./zh.json";
import ja from "./ja.json";

const supportedLangs = ["en", "zh", "ja"];

let savedLang = null;
try {
  savedLang = localStorage.getItem("lang");
} catch {
  // No storage: the browser's own language is the answer.
}
const browserLang = navigator.language.split("-")[0];
const defaultLang = supportedLangs.includes(savedLang)
  ? savedLang
  : supportedLangs.includes(browserLang)
    ? browserLang
    : "en";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    ja: { translation: ja },
  },
  lng: defaultLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

document.documentElement.lang = defaultLang;
i18n.on("languageChanged", (lang) => {
  document.documentElement.lang = lang;
});

export default i18n;
