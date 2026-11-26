import { useTranslation } from "react-i18next";
import { Select } from "../../ui/index.js";
import { categoriesFor } from "../../utils/categories.js";
import { useAuth } from "../AuthProvider/index.js";
import CategoryIcon from "../CategoryIcon/index.js";
import styles from "./filter.module.css";

// The categories a list can be narrowed to. The grown-up ones are among them
// only where `adult` (see categories.js).
export function categoriesOf(adult = false) {
  return categoriesFor(adult);
}

// The dropdown over a list: which category of it is shown, "" for all of
// them. Each leads with its own mark, as on the map.
export default function CategoryFilter({ value, onChange }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const options = ["", ...categoriesOf(Boolean(user?.adult))].map((slug) => {
    const name = slug ? t(`category.${slug}`, slug) : t("map.allCategories");
    return {
      value: slug,
      label: (
        <span className={styles.name}>
          <CategoryIcon category={slug} />
          {name}
        </span>
      ),
      text: name,
    };
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
