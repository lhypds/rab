import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Modal, TextArea, showToast } from "../../ui/index.js";
import { bookingWhen } from "../../utils/bookings.js";
import { formatUsername } from "../../utils/format.js";
import styles from "./review.module.css";

const FIVE = [1, 2, 3, 4, 5];

// A rating as it is read: five stars, as many of them filled as it comes to.
// A mean is rounded to the nearest whole star here; the number beside it says
// the rest.
export function Stars({ value, className = "" }) {
  const { t } = useTranslation();
  const filled = Math.round(value ?? 0);
  return (
    <span className={`${styles.stars}${className ? ` ${className}` : ""}`} role="img" aria-label={t("review.stars", { count: filled })}>
      {FIVE.map((star) => (star <= filled ? "★" : "☆")).join("")}
    </span>
  );
}

// Five stars to press, under what they are for.
function Picker({ label, value, onChange, disabled }) {
  const { t } = useTranslation();
  return (
    <div className={styles.rate}>
      <span className={styles.what}>{label}</span>
      <div className={styles.picker} role="radiogroup" aria-label={label}>
        {FIVE.map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={t("review.stars", { count: star })}
            className={styles.star}
            onClick={() => onChange(star)}
            disabled={disabled}
          >
            {star <= value ? "★" : "☆"}
          </button>
        ))}
      </div>
    </div>
  );
}

// The sheet a complete booking opens: how the other side of it was, in stars
// and — where there is something to say — in words. Whoever rented rates the
// owner and the item, each in stars of its own; the owner rates whoever rented. `booking` is the booking
// being rated, or null for the sheet to be closed. `onClose` is leaving it for
// later; `onDone` is handed the booking as it stands once the rating is in.
export default function ReviewModal({ booking, onClose, onDone }) {
  const { t, i18n } = useTranslation();
  const [rating, setRating] = useState(0);
  const [itemRating, setItemRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  // One sheet serves one booking after another: each starts empty.
  const bookingId = booking?.id ?? null;
  useEffect(() => {
    setRating(0);
    setItemRating(0);
    setComment("");
  }, [bookingId]);

  if (!booking) return null;
  // Who is being rated: the other end of it, from where the reader stands.
  const name = formatUsername(booking.owned ? booking.renter : booking.owner);
  // Whoever rented has the item to rate as well.
  const renting = !booking.owned;
  const itemTitle = booking.itemTitle ?? t("messages.event.gone");
  const chosen = rating > 0 && (!renting || itemRating > 0);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!chosen) {
      showToast(t("review.pickStars"), 2400);
      return;
    }
    setBusy(true);
    try {
      const data = await api.reviewBooking(booking.id, rating, comment.trim(), renting ? itemRating : undefined);
      showToast(t("review.sent"), 2400);
      onDone?.(data.booking);
    } catch (error) {
      // Rated already, from another tab or another device: it is done.
      if (error.code === "ALREADY_REVIEWED") onDone?.({ ...booking, reviewed: true });
      else showToast(error.message, 2400);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen title={renting ? t("review.titleRental") : t("review.title", { name })} onClose={busy ? undefined : onClose} className={styles.sheet}>
      <form onSubmit={submit}>
        <div className="field">
          <p className={styles.lead}>
            {t("review.lead", { item: itemTitle, dates: bookingWhen(booking, i18n.language) })}
          </p>
          <p className="part-note">{t(renting ? "review.explainRental" : "review.explain", { name })}</p>
          <div className={styles.rates}>
            <Picker label={name} value={rating} onChange={setRating} disabled={busy} />
            {renting && <Picker label={itemTitle} value={itemRating} onChange={setItemRating} disabled={busy} />}
          </div>
          <TextArea
            className="text-area"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t("review.placeholder")}
            maxLength={500}
            rows={3}
            minHeight={72}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="outline-button" onClick={onClose} disabled={busy}>
            {t("review.later")}
          </button>
          <button type="submit" className="primary-button" disabled={busy || !chosen}>
            {t("review.send")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
