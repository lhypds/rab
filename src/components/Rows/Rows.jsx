import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { ActionButton, Link, Modal, TextArea, showToast } from "../../ui/index.js";
import { bookingEnded, bookingWhen, canCancel, cancelLine } from "../../utils/bookings.js";
import { formatPrice, formatUsername, priceLine } from "../../utils/format.js";
import ReviewModal from "../ReviewModal/index.js";
import UserName, { dotted } from "../UserName/index.js";

// One item in a list: its picture, its name, what a day of it costs and where
// it is. The whole row is the way to its page. In the owner's own list the row
// also says, at the right, that the item is published; one that is not says
// nothing.
export function ItemRow({ item, showOwner = false, showPublished = false }) {
  const { t, i18n } = useTranslation();
  const meta = [
    priceLine(item, i18n.language, t),
    t(`kind.${item.kind}`),
    // Its rating, once somebody has rated it.
    item.rating?.count > 0 && `★ ${item.rating.average.toFixed(1)} (${item.rating.count})`,
    item.place || item.region?.name,
    showOwner && item.owner ? <UserName name={item.owner} inside /> : null,
  ];
  return (
    <li className="row-item">
      <div className="row">
        {/* `back`: the item's page was come to from a list, and its way back
            is to that list (see Header). */}
        <Link className="row-copy" to={`/i/${item.id}`} state={{ back: true }} draggable={false}>
          {item.thumb && <img className="row-thumb" src={item.thumb} alt="" width="40" height="40" loading="lazy" draggable={false} />}
          <span className="row-lines">
            <strong>{item.title}</strong>
            <span className="row-meta">{dotted(meta)}</span>
          </span>
        </Link>
        <span className="row-side">
          {showPublished && item.active && <span className="status">{t("item.published")}</span>}
          {item.pending > 0 && (
            <span className="status status-pending">{t("booking.waiting", { count: item.pending })}</span>
          )}
        </span>
      </div>
    </li>
  );
}

