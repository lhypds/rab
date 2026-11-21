import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { BookingRow, Header, MessageModal } from "../../components/index.js";
import { Skeleton } from "../../ui/index.js";

// What you have asked other people for, and what became of each request.
export default function RentalsPage() {
  const { t } = useTranslation();
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState("");
  const [writingTo, setWritingTo] = useState(null);

  const load = useCallback(() => {
    api
      .getMine()
      .then((answer) => {
        setBookings(answer.bookings);
        setError("");
      })
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="page-shell">
      <Header back />
      <main className="list-page">
        <div className="section-heading">
          <h1>{t("rentals.title")}</h1>
          {bookings?.length > 0 && <span>{bookings.length}</span>}
        </div>

        {error && <p className="list-error">{error}</p>}

        {!bookings ? (
          !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />
        ) : bookings.length === 0 ? (
          <p className="empty-state">{t("rentals.empty")}</p>
        ) : (
          <ul className="row-list">
            {bookings.map((booking) => (
              <BookingRow key={booking.id} booking={booking} onChange={load} onMessage={setWritingTo} />
            ))}
          </ul>
        )}
      </main>

      <MessageModal username={writingTo} onClose={() => setWritingTo(null)} />
    </div>
  );
}
