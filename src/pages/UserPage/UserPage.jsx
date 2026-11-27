import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListView } from "../../components/ListView.jsx";
import { ItemCard } from "../../components/Rows/index.js";
import SpotList from "../../components/SpotList.jsx";
import * as api from "../../api.js";
import { Header, ItemRow, CategoryTabs, MessageModal, Rating, loginPath, useAuth, useCategoryFilter } from "../../components/index.js";
import { ActionButton, Skeleton, useLocation, useNavigate, useSearchParams } from "../../ui/index.js";
import { formatDate, formatUsername } from "../../utils/format.js";

// The two things somebody has, in the order they stand down the left of the
// page: their spots, and their items.
const TABS = ["spots", "items"];

// Who somebody is: how the people they have dealt with rate them, all the
// pages they have — their default page, which every account has from the
// first, and those they made of their items — what they have out for rent,
// what was said about them, and the way to write to them. A new page is made
// from the bar's Publish, as a new item is. Laid out as Mine is: what they
// have down the left, and the one picked on the right.
export default function UserPage({ username }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  // What their items are narrowed to, in the address as on the other lists.
  const itemsFilter = useCategoryFilter();

  useEffect(() => {
    let cancelled = false;
    api
      .getUser(username)
      .then((answer) => {
        if (!cancelled) setData(answer);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.status === 404 ? t("user.missing") : requestError.message);
      });
    return () => {
      cancelled = true;
    };
  }, [username, t]);

  // The two things of theirs, down the left, and the one of them shown on the
  // right. Which one is in the address, so a step back from an item's page
  // lands on the list that was left.
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const tabWanted = searchParams.get("tab");
  const tab = TABS.includes(tabWanted) ? tabWanted : TABS[0];
  const choose = (name) => {
    const query = new URLSearchParams(searchParams);
    if (name === TABS[0]) query.delete("tab");
    else query.set("tab", name);
    navigate(query.size > 0 ? `${pathname}?${query}` : pathname, { replace: true, scroll: false });
  };
  const counts = { spots: data?.spots?.length ?? 0, items: data?.items?.length ?? 0 };
  const labels = { spots: t("spot.title"), items: t("user.items") };
  const { cards, viewPair } = useListView();

  const own = user?.username === data?.user.username;
  const items = (data?.items ?? []).filter((item) => itemsFilter.fits(item.category));

  return (
    <div className="page-shell">
      <Header back />
      <main className="wide-page user-page">
        {error && <p className="empty-state">{error}</p>}
        {!data && !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />}
        {data && (
          <>
            <div className="section-heading">
              <h1>{formatUsername(data.user.username)}</h1>
              <span>{t("user.joined", { date: formatDate(data.user.createdAt, i18n.language) })}</span>
            </div>
            {/* The rating: the mean of the stars they were given once a
                booking was complete, and how many times — five empty stars
                where nobody has rated them yet. Pressing it opens what was
                said, in a sheet. */}
            <div className="user-rating">
              <Rating rating={data.rating} reviews={data.reviews} />
              {/* The way to write to them, at the right of the same line. */}
              {!own && (
                <ActionButton
                  tooltip={t("messages.write", { name: formatUsername(data.user.username) })}
                  tooltipRight
                  onClick={() => (user ? setWriting(true) : navigate(loginPath()))}
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M3 6h18v12H3z" />
                    <path d="m3 7 9 6 9-6" />
                  </svg>
                </ActionButton>
              )}
            </div>

            {/* The same two parts as Mine: down the left the things they
                have — their spots, and their items — and on the right the
                one picked, as rows or as cards. On a narrow screen the two
                are a row over it. */}
            <div className="mine-layout">
              <nav className="mine-nav" aria-label={formatUsername(data.user.username)}>
                {TABS.map((name) => (
                  <button key={name} type="button" className={tab === name ? "mine-nav-item active" : "mine-nav-item"} aria-current={tab === name ? "page" : undefined} onClick={() => choose(name)}>
                    <span>{labels[name]}</span>
                    <span className="mine-nav-count">{counts[name]}</span>
                  </button>
                ))}
              </nav>

              <section className="mine-pane">
                {/* Their spots, each the way to itself: the default one first
                    — there is always that one — then the rest as they were
                    made. */}
                {tab === "spots" && <SpotList spots={data.spots} username={username} cards={cards} beside={viewPair} />}

                {/* Their items, with what they are narrowed to above them. */}
                {tab === "items" && (
                  <>
                    <div className="part-heading">
                      <span className="part-head">
                        <h2>{t("user.items")}</h2>
                        {viewPair}
                      </span>
                      <span>{items.length}</span>
                    </div>
                    <CategoryTabs {...itemsFilter} />
                    {items.length === 0 ? (
                      <p className="empty-state">{t(itemsFilter.everything ? "user.itemsEmpty" : "user.noneShown")}</p>
                    ) : cards ? (
                      <ul className="item-cards">
                        {items.map((item) => (
                          <ItemCard key={item.id} item={item} />
                        ))}
                      </ul>
                    ) : (
                      <ul className="row-list">
                        {items.map((item) => (
                          <ItemRow key={item.id} item={item} />
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      <MessageModal username={writing ? data?.user.username : null} onClose={() => setWriting(false)} />
    </div>
  );
}
