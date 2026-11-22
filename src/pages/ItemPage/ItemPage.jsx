import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Header, ItemModal, ItemView, MessageModal, loginPath, useAuth } from "../../components/index.js";
import { Skeleton, showToast, useNavigate, useSearchParams } from "../../ui/index.js";

// How often an open page asks again where things stand. An item's page is what
// both sides of a rental come back to for the answer, so it keeps itself
// current rather than waiting to be reloaded.
const REFRESH_MS = 30 * 1000;

// An item's own page, and the one thing in rab made to be sent to somebody.
// This is the half that talks to the server; what is on the page is ItemView's.
export default function ItemPage({ id }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  // The part of the item's form that is open: "item", "availability", or null.
  const [editing, setEditing] = useState(null);
  const [writingTo, setWritingTo] = useState(null);

  const load = useCallback(() => {
    return api
      .getItem(id)
      .then((answer) => {
        setData(answer);
        setError("");
      })
      .catch((requestError) => {
        // A page already on screen stays on screen through a request that
        // failed; only the first one has nothing else to show.
        setData((current) => {
          if (!current) setError(requestError.status === 404 ? t("item.missing") : requestError.message);
          return current;
        });
      });
  }, [id, t]);

  // Asked again when the account changes: the same page is a different answer
  // to its owner, to somebody renting it, and to a stranger.
  const username = user?.username ?? null;
  useEffect(() => {
    load();
  }, [load, username]);

  useEffect(() => {
    const ask = () => {
      if (!document.hidden) load();
    };
    const timer = window.setInterval(ask, REFRESH_MS);
    document.addEventListener("visibilitychange", ask);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [load]);

  const item = data?.item ?? null;

  useEffect(() => {
    if (item) document.title = `${item.title} — rab`;
    return () => {
      document.title = "rab";
    };
  }, [item]);

  const keep = (answer) => setData({ item: answer.item, calendar: answer.calendar, bookings: answer.bookings });

  async function book(request) {
    try {
      keep(await api.requestBooking(item.id, request));
      showToast(t("booking.requested"), 2400);
    } catch (requestError) {
      // Somebody else got there first: the calendar on screen is out of date.
      if (requestError.code === "DAYS_UNAVAILABLE") load();
      throw requestError;
    }
  }

  return (
    <div className="page-shell">
      <Header back />
      <main className="wide-page">
        {!item ? (
          error ? (
            <p className="empty-state">{error}</p>
          ) : (
            <Skeleton rows={5} lines={2} label={t("common.loading")} />
          )
        ) : (
          <ItemView
            item={item}
            calendar={data.calendar}
            bookings={data.bookings}
            reviews={data.reviews}
            viewer={user}
            focusBooking={searchParams.get("book") === "1"}
            onBook={book}
            // Switched off or on, the page is asked for again: its calendar
            // and what it says of itself both turn on it.
            onSetActive={async (active) => {
              await api.updateItem(item.id, { active });
              await load();
            }}
            onEdit={() => setEditing("item")}
            onEditAvailability={() => setEditing("availability")}
            onMessage={setWritingTo}
            onBookingChange={load}
            onSignIn={() => navigate(loginPath())}
            signInPath={loginPath()}
          />
        )}
      </main>

      {item?.mine && (
        <ItemModal
          isOpen={Boolean(editing)}
          // Which of the form's two sheets: the item, or when it can be had.
          part={editing || "item"}
          item={item}
          calendar={data.calendar}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onDeleted={() => {
            setEditing(null);
            showToast(t("item.deleted"), 1800);
            navigate("/mine", { replace: true });
          }}
        />
      )}
      <MessageModal username={writingTo} onClose={() => setWritingTo(null)} />
    </div>
  );
}
