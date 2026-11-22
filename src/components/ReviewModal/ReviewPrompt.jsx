import { useCallback, useEffect, useState } from "react";
import * as api from "../../api.js";
import { bookingEnded } from "../../utils/bookings.js";
import { useAuth } from "../AuthProvider/index.js";
import ReviewModal from "./ReviewModal.jsx";

// The bookings whose sheet was closed without a rating, on this browser: the
// sheet does not come back for them by itself. Their row still carries the
// star that opens it (see BookingRow).
const laterKey = "rab:review-later";

function readLater() {
  try {
    const kept = JSON.parse(localStorage.getItem(laterKey) || "[]");
    return Array.isArray(kept) ? kept : [];
  } catch {
    return [];
  }
}

function keepLater(ids) {
  try {
    // The last couple of hundred: nobody leaves more than that for later.
    localStorage.setItem(laterKey, JSON.stringify(ids.slice(-200)));
  } catch {
    // The sheet comes back on the next visit, which is all this costs.
  }
}

// How often the bookings waiting on a rating are asked for, and how often the
// ones already known are looked at again: one known to end at four is asked
// about at four, not at the next asking.
const ASK_MS = 5 * 60 * 1000;
const LOOK_MS = 30 * 1000;

// When a booking is complete, both sides are asked to rate each other: this is
// the asking, on whatever page the reader is on. It stands over the whole app
// and shows one sheet at a time, for each complete booking the reader has not
// rated and has not put off.
export default function ReviewPrompt() {
  const { user } = useAuth();
  const username = user?.username ?? null;
  const [waiting, setWaiting] = useState([]);
  const [later, setLater] = useState(readLater);
  const [now, setNow] = useState(() => new Date());

  const ask = useCallback(() => {
    if (document.hidden) return;
    api
      .getPendingReviews()
      .then((data) => {
        setWaiting(data.bookings ?? []);
        setNow(new Date());
      })
      .catch(() => {
        // Asked again in a while; nothing is lost by not asking now.
      });
  }, []);

  useEffect(() => {
    setWaiting([]);
    if (!username) return undefined;
    ask();
    const asking = window.setInterval(ask, ASK_MS);
    const looking = window.setInterval(() => setNow(new Date()), LOOK_MS);
    document.addEventListener("visibilitychange", ask);
    return () => {
      window.clearInterval(asking);
      window.clearInterval(looking);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [username, ask]);

  // The oldest first: the one that has waited longest.
  const booking =
    waiting
      .filter((each) => !later.includes(each.id) && bookingEnded(each, now))
      .sort((a, b) => a.id - b.id)[0] ?? null;

  function putOff() {
    const ids = [...later, booking.id];
    setLater(ids);
    keepLater(ids);
  }

  function done(rated) {
    setWaiting((list) => list.filter((each) => each.id !== rated.id));
  }

  return <ReviewModal booking={username ? booking : null} onClose={putOff} onDone={done} />;
}
