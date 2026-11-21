import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { ActionButton, Link, showToast } from "../../ui/index.js";
import { bookingWhen } from "../../utils/bookings.js";
import { formatPrice, formatUsername, priceLine } from "../../utils/format.js";

// One item in a list: its picture, its name, what a day of it costs and where
// it is. The whole row is the way to its page.
export function ItemRow({ item, showOwner = false }) {
  const { t, i18n } = useTranslation();
  const meta = [
    priceLine(item, i18n.language, t),
    t(`kind.${item.kind}`),
    item.place || item.region?.name,
    showOwner ? formatUsername(item.owner) : null,
  ];
  return (
    <li className="row-item">
      <div className="row">
        <Link className="row-copy" to={`/i/${item.id}`} draggable={false}>
          {item.thumb && <img className="row-thumb" src={item.thumb} alt="" width="40" height="40" loading="lazy" draggable={false} />}
          <span className="row-lines">
            <strong>{item.title}</strong>
            <span className="row-meta">{meta.filter(Boolean).join(" · ")}</span>
          </span>
        </Link>
        <span className="row-side">
          {!item.active && <span className="status status-off">{t("item.inactive")}</span>}
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
      showToast(error.code === "DAYS_UNAVAILABLE" ? t("booking.clash") : error.message, 2400);
    } finally {
      setBusy(false);
    }
  }

  const title = about === "item" ? booking.itemTitle : dates;
  const Copy = about === "item" ? Link : "div";
  const meta =
    about === "item"
      ? [dates, total, formatUsername(other)]
      : [total, booking.owned ? formatUsername(other) : null, booking.note];

  return (
    <li className="row-item">
      <div className="row">
        {/* A way to the item's page from a list across items; on that page
            itself the row has nowhere to lead and is only read. */}
        <Copy {...(about === "item" ? { className: "row-copy", to: `/i/${booking.itemId}`, draggable: false } : { className: "row-copy row-plain" })}>
          {about === "item" && booking.itemThumb && (
            <img className="row-thumb" src={booking.itemThumb} alt="" width="40" height="40" loading="lazy" draggable={false} />
          )}
          <span className="row-lines">
            <strong>{title}</strong>
            <span className="row-meta">{meta.filter(Boolean).join(" · ")}</span>
            {about === "item" && booking.note && <span className="row-meta">{booking.note}</span>}
          </span>
        </Copy>
        <span className="row-side">
          <span className={`status status-${booking.status}`}>{t(`booking.status.${booking.status}`)}</span>
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
            {open && !(booking.owned && booking.status === "pending") && (
              <ActionButton tooltip={t("booking.cancel")} tooltipRight onClick={() => set("cancelled")} disabled={busy}>
                <svg viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6 6 18" />
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
    </li>
  );
}