// One booking, and what can be done about it by whoever is reading the row:
// the owner answers a request, and either side can back out of one that is
// still standing.
//
// `about` says what the row leads with. In a list across items it is the item;
// on the item's own page that would be the same name on every row, so there it
// is the dates.
export function BookingRow({ booking, about = "item", onChange, onMessage }) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  // The sheet for asking the owner to call the booking off, where its rule no
  // longer lets whoever made it do that themselves — and the word about why.
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  // The sheet for rating the other side, once the booking is complete and
  // until the reader has: the same one that opens by itself (see ReviewPrompt),
  // here for whoever put it off.
  const [rating, setRating] = useState(false);
  const rateable = bookingEnded(booking) && !booking.reviewed;
  const dates = bookingWhen(booking, i18n.language);
  const total = formatPrice(booking.total, booking.currency, i18n.language);
  // Who is at the other end of it, from where the reader stands.
  const other = booking.owned ? booking.renter : booking.owner;
  const open = booking.status === "pending" || booking.status === "confirmed";

  async function set(status) {
    if (busy) return;
    setBusy(true);
    try {
      const data = await api.setBookingStatus(booking.id, status);
      onChange?.(data.booking);
    } catch (error) {
      const said = { DAYS_UNAVAILABLE: t("booking.clash"), CANCEL_NOT_ALLOWED: t("cancel.none"), CANCEL_TOO_LATE: t("cancel.late") };
      showToast(said[error.code] ?? error.message, 2400);
    } finally {
      setBusy(false);
    }
  }

  // Whether the reader can call it off themselves: the owner always, and
  // whoever made it by the rule it was made under.
  const free = booking.owned || canCancel(booking);

  // What is done about a booking other than changing where it stands: asking
  // to be let out of it, and the owner's no to that.
  async function send(work) {
    if (busy) return;
    setBusy(true);
    try {
      const data = await work();
      onChange?.(data.booking);
      setAsking(false);
      setWhy("");
    } catch (error) {
      showToast(error.message, 2400);
    } finally {
      setBusy(false);
    }
  }

  const title = about === "item" ? booking.itemTitle : dates;
  const Copy = about === "item" ? Link : "div";
  const meta =
    about === "item"
      ? [dates, total, other && <UserName name={other} inside />]
      : [total, booking.owned && other ? <UserName name={other} /> : null, booking.note];

  return (
    <li className="row-item">
      <div className="row">
        {/* A way to the item's page from a list across items; on that page
            itself the row has nowhere to lead and is only read. */}
        <Copy {...(about === "item" ? { className: "row-copy", to: `/i/${booking.itemId}`, state: { back: true }, draggable: false } : { className: "row-copy row-plain" })}>
          {about === "item" && booking.itemThumb && (
            <img className="row-thumb" src={booking.itemThumb} alt="" width="40" height="40" loading="lazy" draggable={false} />
          )}
          <span className="row-lines">
            <strong>{title}</strong>
            <span className="row-meta">{dotted(meta)}</span>
            {about === "item" && booking.note && <span className="row-meta">{booking.note}</span>}
          </span>
        </Copy>
        <span className="row-side">
          {/* Whoever made it has asked to be let out of it, and the owner has
              not answered yet: said on both sides' rows, on the one line with
              what the booking still is, and after it. */}
          <span className="row-statuses">
            <span className={`status status-${booking.status}`}>{t(`booking.status.${booking.status}`)}</span>
            {booking.cancelRequested && <span className="status status-pending">{t("cancel.asked")}</span>}
          </span>
          <span className="row-actions">
            {booking.owned && booking.status === "pending" && (
              <>
                <ActionButton tooltip={t("booking.accept")} tooltipRight onClick={() => set("confirmed")} disabled={busy}>
                  <svg viewBox="0 0 24 24">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                </ActionButton>
                <ActionButton tooltip={t("booking.decline")} tooltipRight onClick={() => set("declined")} disabled={busy}>
                  <svg viewBox="0 0 24 24">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </ActionButton>
              </>
            )}
            {/* The owner's no to being asked to call it off. Their yes is the
                cancel button beside it, which is theirs to press anyway. */}
            {booking.owned && booking.cancelRequested && (
              <ActionButton tooltip={t("cancel.refuse")} tooltipRight onClick={() => send(() => api.refuseCancel(booking.id))} disabled={busy}>
                <svg viewBox="0 0 24 24">
                  <path d="M4 12h16" />
                </svg>
              </ActionButton>
            )}
            {open && !(booking.owned && booking.status === "pending") && (
              // Whoever made the booking calls it off by its rule. Past what
              // the rule allows, the same button opens a sheet for asking the
              // owner instead — once: while an asking stands, it is off.
              <ActionButton
                tooltip={free ? (booking.owned && booking.cancelRequested ? t("cancel.agree") : t("booking.cancel")) : booking.cancelRequested ? t("cancel.asked") : t("cancel.ask")}
                tooltipRight
                onClick={() => (free ? set("cancelled") : setAsking(true))}
                disabled={busy || (!free && booking.cancelRequested)}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </ActionButton>
            )}
            {rateable && other && (
              <ActionButton tooltip={t("review.rate", { name: formatUsername(other) })} tooltipRight onClick={() => setRating(true)}>
                <svg viewBox="0 0 24 24">
                  <path d="m12 4 2.5 5.2 5.5.8-4 4 1 5.6-5-2.7-5 2.7 1-5.6-4-4 5.5-.8z" />
                </svg>
              </ActionButton>
            )}
            {onMessage && other && (
              <ActionButton
                tooltip={t("messages.write", { name: formatUsername(other) })}
                tooltipRight
                onClick={() => onMessage(other)}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M3 6h18v12H3z" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
              </ActionButton>
            )}
          </span>
        </span>
      </div>
      {/* Past what its rule allows, a booking is not called off by whoever
          made it: they ask the owner to, here, with a word about why. The
          owner is told in their messages and answers on their own row. */}
      <Modal isOpen={asking} title={t("cancel.askTitle")} onClose={busy ? undefined : () => setAsking(false)} closeOnOverlay>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(() => api.askToCancel(booking.id, why.trim()));
          }}
        >
          <div className="field">
            <p className="part-note">{cancelLine(booking.cancel, t)}</p>
            <p className="part-note">{t("cancel.askExplain", { name: formatUsername(booking.owner) })}</p>
            <TextArea
              className="text-area"
              value={why}
              onChange={(event) => setWhy(event.target.value)}
              placeholder={t("cancel.askPlaceholder")}
              maxLength={500}
              rows={3}
              minHeight={72}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="outline-button" onClick={() => setAsking(false)} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="primary-button" disabled={busy}>
              {t("cancel.askSend")}
            </button>
          </div>
        </form>
      </Modal>
      <ReviewModal
        booking={rating ? booking : null}
        onClose={() => setRating(false)}
        onDone={(rated) => {
          setRating(false);
          onChange?.(rated);
        }}
      />
    </li>
  );
}
