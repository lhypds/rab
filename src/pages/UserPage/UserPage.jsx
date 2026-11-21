import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Header, ItemRow, MessageModal, loginPath, useAuth } from "../../components/index.js";
import { Skeleton, useNavigate } from "../../ui/index.js";
import { formatDate, formatUsername } from "../../utils/format.js";

// Who somebody is: the line they wrote about themselves, what they have out
// for rent, and the way to write to them.
export default function UserPage({ username }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);

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
            {!own && (
              <p style={{ margin: "14px 0 0" }}>
                <button
                  type="button"
                  className="small-button"
                  onClick={() => (user ? setWriting(true) : navigate(loginPath()))}
                >
                  {t("messages.write", { name: formatUsername(data.user.username) })}
                </button>
              </p>
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
    </div>
  );
}
