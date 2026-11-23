import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { CategoryIcon, Header, ItemRow, PageModal, SpotMap, UserName, useAuth } from "../../components/index.js";
import ShareModal from "../../components/ShareModal/index.js";
import { Skeleton, useNavigate } from "../../ui/index.js";
import { formatCoords } from "../../utils/format.js";
import { MAPBOX_TOKEN, directionsUrl } from "../../utils/mapbox.js";
import styles from "./page.module.css";

// One of the pages somebody made of their items: a store of things, a space,
// their services — its name, whose it is, a word about it, where it stands,
// and the items on it, each the way to its own page, where it is booked.
// Its address is the thing to pass around, like an item's.
export default function PagePage({ username, id }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getPage(username, id)
      .then((answer) => !cancelled && setPage(answer.page))
      .catch((requestError) => !cancelled && setError(requestError.status === 404 ? t("page.missing") : requestError.message));
    return () => {
      cancelled = true;
    };
  }, [username, id, t]);

  const own = Boolean(page) && user?.username === page.owner;
  const location = page?.location;
  const url = page ? `${window.location.origin}/u/${encodeURIComponent(page.owner)}/p/${encodeURIComponent(page.id)}` : "";

  return (
    <div className="page-shell">
      <Header back />
      <main className="list-page">
        {error && <p className="empty-state">{error}</p>}
        {!page && !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />}
        {page && (
          <>
            <div className="section-heading">
              <h1>{page.name}</h1>
              <span>
                <CategoryIcon kind={page.kind} /> {t(`page.kinds.${page.kind}`)}
              </span>
            </div>
            <div className={styles.byline}>
              <UserName name={page.owner} />
              <span className={styles.actions}>
                <button type="button" className="small-button filled" onClick={() => setSharing(true)}>
                  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 15V4" />
                    <path d="m8 8 4-4 4 4" />
                    <path d="M5 12v7h14v-7" />
                  </svg>
                  {t("item.share")}
                </button>
                {own && (
                  <button type="button" className="small-button" onClick={() => setEditing(true)}>
                    {t("page.edit")}
                  </button>
                )}
              </span>
            </div>
            {page.description && <p className={styles.about}>{page.description}</p>}

            {location && (
              <>
                <div className="part-heading">
                  <h2>{location.name}</h2>
                  <span>{formatCoords(location.latitude, location.longitude)}</span>
                </div>
                {MAPBOX_TOKEN && (
                  <div className={styles.map}>
                    <SpotMap latitude={location.latitude} longitude={location.longitude} />
                  </div>
                )}
                <p className={styles.access}>
                  <span>{location.address}</span>
                  <a href={directionsUrl(location.latitude, location.longitude)} target="_blank" rel="noreferrer noopener">
                    {t("item.openMaps")}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                </p>
              </>
            )}

            <div className="part-heading">
              <h2>{t(`page.itemsHeading.${page.kind}`)}</h2>
              <span>{page.items.length}</span>
            </div>
            {page.items.length === 0 ? (
              <p className="part-note">{t("page.itemsEmpty")}</p>
            ) : (
              <ul className="row-list">
                {page.items.map((item) => (
                  <ItemRow key={item.id} item={item} showPublished={own} />
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      {own && (
        <PageModal
          isOpen={editing}
          page={page}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setPage(saved);
            setEditing(false);
          }}
          onDeleted={() => navigate(`/u/${encodeURIComponent(page.owner)}`, { replace: true })}
        />
      )}
      {page && <ShareModal isOpen={sharing} onClose={() => setSharing(false)} title={page.name} url={url} slug={page.id} />}
    </div>
  );
}
