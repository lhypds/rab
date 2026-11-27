import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import StoreList from "../../components/StoreList.jsx";
import * as api from "../../api.js";
import { BookingRow, CategoryFilter, CategoryTabs, categoriesOf, Header, ItemRow, MessageModal, useAuth, useCategoryFilter } from "../../components/index.js";
import { RequestView } from "../../components/RequestModal/index.js";
import { Skeleton, showToast, useNavigate, useSearchParams } from "../../ui/index.js";

// What the list of your items can be narrowed to: only what is published, on
// or off, and one category. "All" is none of that: it is pressed while nothing
// else is, and pressing it lets go of the rest.
const FILTERS = ["all", "published"];

// When a booking starts, as text that sorts: its day, then its time — the first
// slot's where it is for slots, the pickup's otherwise.
const startOf = (booking) => `${booking.start} ${booking.slots?.[0]?.start ?? booking.startTime ?? ""}`;

// Everything that is the account's, on one page: what it has out, and its
// pages; under those, what it has asked other people for and what became of
// each, and the items it has kept to come back to — its bookmarks. (The last
// two were once a page of their own, /others.) An item
// somebody is waiting on an answer about stands at the top of its list — the
// one asked about first, first — and its row says how many are waiting; the
// answer is given on the item's own page.
export default function MinePage() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  // The filter is in the address, so coming back from an item's page lands on
  // the list that was left.
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const published = searchParams.get("published") === "1";
  const slugWanted = searchParams.get("category") ?? "";
  const category = categoriesOf(Boolean(user?.adult)).includes(slugWanted) ? slugWanted : "";
  // The other lists' filters are in the address too, and are left as they are.
  const show = (slug, onlyPublished) => {
    const query = new URLSearchParams(searchParams);
    if (onlyPublished) query.set("published", "1");
    else query.delete("published");
    if (slug) query.set("category", slug);
    else query.delete("category");
    navigate(query.size > 0 ? `/mine?${query}` : "/mine", { replace: true, scroll: false });
  };
  const chooseCategory = (slug) => show(slug, published);
  // Published is a switch of its own; All lets go of it and the category.
  const press = (name) => (name === "published" ? show(category, !published) : show("", false));
  const pressed = (name) => (name === "published" ? published : !published && !category);

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

  // What you have kept to come back to, asked for apart: it is a list of its
  // own on the server.
  const [bookmarks, setBookmarks] = useState(null);
  useEffect(() => {
    api
      .getBookmarks()
      .then((answer) => setBookmarks(answer.items))
      .catch((requestError) => setError(requestError.message));
  }, []);
  // Each of the two lists below has a filter of its own, in the address.
  const bookedFilter = useCategoryFilter("bookedCategory");
  const keptFilter = useCategoryFilter("keptCategory");
  // The one booked last at the top: by when it is for, latest first, and
  // where two are for the same time, the one asked for later.
  const booked = data?.bookings
    ?.filter((booking) => bookedFilter.fits(booking.itemCategory))
    .sort((a, b) => (startOf(a) < startOf(b) ? 1 : startOf(a) > startOf(b) ? -1 : b.id - a.id));
  const kept = bookmarks?.filter((item) => keptFilter.fits(item.category));
  const [writingTo, setWritingTo] = useState(null);

  // One of your own requests ("I need"), opened on a sheet from its row.
  const [viewing, setViewing] = useState(null);

  // An item of yours dragged from the list on the right onto one of your pages
  // on the left is put on that page.
  const [carried, setCarried] = useState(null);
  const carry = (item, event) => {
    if (!event) return setCarried(null);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", item.title);
    setCarried(item);
  };
  const putOnStore = async (store) => {
    const item = carried;
    setCarried(null);
    if (!item) return;
    try {
      const answer = await api.addToStore(store.id, item.id);
      setData((current) => current && { ...current, stores: current.stores.map((each) => (each.id === store.id ? { ...each, ...answer.store } : each)) });
      showToast(t(answer.added ? "store.added" : "store.alreadyOn", { name: store.title }), 2000);
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
  const fits = (item) => (!published || item.active) && (!category || item.category === category);
  const items = (data?.items ?? []).filter(fits).sort((a, b) => turn(a) - turn(b));

  return (
    <div className="page-shell">
      <Header back />
      <main className="wide-page mine-page">
        <div className="section-heading">
          <h1>{t("mine.title")}</h1>
        </div>

        {/* Your items on the left, with what they are narrowed to above
            them; your spots on the right. On a narrow screen the spots come
            after the items. */}
        <div className="others-columns">
          <section>
            <div className="part-heading">
              <h2>{t("mine.items")}</h2>
              {data && <span>{items.length}</span>}
            </div>

            {/* What the list below is narrowed to: published or not, and the
                category. */}
            <div className="tabs" role="group">
              {FILTERS.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={pressed(name)}
                  className={pressed(name) ? "tab active" : "tab"}
                  onClick={() => press(name)}
                >
                  {name === "published" ? t("item.published") : t("map.all")}
                </button>
              ))}
              <CategoryFilter value={category} onChange={chooseCategory} />
            </div>

            {error && <p className="list-error">{error}</p>}
            {!data && !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />}
            {data &&
              (items.length === 0 ? (
                <p className="empty-state">{t(!category && !published ? "mine.itemsEmpty" : "mine.noneShown")}</p>
              ) : (
                <ul className="row-list">
                  {items.map((item) => (
                    <ItemRow key={item.id} item={item} showPublished onDrag={item.shared ? undefined : (event) => carry(item, event)} />
                  ))}
                </ul>
              ))}

            {/* What you are looking for, under what you offer: shown only
                once there is one. Here they can be taken down — the ones
                whose dates have gone as well. */}
            {data?.wanted?.length > 0 && (
              <>
                <div className="part-heading">
                  <h2>{t("mine.wanted")}</h2>
                  <span>{data.wanted.length}</span>
                </div>
                <ul className="row-list">
                  {data.wanted.map((request) => (
                    <ItemRow
                      key={request.id}
                      item={request}
                      onPress={(event) => {
                        event.preventDefault();
                        setViewing(request);
                      }}
                    />
                  ))}
                </ul>
              </>
            )}
          </section>

          <section>
            {data && <StoreList stores={data.stores} username={user.username} filterable carried={carried} onDropItem={putOnStore} />}
          </section>
        </div>

        {/* Under what is yours, what is other people's: what you have asked
            them for on the left, what you have kept on the right. */}
        <div className="others-columns">
          <section>
            <div className="part-heading">
              <h2>{t("others.rentals")}</h2>
              {booked && <span>{booked.length}</span>}
            </div>
            <CategoryTabs {...bookedFilter} />

            {!booked ? (
              !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />
            ) : booked.length === 0 ? (
              <p className="empty-state">{t(bookedFilter.everything ? "others.empty" : "others.noneShown")}</p>
            ) : (
              <ul className="row-list">
                {booked.map((booking) => (
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
            <CategoryTabs {...keptFilter} />

            {!kept ? (
              !error && <Skeleton rows={3} lines={2} label={t("common.loading")} />
            ) : kept.length === 0 ? (
              <p className="empty-state">{t(keptFilter.everything ? "others.noBookmarks" : "others.noneShown")}</p>
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
      <RequestView
        request={viewing}
        onClose={() => setViewing(null)}
        onGone={(gone) => {
          setData((current) => current && { ...current, wanted: current.wanted.filter((request) => request.id !== gone) });
          setViewing(null);
        }}
      />
    </div>
  );
}
