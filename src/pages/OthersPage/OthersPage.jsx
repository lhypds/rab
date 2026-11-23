import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { BookingRow, CategoryFilter, ItemRow, CategoryIcon, Header, MessageModal, categoriesOf, kindOfCategory, useAuth } from "../../components/index.js";
import { Skeleton, useNavigate, useSearchParams } from "../../ui/index.js";
import { KINDS } from "../../utils/kinds.js";

// What the list can be narrowed to: all of it, or one kind of thing.
const FILTERS = ["all", "item", "space", "service"];

// When a rental starts, as text that sorts: its day, then its time — the first
// slot's where it is for slots, the pickup's otherwise.
const startOf = (booking) => `${booking.start} ${booking.slots?.[0]?.start ?? booking.startTime ?? ""}`;

// What is other people's: what you have asked them for, and what became of
// each request — and under that the items you have kept to come back to, your
// bookmarks. What is your own is on /mine.
export default function OthersPage() {
  const { t } = useTranslation();
  const [bookings, setBookings] = useState(null);
  const [bookmarks, setBookmarks] = useState(null);
  const [error, setError] = useState("");
  const [writingTo, setWritingTo] = useState(null);
  // The filter is in the address, so coming back from an item's page lands on
  // the list that was left.
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const wanted = searchParams.get("show");
  const filter = FILTERS.includes(wanted) ? wanted : "all";
  // And within it one category, "" for all of them: one the kind in force
  // does not have is no choice at all.
  const kind = KINDS.includes(filter) ? filter : null;
  const slugWanted = searchParams.get("category") ?? "";
  const category = categoriesOf(kind, Boolean(user?.adult)).includes(slugWanted) ? slugWanted : "";
  const show = (name, slug) => {
    const query = new URLSearchParams();
    if (name !== "all") query.set("show", name);
    if (slug) query.set("category", slug);
    navigate(query.size > 0 ? `/others?${query}` : "/others", { replace: true, scroll: false });
  };
  // A kind pressed a second time is let go of. All is everything: it is
  // pressed while no kind and no category is chosen, and pressing it lets go
  // of both.
  // Choosing a category chooses the kind it belongs to as well, so the kind's
  // button is pressed with it; one that is in every kind leaves the kind alone.
  const chooseCategory = (slug) => show((slug && kindOfCategory(slug)) || filter, slug);
  // Letting go of a kind lets go of the category chosen within it too.
  const setFilter = (name) => (name === "all" || name === filter ? show("all", "") : show(name, category));
  const pressed = (name) => (name === "all" ? filter === "all" && !category : filter === name);

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
      (booking) => (filter === "all" || booking.itemKind === filter) && (!category || booking.itemCategory === category),
    )
    .sort((a, b) => (startOf(a) < startOf(b) ? 1 : startOf(a) > startOf(b) ? -1 : b.id - a.id));
  // The bookmarks, narrowed as the rentals are; the one kept last first, which
  // is how they come.
  const kept = bookmarks?.filter((item) => (filter === "all" || item.kind === filter) && (!category || item.category === category));

  return (
    <div className="page-shell">
      <Header back />
      <main className="list-page">
        <div className="section-heading">
          <h1>{t("others.title")}</h1>
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
              onClick={() => setFilter(name)}
            >
              {/* Each kind leads with its own mark, as on the map. */}
              {name !== "all" && <CategoryIcon kind={name} />}
              {t(`kind.${name}`)}
            </button>
          ))}
          <CategoryFilter kind={kind} value={category} onChange={chooseCategory} />
        </div>

        <div className="part-heading">
          <h2>{t("others.rentals")}</h2>
          {shown && <span>{shown.length}</span>}
        </div>

        {error && <p className="list-error">{error}</p>}

        {!shown ? (
          !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />
        ) : shown.length === 0 ? (
          <p className="empty-state">{t(filter === "all" && !category ? "others.empty" : "others.noneShown")}</p>
        ) : (
          <ul className="row-list">
            {shown.map((booking) => (
              <BookingRow key={booking.id} booking={booking} onChange={load} onMessage={setWritingTo} />
            ))}
          </ul>
        )}

        <div className="part-heading">
          <h2>{t("others.bookmarks")}</h2>
          {kept && <span>{kept.length}</span>}
        </div>

        {!kept ? (
          !error && <Skeleton rows={3} lines={2} label={t("common.loading")} />
        ) : kept.length === 0 ? (
          <p className="empty-state">{t(filter === "all" && !category ? "others.noBookmarks" : "others.noneShown")}</p>
        ) : (
          <ul className="row-list">
            {kept.map((item) => (
              <ItemRow key={item.id} item={item} showOwner />
            ))}
          </ul>
        )}
      </main>

      <MessageModal username={writingTo} onClose={() => setWritingTo(null)} />
    </div>
  );
}
