import { formatDay, formatRange, today } from "./days.js";

// The line rab writes into a conversation when a booking changes hands, in the
// reader's language: what happened, to which item, for which days. The server
// keeps only the kind and the booking; the words are chosen here.
export const BOOKING_KINDS = ["request", "confirmed", "declined", "cancelled"];

// When a booking is for: its days and its hours — the slots where it is for
// slots, and otherwise the time it is picked up and the time it comes back.
export function bookingWhen(booking, locale) {
  const dates = formatRange(booking.start, booking.end, locale);
  if (!booking.slots?.length) {
    const { start, end, startTime, endTime } = booking;
    if (!startTime || !endTime) return dates;
    if (start === end) return `${dates} ${startTime}–${endTime}`;
    const sameYear = start.slice(0, 4) === today().slice(0, 4) && end.slice(0, 4) === start.slice(0, 4);
    const options = sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" };
    return `${formatDay(start, locale, options)} ${startTime} – ${formatDay(end, locale, options)} ${endTime}`;
  }
  return `${dates} ${booking.slots.map((slot) => `${slot.start}–${slot.end}`).join(", ")}`;
}

export function isBookingLine(message) {
  return BOOKING_KINDS.includes(message?.kind);
}

export function bookingLine(message, t, locale) {
  const booking = message.booking;
  const dates = booking ? bookingWhen(booking, locale) : "";
  return t(`messages.event.${message.kind}`, {
    item: booking?.itemTitle ?? t("messages.event.gone"),
    dates,
  });
}

// What a row in the inbox says a conversation last said.
export function messagePreview(message, t, locale) {
  if (!isBookingLine(message)) return message.body;
  const line = bookingLine(message, t, locale);
  return message.body ? `${line} — ${message.body}` : line;
}
