import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import StoreList from "../../components/StoreList.jsx";
import * as api from "../../api.js";
import { Header, ItemRow, CategoryTabs, MessageModal, Rating, loginPath, useAuth, useCategoryFilter } from "../../components/index.js";
import { ActionButton, Skeleton, useNavigate } from "../../ui/index.js";
import { formatDate, formatUsername } from "../../utils/format.js";

// Who somebody is: how the people they have dealt with rate them, all the
// pages they have — their default page, which every account has from the
// first, and those they made of their items — what they have out for rent,
// what was said about them, and the way to write to them. A new page is made
// from the bar's Publish, as a new item is.
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

            {/* Their pages on the left, each the way to itself: the default one
                first — there is always that one — then the rest as they were
                made. Their items on the right, with what they are narrowed to
                above them. On a narrow screen the items come after the pages. */}
            <div className="others-columns">
              <section>
                <StoreList stores={data.stores} username={username} />
              </section>

              <section>
                <div className="part-heading">
                  <h2>{t("user.items")}</h2>
                  <span>{items.length}</span>
                </div>
                <CategoryTabs {...itemsFilter} />
                {items.length === 0 ? (
                  <p className="empty-state">{t(itemsFilter.everything ? "user.itemsEmpty" : "user.noneShown")}</p>
                ) : (
                  <ul className="row-list">
                    {items.map((item) => (
                      <ItemRow key={item.id} item={item} />
                    ))}
                  </ul>
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
