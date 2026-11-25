import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Header, ItemModal, ItemView, MessageModal, loginPath, useAuth } from "../../components/index.js";
import StoreItemsModal from "../../components/StoreItemsModal/index.js";
import { Skeleton, showToast, useLocation, useNavigate, useSearchParams } from "../../ui/index.js";
import { itemPath } from "../../utils/stores.js";
import { isAdmin } from "../../utils/admin.js";

// How often an open page asks again where things stand. An item's page is what
// both sides of a rental come back to for the answer, so it keeps itself
// current rather than waiting to be reloaded.
const REFRESH_MS = 30 * 1000;

// An item's own page, and the one thing in rab made to be sent to somebody.
// This is the half that talks to the server; what is on the page is ItemView's.
// A page of somebody's items is an item too, opened here at its own address
// (/u/<owner>/p/<id>), with the items on it under it.
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
  const [choosing, setChoosing] = useState(false);
  const { pathname } = useLocation();

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
          if (!current) setError(requestError.status === 404 ? t("item.missing") : requestError.code === "AGE_REQUIRED" ? t("item.ageRequired") : requestError.message);
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

  // Opened at an address that is not its own — a page at /i/<id>, or by the
  // id it had before ids were times — the address is put right, so what is
  // passed on from here is the one it has now.
  const path = item ? itemPath(item) : null;
  useEffect(() => {
    if (path && decodeURIComponent(pathname).replace(/\/$/, "") !== decodeURIComponent(path)) {
      navigate(`${path}${window.location.search}`, { replace: true });
    }
  }, [path, pathname]);

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
      {/* On a page of one's own, Publish adds an item to it. */}
      <Header back listingStore={item?.store && item.mine ? item : undefined} onStoreSaved={load} />
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
            // Deleted, there is no page left to stand on: back to the owner's
            // own list.
            onDelete={async () => {
              await api.deleteItem(item.id);
              showToast(t("item.deleted"), 1800);
              navigate("/mine", { replace: true });
            }}
            onEdit={() => setEditing("item")}
            onEditAvailability={() => setEditing("availability")}
            onEditItems={() => setChoosing(true)}
            onMessage={setWritingTo}
            onBookmark={(on) => api.setBookmark(item.id, on)}
            onBookingChange={load}
            onSignIn={() => navigate(loginPath())}
            signInPath={loginPath()}
          />
        )}
      </main>

      {/* The form, for whoever may change the item: the account it is under,
          anybody signed in where it is somebody else's, or the admin. */}
      {(item?.mine || (item?.shared && user) || (item && isAdmin(user))) && (
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
        />
      )}
      {item?.store && item.mine && (
        <StoreItemsModal
          isOpen={choosing}
          store={item}
          onClose={() => setChoosing(false)}
          onSaved={() => {
            setChoosing(false);
            load();
          }}
        />
      )}
      <MessageModal username={writingTo} onClose={() => setWritingTo(null)} />
    </div>
  );
}
