import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { BookingRow, CategoryFilter, ItemRow, CategoryIcon, Header, MessageModal, categoriesOf, kindOfCategory, useAuth } from "../../components/index.js";
import { Skeleton, useLocation, useNavigate, useSearchParams } from "../../ui/index.js";
import { KINDS } from "../../utils/kinds.js";

// What the list can be narrowed to: all of it, or one kind of thing.
const FILTERS = ["all", "item", "space", "service"];

// When a rental starts, as text that sorts: its day, then its time — the first
// slot's where it is for slots, the pickup's otherwise.
const startOf = (booking) => `${booking.start} ${booking.slots?.[0]?.start ?? booking.startTime ?? ""}`;

// What is other people's: what you have asked them for, and what became of
// each request — and the items you have kept to come back to, your
// bookmarks. What is your own is on /mine.
export default function OthersPage() {
  const { t } = useTranslation();
  const [bookings, setBookings] = useState(null);
  const [bookmarks, setBookmarks] = useState(null);
  const [error, setError] = useState("");
  const [writingTo, setWritingTo] = useState(null);
  // Each column has a filter of its own, in the address, so coming back from
  // an item's page lands on the lists that were left: the rentals' under
  // `show` and `category`, the bookmarks' under `kept` and `keptCategory`.
  const rentalsFilter = useKindFilter("show", "category");
  const keptFilter = useKindFilter("kept", "keptCategory");

  const load = useCallback(() => {
    api
      .getMine()
      .then((answer) => {
        setBookings(answer.bookings);
        setError("");
      })
      .catch((requestError) => setError(requestError.message));
    api
      .getBookmarks()
      .then((answer) => setBookmarks(answer.items))
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(load, [load]);

  // The one rented last at the top: by when the rental is for, latest first,
  // and where two are for the same time, the one asked for later.
  const shown = bookings
    ?.filter(
      (booking) =>
        (rentalsFilter.filter === "all" || booking.itemKind === rentalsFilter.filter) &&
        (!rentalsFilter.category || booking.itemCategory === rentalsFilter.category),
    )
    .sort((a, b) => (startOf(a) < startOf(b) ? 1 : startOf(a) > startOf(b) ? -1 : b.id - a.id));
  // The bookmarks, narrowed by their own filter; the one kept last first,
  // which is how they come.
  const kept = bookmarks?.filter(
    (item) => (keptFilter.filter === "all" || item.kind === keptFilter.filter) && (!keptFilter.category || item.category === keptFilter.category),
  );

  return (
    <div className="page-shell">
      <Header back />
      <main className="wide-page">
        <div className="section-heading">
          <h1>{t("others.title")}</h1>
        </div>

        {error && <p className="list-error">{error}</p>}
        <div className="others-columns others-page">
          <section>
            <div className="part-heading">
              <h2>{t("others.rentals")}</h2>
              {shown && <span>{shown.length}</span>}
            </div>
            <KindTabs {...rentalsFilter} />

            {!shown ? (
              !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />
            ) : shown.length === 0 ? (
              <p className="empty-state">{t(rentalsFilter.filter === "all" && !rentalsFilter.category ? "others.empty" : "others.noneShown")}</p>
            ) : (
              <ul className="row-list">
                {shown.map((booking) => (
                  <BookingRow key={booking.id} booking={booking} onChange={load} onMessage={setWritingTo} />
                ))}
              </ul>
            )}
          </section>
          <section>
            <div className="part-heading">
              <h2>{t("others.bookmarks")}</h2>
              {kept && <span>{kept.length}</span>}
            </div>
            <KindTabs {...keptFilter} />

            {!kept ? (
              !error && <Skeleton rows={3} lines={2} label={t("common.loading")} />
            ) : kept.length === 0 ? (
              <p className="empty-state">{t(keptFilter.filter === "all" && !keptFilter.category ? "others.noBookmarks" : "others.noneShown")}</p>
            ) : (
              <ul className="row-list">
                {kept.map((item) => (
                  <ItemRow key={item.id} item={item} showOwner />
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      <MessageModal username={writingTo} onClose={() => setWritingTo(null)} />
    </div>
  );
}

// A column's filter, kept in the address under `kindKey` and `categoryKey`
// and leaving the rest of the address as it is: one kind at a time, and
// within it one category ("" for all of them). A kind pressed a second time
// is let go of, and the category with it; All lets go of both. Choosing a
// category chooses the kind it belongs to as well.
function useKindFilter(kindKey, categoryKey) {
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
    pressed: (name) => (name === "all" ? filter === "all" && !category : filter === name),
    setFilter: (name) => (name === "all" || name === filter ? show("all", "") : show(name, category)),
    chooseCategory: (slug) => show((slug && kindOfCategory(slug)) || filter, slug),
  };
}

// The buttons of such a filter: the kinds, and after the last of them the
// category within the one in force.
function KindTabs({ kind, category, pressed, setFilter, chooseCategory }) {
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
