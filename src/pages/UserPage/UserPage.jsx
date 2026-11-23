import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { CategoryIcon, Header, ItemRow, MessageModal, PageModal, Rating, dotted, loginPath, useAuth } from "../../components/index.js";
import { ActionButton, Link, Skeleton, useNavigate } from "../../ui/index.js";
import { formatDate, formatUsername } from "../../utils/format.js";

// Who somebody is: how the people they have dealt with rate them, the pages
// they made of their items — a store, a space, their services — what they
// have out for rent, what was said about them, and the way to write to them.
// Their own page is where a new page is made.
export default function UserPage({ username }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  const [making, setMaking] = useState(false);

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

  return (
    <div className="page-shell">
      <Header back />
      <main className="list-page">
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

            {/* The pages they made, each the way to itself; and on their own,
                the way to make another. */}
            {(own || data.pages.length > 0) && (
              <>
                <div className="part-heading">
                  <h2>{t("page.title")}</h2>
                  {own ? (
                    <button type="button" className="small-button" onClick={() => setMaking(true)}>
                      {t("page.new")}
                    </button>
                  ) : (
                    <span>{data.pages.length}</span>
                  )}
                </div>
                {data.pages.length === 0 ? (
                  <p className="part-note">{t("page.empty")}</p>
                ) : (
                  <ul className="row-list">
                    {data.pages.map((page) => (
                      <li key={page.id} className="row-item">
                        <div className="row">
                          <Link className="row-copy" to={`/u/${encodeURIComponent(data.user.username)}/p/${encodeURIComponent(page.id)}`} state={{ back: true }}>
                            {page.thumb && <img className="row-thumb" src={page.thumb} alt="" width="40" height="40" loading="lazy" />}
                            <span className="row-lines">
                              <strong>{page.name}</strong>
                              <span className="row-meta">
                                {dotted([
                                  <>
                                    <CategoryIcon kind={page.kind} /> {t(`page.kinds.${page.kind}`)}
                                  </>,
                                  t("page.count", { count: page.count }),
                                  page.location?.address || page.location?.name,
                                ])}
                              </span>
                            </span>
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            <div className="part-heading">
              <h2>{t("user.items")}</h2>
              <span>{data.items.length}</span>
            </div>
            {data.items.length === 0 ? (
              <p className="empty-state">{t("user.itemsEmpty")}</p>
            ) : (
              <ul className="row-list">
                {data.items.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      <MessageModal username={writing ? data?.user.username : null} onClose={() => setWriting(false)} />
      {own && (
        <PageModal
          isOpen={making}
          page={null}
          onClose={() => setMaking(false)}
          onSaved={(page) => navigate(`/u/${encodeURIComponent(page.owner)}/p/${encodeURIComponent(page.id)}`)}
        />
      )}
    </div>
  );
}
