import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../../ui/index.js";
import { formatDate } from "../../utils/format.js";
import UserName, { dotted } from "../UserName/index.js";
import { Stars } from "./ReviewModal.jsx";

// A rating, of somebody or of an item, as one line to press: the word, five
// stars — empty where nobody has rated yet — the mean where somebody has, and
// in brackets how many times it was rated. Pressing it opens what was said, in
// a sheet.
//
// `rating` is { average, count }; `reviews` is what was said, newest first,
// each { id, rating, comment, time, from } — and, of a person, `as` (what they
// were in that booking). Never what the booking was of: that is private.
export default function Rating({ rating, reviews = [], className = "" }) {
  const { t, i18n } = useTranslation();
  const [reading, setReading] = useState(false);
  const count = rating?.count ?? 0;

  return (
    <>
      <button
        type="button"
        className={`rating-button${className ? ` ${className}` : ""}`}
        onClick={() => setReading(true)}
      >
        {t("user.ratingLabel")} <Stars value={rating?.average} />
        {count > 0 && ` ${rating.average.toFixed(1)}`} ({count})
      </button>
      <Modal isOpen={reading} title={t("user.reviews")} onClose={() => setReading(false)} closeOnOverlay>
        {reviews.length === 0 ? (
          <p className="empty-state">{t("user.reviewsEmpty")}</p>
        ) : (
          <ul className="row-list">
            {reviews.map((review) => (
              <li key={review.id} className="row-item">
                <div className="review">
                  <Stars value={review.rating} />
                  {review.comment && <p className="review-comment">{review.comment}</p>}
                  <span className="row-meta">
                    {dotted([
                      <UserName name={review.from} onClick={() => setReading(false)} />,
                      review.as && t(review.as === "owner" ? "user.asOwner" : "user.asRenter"),
                      formatDate(review.time, i18n.language),
                    ])}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
