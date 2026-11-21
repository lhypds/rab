import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { BookingRow, Header, ItemRow, MessageModal } from "../../components/index.js";
import { Skeleton } from "../../ui/index.js";

const TABS = ["items", "requests"];

// What you have out for rent, and who has asked for any of it.
export default function MinePage() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(null);
  const [writingTo, setWritingTo] = useState(null);

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

  // The page opens on the requests where one is waiting on an answer, since
  // that is the one thing here somebody else is waiting for.
  const waiting = data?.requests.filter((booking) => booking.status === "pending").length ?? 0;
  const shown = tab ?? (waiting > 0 ? "requests" : "items");
  const counts = { items: data?.items.length ?? 0, requests: waiting };
  const rows = data?.[shown] ?? [];

  return (
    <div className="page-shell">
      <Header back />
      <main className="list-page">
        <div className="section-heading">
          <h1>{t("mine.title")}</h1>
        </div>

        <div className="tabs" role="tablist">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={shown === name}
              className={shown === name ? "tab active" : "tab"}
              onClick={() => setTab(name)}
            >
              {t(`mine.${name}`)}
              {counts[name] > 0 && <small>{counts[name]}</small>}
            </button>
          ))}
        </div>

        {error && <p className="list-error">{error}</p>}

        {!data ? (
          !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />
        ) : rows.length === 0 ? (
          <p className="empty-state">{t(`mine.${shown}Empty`)}</p>
        ) : (
          <ul className="row-list">
            {shown === "items"
              ? rows.map((item) => <ItemRow key={item.id} item={item} />)
              : rows.map((booking) => (
                  <BookingRow key={booking.id} booking={booking} onChange={load} onMessage={setWritingTo} />
                ))}
          </ul>
        )}
      </main>

      <MessageModal username={writingTo} onClose={() => setWritingTo(null)} />
    </div>
  );
}
