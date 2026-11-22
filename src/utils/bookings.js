import { formatDay, formatRange, today } from "./days.js";

// The line rab writes into a conversation when a booking changes hands, in the
// reader's language: what happened, to which item, for which days. The server
// keeps only the kind and the booking; the words are chosen here.
export const BOOKING_KINDS = ["request", "confirmed", "declined", "cancelled", "cancelRequest", "cancelRefused"];

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

// Whether whoever made a booking may still call it off, by the rule it was
// made under (see server/rates.js): a request still waiting always can be;
// one the owner has said yes to, not where the rule is "none", and under
// "days" or "hours" only until that long before it starts — by the day, or
// by the clock where the reader is sitting.
export function canCancel(booking, now = new Date()) {
  if (booking.status !== "confirmed") return true;
  const rule = booking.cancel;
  if (rule?.mode === "none") return false;
  if (rule?.mode === "days") {
    const pad = (number) => String(number).padStart(2, "0");
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const last = new Date(Date.parse(`${booking.start}T00:00:00Z`) - rule.days * 86_400_000).toISOString().slice(0, 10);
    return today <= last;
  }
  if (rule?.mode === "hours") {
    const time = booking.slots?.[0]?.start ?? booking.startTime ?? "00:00";
    const starts = new Date(`${booking.start}T${time === "24:00" ? "23:59" : time}:00`).getTime();
    return now.getTime() <= starts - rule.hours * 3_600_000;
  }
  return true;
}

// A rule for calling off, as a sentence.
export function cancelLine(cancel, t) {
  if (cancel?.mode === "none") return t("cancel.none");
  if (cancel?.mode === "days") return t("cancel.days", { count: cancel.days });
  if (cancel?.mode === "hours") return t("cancel.hours", { count: cancel.hours });
  return t("cancel.any");
}
