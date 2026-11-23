import { useTranslation } from "react-i18next";
import { Select } from "../../ui/index.js";
import { CATEGORIES, KINDS } from "../../utils/kinds.js";
import CategoryIcon from "../CategoryIcon/index.js";
import styles from "./filter.module.css";

// The categories a list can be narrowed to within `kind` — every kind's where
// there is none ("other" is in all three, and is listed once — last, where it
// is in every kind's own list: it is what is picked when nothing above it
// fits).
export function categoriesOf(kind) {
  const all = [...new Set((KINDS.includes(kind) ? [kind] : KINDS).flatMap((each) => CATEGORIES[each]))];
  return [...all.filter((slug) => slug !== "other"), ...all.filter((slug) => slug === "other")];
}

// The one kind a category belongs to, or null where it is in more than one
// ("other" is in all three) or in none.
export function kindOfCategory(slug) {
  const kinds = KINDS.filter((kind) => CATEGORIES[kind].includes(slug));
  return kinds.length === 1 ? kinds[0] : null;
}

// The dropdown under a list's filter: which category of it is shown, "" for
// all of them. Each leads with its own mark, as on the map.
//
// Within a kind, the two choices that every kind has say which kind's they
// are: "All categories (Things)", "Other (Things)". `kindLabel` is what the
// kind is called on the page the dropdown is on, where that is not its usual
// name.
export default function CategoryFilter({ kind = null, kindLabel, value, onChange }) {
  const { t } = useTranslation();
  const within = KINDS.includes(kind) ? kind : null;
  const withIcon = (slug, name) => (
    <span className={styles.name}>
      <CategoryIcon kind={within} category={slug} />
      {name}
    </span>
  );
  const called = within ? (kindLabel ?? t(`kind.${within}`)) : null;
  const named = (slug, name) =>
    within && (slug === "" || slug === "other") ? t("item.categoryWithin", { name, kind: called }) : name;
  const options = ["", ...categoriesOf(within)].map((slug) => {
    const name = named(slug, slug ? t(`category.${slug}`, slug) : t("map.allCategories"));
    return { value: slug, label: withIcon(slug, name), text: name };
  });
  return (
    <div className={styles.row}>
      <Select
        className={styles.select}
        fit
        label={t("item.category")}
        value={value}
        onChange={onChange}
        options={options}
        searchPlaceholder={t("item.categorySearch")}
        emptyLabel={t("item.categoryNoMatch")}
      />
    </div>
  );
}
