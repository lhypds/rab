import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Modal, Skeleton, showToast, useNavigate } from "../../ui/index.js";
import { loginPath, useAuth } from "../AuthProvider/index.js";
import ItemView from "../ItemView/index.js";
import MessageModal from "../MessageModal/index.js";
import styles from "./preview.module.css";

// An item looked at without leaving the list it was picked from: its page, on
// a sheet over the list. Everything a visitor does on the page is done here
// the same — asking for it, keeping it, writing to its owner. Changing the
// item is the page's own business, and the owner is taken there for it; the
// way to the page is in the sheet's bar for everybody else.
//
// `id` is the item being looked at, or null for the sheet put away. `onGone`
// is told the id of an item that is no longer there to be listed — deleted
// from here, or switched off — so the list under the sheet can let go of it.
export default function ItemPreview({ id, onClose, onGone }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [writingTo, setWritingTo] = useState(null);

  const load = useCallback(() => {
    if (!id) return Promise.resolve();
    return api
      .getItem(id)
      .then((answer) => {
        setData(answer);
        setError("");
      })
      .catch((requestError) => {
        // What is already on the sheet stays there through a request that
        // failed; only the first one has nothing else to show.
        setData((current) => {
          if (!current) setError(requestError.status === 404 ? t("item.missing") : requestError.message);
          return current;
        });
      });
  }, [id, t]);

  // Another item, or another account looking at it, is another answer: the
  // sheet is emptied first, so the last item is never shown under a new name.
  const username = user?.username ?? null;
  useEffect(() => {
    setData(null);
    setError("");
    load();
  }, [load, username]);

  const item = data?.item ?? null;
  const page = `/i/${id}`;

  async function book(request) {
    try {
      const answer = await api.requestBooking(item.id, request);
      setData((current) => ({ ...current, item: answer.item, calendar: answer.calendar, bookings: answer.bookings }));
      showToast(t("booking.requested"), 2400);
    } catch (requestError) {
      // Somebody else got there first: the calendar on screen is out of date.
      if (requestError.code === "DAYS_UNAVAILABLE") load();
      throw requestError;
    }
  }

  return (
    <>
      <Modal
        isOpen={Boolean(id)}
        onClose={onClose}
        closeOnOverlay
        large
        className={styles.sheet}
        title={item?.title ?? ""}
        header={
          <a className={styles.open} href={page} target="_blank" rel="noopener">
            {t("map.open")}
            <span aria-hidden="true"> ↗</span>
          </a>
        }
      >
        {/* As wide as the item's own page is and no wider, in the middle of
            the sheet: the page was drawn to that measure. */}
        <div className={styles.page}>
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
              onBook={book}
              onSetActive={async (active) => {
                await api.updateItem(item.id, { active });
                if (!active) onGone?.(item.id);
                await load();
              }}
              onDelete={async () => {
                await api.deleteItem(item.id);
                showToast(t("item.deleted"), 1800);
                onGone?.(item.id);
                onClose?.();
              }}
              onEdit={() => navigate(page)}
              onEditAvailability={() => navigate(page)}
              onMessage={setWritingTo}
              onBookmark={(on) => api.setBookmark(item.id, on)}
              onBookingChange={load}
              onSignIn={() => navigate(loginPath())}
              signInPath={loginPath()}
            />
          )}
        </div>
      </Modal>
      <MessageModal username={writingTo} onClose={() => setWritingTo(null)} />
    </>
  );
}
