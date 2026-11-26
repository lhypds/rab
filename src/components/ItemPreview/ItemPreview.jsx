import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Modal, Skeleton, showToast, useNavigate } from "../../ui/index.js";
import { loginPath, useAuth } from "../AuthProvider/index.js";
import ItemModal from "../ItemModal/index.js";
import ItemView from "../ItemView/index.js";
import StoreItemsModal from "../StoreItemsModal/index.js";
import MessageModal from "../MessageModal/index.js";
import styles from "./preview.module.css";

// An item looked at without leaving the list it was picked from: its page, on
// a sheet over the list. Everything a visitor does on the page is done here
// the same — asking for it, keeping it, writing to its owner. Changing it
// too: the sheet is put away and the form is opened in its place. The way to
// the page is in the sheet's bar.
//
// `id` is the item being looked at, or null for the sheet put away. `onGone`
// is told the id of an item that is no longer there to be listed — deleted
// from here, or switched off — so the list under the sheet can let go of it.
// `onOpen` is asked to put the sheet up again on an id: the item's, once it
// is saved from the form opened from the sheet.
export default function ItemPreview({ id, onClose, onGone, onOpen }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [writingTo, setWritingTo] = useState(null);
  // The form opened from the sheet, once the sheet is put away: which of its
  // parts ("item", "availability", or "items" for what is on a store), and
  // the item and calendar it was opened on — the sheet lets go of its own
  // as it closes.
  const [editing, setEditing] = useState(null);

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

  // Saved: the form is put away and the sheet put up again on the item, as
  // it now is.
  function saved() {
    const again = editing.item.id;
    setEditing(null);
    onOpen?.(again);
  }

  function edit(part) {
    setEditing({ part, item, calendar: data.calendar });
    onClose?.();
  }

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
              onEdit={() => edit("item")}
              onEditAvailability={() => edit("availability")}
              onEditItems={() => edit("items")}
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
      {editing && editing.part !== "items" && (
        <ItemModal
          isOpen
          part={editing.part}
          item={editing.item}
          calendar={editing.calendar}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      {editing?.part === "items" && (
        <StoreItemsModal isOpen store={editing.item} onClose={() => setEditing(null)} onSaved={saved} />
      )}
    </>
  );
}
