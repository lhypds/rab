import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { BookingRow, Header, ItemRow, MessageModal } from "../../components/index.js";
import { Skeleton, useNavigate, useSearchParams } from "../../ui/index.js";

// What is out for rent, a tab for each kind of it — things, spaces, services —
// and then the requests for any of it.
const KINDS = ["item", "space", "service"];
const TABS = [...KINDS, "requests"];

// What you have out for rent, and who has asked for any of it.
export default function MinePage() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  // The tab is in the address, so coming back from an item's page lands on
  // the list that was left.
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const asked = searchParams.get("tab");
  const tab = TABS.includes(asked) ? asked : null;
  const setTab = (name) => navigate(`/mine?tab=${name}`, { replace: true, scroll: false });
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
  const ofKind = (kind) => data?.items.filter((item) => (item.kind || "item") === kind) ?? [];
  const counts = { requests: waiting };
  for (const kind of KINDS) counts[kind] = ofKind(kind).length;
  // Otherwise on the first kind there is anything of.
  const shown = tab ?? (waiting > 0 ? "requests" : (KINDS.find((kind) => counts[kind] > 0) ?? "item"));
  const rows = shown === "requests" ? (data?.requests ?? []) : ofKind(shown);

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
              {name === "requests" ? t("mine.requests") : t(`kind.${name}`)}
              {counts[name] > 0 && <small>{counts[name]}</small>}
            </button>
          ))}
        </div>

        {error && <p className="list-error">{error}</p>}

        {!data ? (
          !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />
        ) : rows.length === 0 ? (
          <p className="empty-state">{t(shown === "requests" ? "mine.requestsEmpty" : "mine.itemsEmpty")}</p>
        ) : (
          <ul className="row-list">
            {shown === "requests"
              ? rows.map((booking) => (
                  <BookingRow key={booking.id} booking={booking} onChange={load} onMessage={setWritingTo} />
                ))
              : rows.map((item) => <ItemRow key={item.id} item={item} showPublished />)}
          </ul>
        )}
      </main>

      <MessageModal username={writingTo} onClose={() => setWritingTo(null)} />
    </div>
  );
}
