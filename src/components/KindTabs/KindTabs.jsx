import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "../../ui/index.js";
import { KINDS } from "../../utils/kinds.js";
import { useAuth } from "../AuthProvider/index.js";
import CategoryFilter, { categoriesOf, kindOfCategory } from "../CategoryFilter/index.js";
import CategoryIcon from "../CategoryIcon/index.js";

// What a list can be narrowed to: all of it, or one kind of thing.
const FILTERS = ["all", ...KINDS];

// A list's filter, kept in the address under `kindKey` and `categoryKey`
// and leaving the rest of the address as it is: one kind at a time, and
// within it one category ("" for all of them). A kind pressed a second time
// is let go of, and the category with it; All lets go of both. Choosing a
// category chooses the kind it belongs to as well.
export function useKindFilter(kindKey = "show", categoryKey = "category") {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const wanted = searchParams.get(kindKey);
  const filter = FILTERS.includes(wanted) ? wanted : "all";
  // A category the kind in force does not have is no choice at all.
  const kind = KINDS.includes(filter) ? filter : null;
  const slugWanted = searchParams.get(categoryKey) ?? "";
  const category = categoriesOf(kind, Boolean(user?.adult)).includes(slugWanted) ? slugWanted : "";
  const show = (name, slug) => {
    const query = new URLSearchParams(searchParams);
    if (name === "all") query.delete(kindKey);
    else query.set(kindKey, name);
    if (slug) query.set(categoryKey, slug);
    else query.delete(categoryKey);
    navigate(query.size > 0 ? `${pathname}?${query}` : pathname, { replace: true, scroll: false });
  };
  return {
    filter,
    kind,
    category,
    // Whether nothing is being narrowed away.
    everything: filter === "all" && !category,
    // Whether a thing of this kind and category is shown.
    fits: (itemKind, itemCategory) => (filter === "all" || (itemKind || "item") === filter) && (!category || itemCategory === category),
    pressed: (name) => (name === "all" ? filter === "all" && !category : filter === name),
    setFilter: (name) => (name === "all" || name === filter ? show("all", "") : show(name, category)),
    chooseCategory: (slug) => show((slug && kindOfCategory(slug)) || filter, slug),
  };
}

// The buttons of such a filter: the kinds, and after the last of them the
// category within the one in force.
export default function KindTabs({ kind, category, pressed, setFilter, chooseCategory }) {
  const { t } = useTranslation();
  return (
    <div className="tabs" role="group">
      {FILTERS.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={pressed(name)}
          className={pressed(name) ? "tab active" : "tab"}
          onClick={() => setFilter(name)}
        >
          {/* Each kind leads with its own mark, as on the map. */}
          {name !== "all" && <CategoryIcon kind={name} />}
          {t(`kind.${name}`)}
        </button>
      ))}
      <CategoryFilter kind={kind} value={category} onChange={chooseCategory} />
    </div>
  );
}
