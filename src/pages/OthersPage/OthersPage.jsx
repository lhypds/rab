import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { BookingRow, Header, ItemRow, CategoryTabs, MessageModal, useCategoryFilter } from "../../components/index.js";
import { Skeleton } from "../../ui/index.js";

// When a rental starts, as text that sorts: its day, then its time — the first
// slot's where it is for slots, the pickup's otherwise.
const startOf = (booking) => `${booking.start} ${booking.slots?.[0]?.start ?? booking.startTime ?? ""}`;

// What is other people's: what you have asked them for, and what became of
// each request — and the items you have kept to come back to, your
// bookmarks. What is your own is on /mine.
export default function OthersPage() {
  const { t } = useTranslation();
  const [bookings, setBookings] = useState(null);
  const [bookmarks, setBookmarks] = useState(null);
  const [error, setError] = useState("");
  const [writingTo, setWritingTo] = useState(null);
  // Each column has a filter of its own, in the address, so coming back from
  // an item's page lands on the lists that were left: the rentals' under
  // `category`, the bookmarks' under `keptCategory`.
  const rentalsFilter = useCategoryFilter("category");
  const keptFilter = useCategoryFilter("keptCategory");

  const load = useCallback(() => {
    api
      .getMine()
      .then((answer) => {
        setBookings(answer.bookings);
        setError("");
      })
      .catch((requestError) => setError(requestError.message));
    api
      .getBookmarks()
      .then((answer) => setBookmarks(answer.items))
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(load, [load]);

  // The one rented last at the top: by when the rental is for, latest first,
  // and where two are for the same time, the one asked for later.
  const shown = bookings
    ?.filter((booking) => rentalsFilter.fits(booking.itemCategory))
    .sort((a, b) => (startOf(a) < startOf(b) ? 1 : startOf(a) > startOf(b) ? -1 : b.id - a.id));
  // The bookmarks, narrowed by their own filter; the one kept last first,
  // which is how they come.
  const kept = bookmarks?.filter((item) => keptFilter.fits(item.category));

  return (
    <div className="page-shell">
      <Header back />
      <main className="wide-page">
        <div className="section-heading">
          <h1>{t("others.title")}</h1>
        </div>

        {error && <p className="list-error">{error}</p>}
        <div className="others-columns others-page">
          <section>
            <div className="part-heading">
              <h2>{t("others.rentals")}</h2>
              {shown && <span>{shown.length}</span>}
            </div>
            <CategoryTabs {...rentalsFilter} />

            {!shown ? (
              !error && <Skeleton rows={4} lines={2} label={t("common.loading")} />
            ) : shown.length === 0 ? (
              <p className="empty-state">{t(rentalsFilter.everything ? "others.empty" : "others.noneShown")}</p>
            ) : (
              <ul className="row-list">
                {shown.map((booking) => (
                  <BookingRow key={booking.id} booking={booking} onChange={load} onMessage={setWritingTo} />
                ))}
              </ul>
            )}
          </section>
          <section>
            <div className="part-heading">
              <h2>{t("others.bookmarks")}</h2>
              {kept && <span>{kept.length}</span>}
            </div>
            <CategoryTabs {...keptFilter} />

            {!kept ? (
              !error && <Skeleton rows={3} lines={2} label={t("common.loading")} />
            ) : kept.length === 0 ? (
              <p className="empty-state">{t(keptFilter.everything ? "others.noBookmarks" : "others.noneShown")}</p>
            ) : (
              <ul className="row-list">
                {kept.map((item) => (
                  <ItemRow key={item.id} item={item} showOwner />
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      <MessageModal username={writingTo} onClose={() => setWritingTo(null)} />
    </div>
  );
}
