import { useLocation, useNavigate, useSearchParams } from "../../ui/index.js";
import { useAuth } from "../AuthProvider/index.js";
import CategoryFilter, { categoriesOf } from "../CategoryFilter/index.js";

// A list's filter, kept in the address under `categoryKey` and leaving the
// rest of the address as it is: one category at a time, "" for all of them.
export function useCategoryFilter(categoryKey = "category") {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const wanted = searchParams.get(categoryKey) ?? "";
  const category = categoriesOf(Boolean(user?.adult)).includes(wanted) ? wanted : "";
  const chooseCategory = (slug) => {
    const query = new URLSearchParams(searchParams);
    if (slug) query.set(categoryKey, slug);
    else query.delete(categoryKey);
    navigate(query.size > 0 ? `${pathname}?${query}` : pathname, { replace: true, scroll: false });
  };
  return {
    category,
    // Whether nothing is being narrowed away.
    everything: !category,
    // Whether an item of this category is shown.
    fits: (itemCategory) => !category || itemCategory === category,
    chooseCategory,
  };
}

// The row over such a list: the category in force.
export default function CategoryTabs({ category, chooseCategory }) {
  return (
    <div className="tabs" role="group">
      <CategoryFilter value={category} onChange={chooseCategory} />
    </div>
  );
}
