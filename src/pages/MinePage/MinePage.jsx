import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageList from "../../components/PageList.jsx";
import * as api from "../../api.js";
import { CategoryFilter, CategoryIcon, categoriesOf, kindOfCategory, Header, ItemRow, PageModal, useAuth } from "../../components/index.js";
import { Skeleton, showToast, useNavigate, useSearchParams } from "../../ui/index.js";
import { KINDS } from "../../utils/kinds.js";

// What the list of your items can be narrowed to: one kind of thing, one at
// a time, and — on or off beside whichever that is — only what is published.
// "All" is none of that: it is pressed while nothing else is, and pressing it
// lets go of the rest. The buttons stand in this order.
const FILTERS = ["all", "published", ...KINDS];

// What is yours: what you have out for rent, in one list. (What you have
// asked other people for is on /others.) An item
// somebody is waiting on an answer about stands at the top of its list — the
// one asked about first, first — and its row says how many are waiting; the
// answer is given on the item's own page.
export default function MinePage() {
  const { t } = useTranslation();
  const [making, setMaking] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  // The filter is in the address, so coming back from an item's page lands on
  // the list that was left.
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const wanted = searchParams.get("show");
  const filter = KINDS.includes(wanted) ? wanted : "all";
  const published = searchParams.get("published") === "1";
  // And within it one category, "" for all of them: one the kind in force
  // does not have is no choice at all.
  const kind = KINDS.includes(filter) ? filter : null;
  const slugWanted = searchParams.get("category") ?? "";
  const category = categoriesOf(kind, Boolean(user?.adult)).includes(slugWanted) ? slugWanted : "";
  const show = (name, slug, onlyPublished = published) => {
    const query = new URLSearchParams();
    if (name !== "all") query.set("show", name);
    if (onlyPublished) query.set("published", "1");
    if (slug) query.set("category", slug);
    navigate(query.size > 0 ? `/mine?${query}` : "/mine", { replace: true, scroll: false });
  };
  // All gives up the published switch and the category along with the kind;
  // a kind leaves both as they are.
  // And a kind pressed a second time is let go of, which with nothing else
  // pressed is All again.
  // Choosing a category chooses the kind it belongs to as well, so the kind's
  // button is pressed with it; one that is in every kind leaves the kind alone.
  const chooseCategory = (slug) => show((slug && kindOfCategory(slug)) || filter, slug);
  const setFilter = (name) =>
    name === "all"
      ? show("all", "", false)
      : // Letting go of a kind lets go of the category chosen within it too.
        name === filter
        ? show("all", "", published)
        : show(name, category, published);
  const pressed = (name) =>
    name === "published" ? published : name === "all" ? filter === "all" && !published && !category : filter === name;

  const load = useCallback(() => {
    api
      .getMine()
      .then((answer) => {
        setData(answer);
        setError("");
      })
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(load, [load]);

  // An item of yours dragged from the list on the right onto a page of its
  // kind on the left is put on that page.
  const [carried, setCarried] = useState(null);
  const carry = (item, event) => {
    if (!event) return setCarried(null);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", item.title);
    setCarried(item);
  };
  const putOnPage = async (page) => {
    const item = carried;
    setCarried(null);
    if (!item) return;
    try {
      const answer = await api.addToPage(page.id, item.id);
      setData((current) => current && { ...current, pages: current.pages.map((each) => (each.id === page.id ? { ...each, ...answer.page } : each)) });
      showToast(t(answer.added ? "page.added" : "page.alreadyOn", { name: page.name }), 2000);
    } catch (addError) {
      showToast(addError.message, 3000);
    }
  };

  // When each item was first asked for by somebody still waiting: bookings
  // are numbered as they are made, so the lowest number is the earliest.
  const asked = new Map();
  for (const booking of data?.requests ?? []) {
    if (booking.status !== "pending") continue;
    asked.set(booking.itemId, Math.min(booking.id, asked.get(booking.itemId) ?? Infinity));
  }
  // The ones asked about first, by who has waited longest; the rest after
  // them, in the order they came in (a sort keeps that where two are equal).
  const turn = (item) => asked.get(item.id) ?? Number.MAX_SAFE_INTEGER;
  const fits = (item) =>
    (filter === "all" || (item.kind || "item") === filter) &&
    (!published || item.active) &&
    (!category || item.category === category);
  const items = (data?.items ?? []).filter(fits).sort((a, b) => turn(a) - turn(b));

  return (
    <div className="page-shell">
      <Header back />
      <main className="wide-page mine-page">
        <div className="section-heading">
          <h1>{t("mine.title")}</h1>
        </div>

        {/* Your pages on the left; your items on the right, with what they
            are narrowed to above them. On a narrow screen the items come
            after the pages. */}
        <div className="others-columns">
          <section>
            {data && <PageList pages={data.pages} username={user.username} onCreate={() => setMaking(true)} filterable carried={carried} onDropItem={putOnPage} />}
          </section>

          <section>
            <div className="part-heading">
              <h2>{t("mine.items")}</h2>
              {data && <span>{items.length}</span>}
            </div>

            {/* What the list below is narrowed to: the kind, and after the last
                of the kinds the category within it. */}
            <div className="tabs" role="group">
              {FILTERS.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={pressed(name)}
                  className={pressed(name) ? "tab active" : "tab"}
                  // Published is a switch of its own, pressed and let go without
                  // touching which kind is chosen.
                  onClick={() => (name === "published" ? show(filter, category, !published) : setFilter(name))}
                >
                  {/* Each kind leads with its own mark, as on the map. */}
                  {KINDS.includes(name) && <CategoryIcon kind={name} />}
                  {/* What is a service to whoever books it is, to whoever offers
                      it, a skill of their own. */}
                  {name === "published" ? t("item.published") : name === "service" ? t("mine.skills") : t(`kind.${name}`)}
                </button>
              ))}
              <CategoryFilter
                kind={kind}
                kindLabel={kind === "service" ? t("mine.skills") : undefined}
                value={category}
                onChange={chooseCategory}
              />
            </div>

            {error && <p className="list-error">{error}</p>}
            {!data && !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />}
            {data &&
              (items.length === 0 ? (
                <p className="empty-state">{t(filter === "all" && !category && !published ? "mine.itemsEmpty" : "mine.noneShown")}</p>
              ) : (
                <ul className="row-list">
                  {items.map((item) => (
                    <ItemRow key={item.id} item={item} showPublished onDrag={item.shared ? undefined : (event) => carry(item, event)} />
                  ))}
                </ul>
              ))}
          </section>
        </div>
      </main>
      <PageModal
        isOpen={making}
        onClose={() => setMaking(false)}
        onSaved={(page) => navigate(`/u/${encodeURIComponent(page.owner)}/p/${encodeURIComponent(page.id)}`, { state: { back: true } })}
      />
    </div>
  );
}
