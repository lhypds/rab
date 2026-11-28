import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SpotList from "../../components/SpotList.jsx";
import * as api from "../../api.js";
import { ItemCard } from "../../components/Rows/index.js";
import { BookingRow, CategoryFilter, CategoryTabs, categoriesOf, Header, ItemRow, MessageModal, useAuth, useCategoryFilter } from "../../components/index.js";
import ItemPreview from "../../components/ItemPreview/index.js";
import { useListView } from "../../components/ListView.jsx";
import RequestModal, { RequestView } from "../../components/RequestModal/index.js";
import { Modal, Skeleton, showToast, useNavigate, useSearchParams } from "../../ui/index.js";

// What the list of your items can be narrowed to: only what is published, on
// or off, and one category. "All" is none of that: it is pressed while nothing
// else is, and pressing it lets go of the rest.
const FILTERS = ["all", "published"];

// The five things that are an account's, in the order they stand down the
// left of the page.
const TABS = ["items", "spots", "requests", "rentals", "bookmarks"];

// When a booking starts, as text that sorts: its day, then its time — the first
// slot's where it is for slots, the pickup's otherwise.
const startOf = (booking) => `${booking.start} ${booking.slots?.[0]?.start ?? booking.startTime ?? ""}`;

// Everything that is the account's, on one page, in two parts: down the left
// the five things it has — what it has out, its spots, what it is looking for, what it has asked
// other people for and what became of each, and the items it has kept to come
// back to, its bookmarks — and on the right the one of them picked, as rows or
// as cards with their photographs. An item
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

  // An item or a spot — your own, or one you kept — looked at without leaving
  // the list: its page, on a sheet over this one (see ItemPreview), by its
  // id. A press meant for a new tab or window is left to go to the page.
  const [previewId, setPreviewId] = useState(null);
  const preview = (item, event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setPreviewId(item.id);
  };
  // What you kept, asked for again: one let go of on the sheet is off the list.
  const loadBookmarks = useCallback(() => {
    api
      .getBookmarks()
      .then((answer) => setBookmarks(answer.items))
      .catch((requestError) => setError(requestError.message));
  }, []);

  // One of your own requests ("I need"), opened on a sheet from its row.
  const [viewing, setViewing] = useState(null);
  // And the one being changed, on the form.
  const [editingRequest, setEditingRequest] = useState(null);
  const openRequest = (request, event) => {
    event.preventDefault();
    setViewing(request);
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

  // Several of your items picked at once, to be deleted together. A press
  // held on one picks it; while any is picked a press picks or lets go of
  // another instead of opening it; and a press with Shift held picks every
  // one from the last one pressed to this one, whether any was picked or not.
  // Only the ones the list is showing count: one filtered out is not picked.
  const [pickedIds, setPickedIds] = useState([]);
  const anchor = useRef(null);
  const picked = pickedIds.filter((id) => items.some((item) => item.id === id));
  const picking = picked.length > 0;
  const unpick = () => {
    setPickedIds([]);
    anchor.current = null;
  };
  const hold = (item) => {
    anchor.current = item.id;
    setPickedIds([...picked.filter((id) => id !== item.id), item.id]);
  };
  const pressItem = (item, event) => {
    // A press meant for a new tab is still left to go to the page.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.shiftKey) {
      event.preventDefault();
      const from = items.findIndex((each) => each.id === anchor.current);
      const to = items.findIndex((each) => each.id === item.id);
      const run = from < 0 ? [item.id] : items.slice(Math.min(from, to), Math.max(from, to) + 1).map((each) => each.id);
      if (from < 0) anchor.current = item.id;
      setPickedIds([...picked.filter((id) => !run.includes(id)), ...run]);
      return;
    }
    if (!picking) return preview(item, event);
    event.preventDefault();
    anchor.current = item.id;
    setPickedIds(picked.includes(item.id) ? picked.filter((id) => id !== item.id) : [...picked, item.id]);
  };
  // Escape lets go of them all — unless a sheet is open, which it closes.
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!picking || deleting || previewId) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") unpick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, deleting, previewId]);
  // Deleted one after another; where one cannot be, the rest are left, and
  // the list is asked for again to say which are still there.
  const deletePicked = async () => {
    setBusy(true);
    let gone = 0;
    try {
      for (const id of picked) {
        await api.deleteItem(id);
        gone += 1;
      }
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
      setDeleting(false);
      unpick();
      if (gone > 0) showToast(t("mine.deletedPicked", { count: gone }), 1800);
      load();
    }
  };

  // The five things that are yours, down the left, and the one of them shown
  // on the right. Which one is in the address, so a step back from an item's
  // page lands on the list that was left.
  const tabWanted = searchParams.get("tab");
  const tab = TABS.includes(tabWanted) ? tabWanted : TABS[0];
  const choose = (name) => {
    const query = new URLSearchParams(searchParams);
    if (name === TABS[0]) query.delete("tab");
    else query.set("tab", name);
    navigate(query.size > 0 ? `/mine?${query}` : "/mine", { replace: true, scroll: false });
  };
  const counts = { items: data?.items?.length, spots: data?.spots?.length, requests: data?.wanted?.length, rentals: data?.bookings?.length, bookmarks: bookmarks?.length };
  const labels = { items: t("mine.items"), spots: t("spot.title"), requests: t("mine.wanted"), rentals: t("others.rentals"), bookmarks: t("others.bookmarks") };
  // How the one on the right is drawn: rows, or cards with their photographs.
  // Kept by the browser, the same for every one of them. What you have booked
  // is always rows: each has things to press that a card has no room for.
  const { cards, viewPair } = useListView();

  return (
    <div className="page-shell">
      <Header back />
      <main className="wide-page mine-page">
        <div className="section-heading">
          <h1>{t("mine.title")}</h1>
        </div>

        {error && <p className="list-error">{error}</p>}

        <div className="mine-layout">
          <nav className="mine-nav" aria-label={t("mine.title")}>
            {TABS.map((name) => (
              <button key={name} type="button" className={tab === name ? "mine-nav-item active" : "mine-nav-item"} aria-current={tab === name ? "page" : undefined} onClick={() => choose(name)}>
                <span>{labels[name]}</span>
                {counts[name] != null && <span className="mine-nav-count">{counts[name]}</span>}
              </button>
            ))}
          </nav>

          <section className="mine-pane">
            {tab === "items" && (
              <>
                <div className="part-heading">
                  <span className="part-head">
                    <h2>{t("mine.items")}</h2>
                    {viewPair}
                  </span>
                  {/* With some picked: how many, the way to let go of them,
                      and the button that deletes them — in place of the
                      count of the whole list. */}
                  {picking ? (
                    <span className="pick-bar">
                      <span>{t("mine.picked", { count: picked.length })}</span>
                      <button type="button" className="pick-button" onClick={unpick}>
                        {t("common.cancel")}
                      </button>
                      <button type="button" className="pick-button pick-delete" onClick={() => setDeleting(true)}>
                        {t("item.delete")}
                      </button>
                    </span>
                  ) : (
                    data && <span>{items.length}</span>
                  )}
                </div>

                {/* What the list below is narrowed to: published or not, and
                    the category. */}
                <div className="tabs" role="group">
                  {FILTERS.map((name) => (
                    <button key={name} type="button" aria-pressed={pressed(name)} className={pressed(name) ? "tab active" : "tab"} onClick={() => press(name)}>
                      {name === "published" ? t("item.published") : t("map.all")}
                    </button>
                  ))}
                  <CategoryFilter value={category} onChange={chooseCategory} />
                </div>

                {!data && !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />}
                {data &&
                  (items.length === 0 ? (
                    <p className="empty-state">{t(!category && !published ? "mine.itemsEmpty" : "mine.noneShown")}</p>
                  ) : cards ? (
                    <ul className={picking ? "item-cards picking" : "item-cards"}>
                      {items.map((item) => (
                        <ItemCard key={item.id} item={item} showPublished picked={picked.includes(item.id)} onHold={() => hold(item)} onPress={(event) => pressItem(item, event)} />
                      ))}
                    </ul>
                  ) : (
                    <ul className={picking ? "row-list picking" : "row-list"}>
                      {items.map((item) => (
                        <ItemRow key={item.id} item={item} showPublished picked={picked.includes(item.id)} onHold={() => hold(item)} onPress={(event) => pressItem(item, event)} />
                      ))}
                    </ul>
                  ))}
              </>
            )}

            {tab === "spots" && (data ? <SpotList spots={data.spots} username={user.username} filterable cards={cards} beside={viewPair} onPress={preview} /> : !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />)}

            {/* What you are looking for. Here they can be taken down — the
                ones whose dates have gone as well. */}
            {tab === "requests" && (
              <>
                <div className="part-heading">
                  <span className="part-head">
                    <h2>{t("mine.wanted")}</h2>
                    {viewPair}
                  </span>
                  {data && <span>{data.wanted?.length ?? 0}</span>}
                </div>
                {!data ? (
                  !error && <Skeleton rows={3} lines={2} label={t("common.loading")} />
                ) : !data.wanted?.length ? (
                  <p className="empty-state">{t("mine.wantedEmpty")}</p>
                ) : cards ? (
                  <ul className="item-cards">
                    {data.wanted.map((request) => (
                      <ItemCard key={request.id} item={request} onPress={(event) => openRequest(request, event)} />
                    ))}
                  </ul>
                ) : (
                  <ul className="row-list">
                    {data.wanted.map((request) => (
                      <ItemRow key={request.id} item={request} onPress={(event) => openRequest(request, event)} />
                    ))}
                  </ul>
                )}
              </>
            )}

            {tab === "rentals" && (
              <>
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
              </>
            )}

            {tab === "bookmarks" && (
              <>
                <div className="part-heading">
                  <span className="part-head">
                    <h2>{t("others.bookmarks")}</h2>
                    {viewPair}
                  </span>
                  {kept && <span>{kept.length}</span>}
                </div>
                <CategoryTabs {...keptFilter} />

                {!kept ? (
                  !error && <Skeleton rows={3} lines={2} label={t("common.loading")} />
                ) : kept.length === 0 ? (
                  <p className="empty-state">{t(keptFilter.everything ? "others.noBookmarks" : "others.noneShown")}</p>
                ) : cards ? (
                  <ul className="item-cards">
                    {kept.map((item) => (
                      <ItemCard key={item.id} item={item} onPress={(event) => preview(item, event)} />
                    ))}
                  </ul>
                ) : (
                  <ul className="row-list">
                    {kept.map((item) => (
                      <ItemRow key={item.id} item={item} showOwner onPress={(event) => preview(item, event)} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        </div>
      </main>
      <MessageModal username={writingTo} onClose={() => setWritingTo(null)} />
      {/* Asked before the ones picked are deleted, as for one on its page. */}
      <Modal isOpen={deleting} title={t("item.delete")} onClose={busy ? undefined : () => setDeleting(false)} closeOnOverlay>
        <p className="modal-text">{t("mine.deletePickedConfirm", { count: picked.length })}</p>
        <div className="modal-actions">
          <button type="button" className="outline-button" disabled={busy} onClick={() => setDeleting(false)}>
            {t("common.cancel")}
          </button>
          <button type="button" className="primary-button danger-button" disabled={busy} onClick={deletePicked}>
            {t("item.delete")}
          </button>
        </div>
      </Modal>
      {/* An item or a spot opened from its row, on a sheet over the list.
          Whatever was done to it there — changed, published, deleted, let go
          of — the lists are asked for again once the sheet is put away. */}
      <ItemPreview
        id={previewId}
        onClose={() => {
          setPreviewId(null);
          load();
          loadBookmarks();
        }}
        // Saved from the form opened on the sheet: the sheet again.
        onOpen={setPreviewId}
        onGone={() => {
          load();
          loadBookmarks();
        }}
      />
      <RequestView
        request={viewing}
        onClose={() => setViewing(null)}
        // Changed from its sheet: the sheet is put away and the form opened.
        onEdit={(request) => {
          setViewing(null);
          setEditingRequest(request);
        }}
        onGone={(gone) => {
          setData((current) => current && { ...current, wanted: current.wanted.filter((request) => request.id !== gone) });
          setViewing(null);
        }}
      />
      {/* The form on one of your requests: saved, it takes the old one's
          place in the list. */}
      <RequestModal
        isOpen={Boolean(editingRequest)}
        request={editingRequest}
        onClose={() => setEditingRequest(null)}
        onSaved={(saved) => {
          setEditingRequest(null);
          setData((current) => current && { ...current, wanted: current.wanted.map((request) => (request.id === saved.id ? saved : request)) });
        }}
      />
    </div>
  );
}
