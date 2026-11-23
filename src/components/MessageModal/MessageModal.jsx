import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Link, Modal, Skeleton, TextArea } from "../../ui/index.js";
import { bookingLine, isBookingLine, lineItemId } from "../../utils/bookings.js";
import { formatUsername, relativeTime } from "../../utils/format.js";
import { useAuth } from "../AuthProvider/index.js";
import UserName from "../UserName/index.js";
import styles from "./message.module.css";

const BODY_MAX = 1000;

// How often an open exchange asks whether anything has been said. The request
// is also what marks the thread read, so a line that arrives in front of the
// reader is read by the request that brought it.
const THREAD_REFRESH_MS = 5000;

// How close to the foot of the thread counts as being at it.
const AT_END = 24;

// What every link out of an exchange leaves on the entry it opens: that there
// is a step back from it, so the page's own back arrow returns to where the
// exchange was read rather than going home.
const BACK = { back: true };

function same(a, b) {
  return (
    a.length === b.length &&
    a.every(
      (line, index) =>
        line.id === b[index].id &&
        line.read === b[index].read &&
        line.booking?.status === b[index].booking?.status,
    )
  );
}

// One exchange with one person: what has been said, oldest first, and a box at
// the foot of it to answer in. The body of a sheet rather than a sheet itself,
// so it can stand alone in one (see MessageModal below) or beside the list of
// people in the inbox. `onLeave` is told when a link inside it is about to
// leave for a page, so whatever is holding it open can put itself away.
export function MessageThread({ username, onLeave }) {
  const { t, i18n } = useTranslation();
  const { user, noteUnread } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef(null);
  const askedRef = useRef(0);
  const inFlightRef = useRef(null);
  const atEndRef = useRef(true);

  const load = useCallback(
    (quiet) => {
      if (!username) return Promise.resolve();
      const standing = inFlightRef.current;
      if (standing?.username === username) return standing.promise;
      standing?.controller.abort();

      const ticket = (askedRef.current += 1);
      const controller = new AbortController();
      if (!quiet) setLoading(true);
      const pending = api
        .getConversation(username, { signal: controller.signal })
        .then((data) => {
          if (ticket !== askedRef.current) return;
          const lines = data.messages ?? [];
          setMessages((current) => (same(current, lines) ? current : lines));
          noteUnread(data.unread ?? 0);
        })
        .catch((requestError) => {
          if (ticket === askedRef.current && !quiet) setError(requestError.message);
        })
        .finally(() => {
          if (inFlightRef.current?.promise === pending) inFlightRef.current = null;
          if (ticket === askedRef.current && !quiet) setLoading(false);
        });
      inFlightRef.current = { username, controller, promise: pending };
      return pending;
    },
    [username, noteUnread],
  );

  useEffect(() => {
    if (!username) return undefined;
    setMessages([]);
    setDraft("");
    setError("");
    atEndRef.current = true;
    load();
    return () => {
      askedRef.current += 1;
      if (inFlightRef.current?.username === username) {
        inFlightRef.current.controller.abort();
        inFlightRef.current = null;
      }
    };
  }, [username, load]);

  // The beat an open sheet keeps, stopped while the tab is out of sight and
  // asked at once when it comes back.
  useEffect(() => {
    if (!username) return undefined;
    let timer = null;
    let stopped = false;

    function stop() {
      window.clearTimeout(timer);
      timer = null;
    }

    function schedule() {
      stop();
      if (stopped || document.hidden) return;
      timer = window.setTimeout(run, THREAD_REFRESH_MS);
    }

    async function run() {
      timer = null;
      if (stopped || document.hidden) return;
      await load(true);
      schedule();
    }

    function watch() {
      stop();
      if (document.hidden) return;
      void run();
    }

    schedule();
    document.addEventListener("visibilitychange", watch);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", watch);
    };
  }, [username, load]);

  // Kept at the foot while the reader is at the foot, and left where it is
  // when they have scrolled up to read something.
  useEffect(() => {
    const box = threadRef.current;
    if (box && atEndRef.current) box.scrollTop = box.scrollHeight;
  }, [messages]);

  async function send(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const data = await api.sendMessage(username, body);
      atEndRef.current = true;
      setMessages((current) => [...current, data.message]);
      setDraft("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSending(false);
    }
  }

  // The last of the reader's own lines the far side has had in front of them.
  const readTo = messages.reduce((last, message) => (message.mine && message.read ? message.id : last), null);
  const me = user?.username ?? "";

  return (
    <div className={styles.sheet}>
      <div
        className={styles.thread}
        ref={threadRef}
        onScroll={(event) => {
          const box = event.currentTarget;
          atEndRef.current = box.scrollHeight - box.scrollTop - box.clientHeight <= AT_END;
        }}
      >
        {messages.length === 0 ? (
          loading ? (
            <Skeleton rows={3} lines={1} label={t("common.loading")} />
          ) : (
            !error && (
              <p className={styles.empty}>{t("messages.emptyThread", { name: formatUsername(username ?? "") })}</p>
            )
          )
        ) : (
          <ul className={styles.lines}>
            {messages.map((message) => {
              const who = message.mine ? me : username;
              const event = isBookingLine(message);
              const about = event ? lineItemId(message) : null;
              return (
                <li key={message.id} className={message.mine ? `${styles.line} ${styles.mine}` : styles.line}>
                  {who && <UserName name={who} className={styles.who} state={BACK} onClick={onLeave} />}
                  {event ? (
                    // What became of a booking — or what the administrator
                    // was sent about an item — and the way to the item it
                    // is about, where the calendar and the answer are.
                    about ? (
                      <Link
                        className={`${styles.bubble} ${styles.event}`}
                        to={`/i/${about}`}
            state={BACK}
                        onClick={onLeave}
                      >
                        <span className={`${styles.eventLine} ${styles.eventItem}`}>
                          {bookingLine(message, t, i18n.language)}
                        </span>
                        {message.body && <span>{message.body}</span>}
                      </Link>
                    ) : (
                      <span className={`${styles.bubble} ${styles.event}`}>
                        <span className={styles.eventLine}>{bookingLine(message, t, i18n.language)}</span>
                        {message.body && <span>{message.body}</span>}
                      </span>
                    )
                  ) : (
                    <span className={styles.bubble}>{message.body}</span>
                  )}
                  <span className={styles.meta}>
                    <time className={styles.when} dateTime={message.time}>
                      {relativeTime(message.time, i18n.language, t)}
                    </time>
                    {message.id === readTo && <span className={styles.read}>{t("messages.read")}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form className={styles.composer} onSubmit={send} autoComplete="off">
        <TextArea
          className={styles.text}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            // Enter sends and Shift+Enter breaks the line; an Enter that is
            // still choosing a candidate in an input method is neither.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              send(event);
            }
          }}
          placeholder={t("messages.placeholder")}
          maxLength={BODY_MAX}
          rows={2}
          minHeight={64}
          disabled={sending}
        />
        <div className={styles.footer}>
          <span className={styles.count}>
            {draft.length}/{BODY_MAX}
          </span>
          <button type="submit" className="primary-button" disabled={sending || !draft.trim()}>
            {sending ? t("messages.sending") : t("messages.send")}
          </button>
        </div>
      </form>

      {error && <p className="form-message error">{error}</p>}
    </div>
  );
}

// The exchange in a sheet of its own, for the places that open one person's
// thread without the inbox around it. `onNavigate` is told when a link inside
// the sheet is about to leave for a page, so whatever is holding sheets open
// over this one can put them away too.
export default function MessageModal({ username, onClose, onNavigate }) {
  function leave() {
    onClose();
    onNavigate?.();
  }

  return (
    <Modal
      isOpen={Boolean(username)}
      // The name is the way through to the other person's page.
      title={
        username && (
          <Link className={styles.profile} to={`/u/${encodeURIComponent(username)}`} state={BACK} onClick={leave}>
            {formatUsername(username)}
          </Link>
        )
      }
      onClose={onClose}
      closeOnOverlay
      wide
    >
      <MessageThread username={username} onLeave={leave} />
    </Modal>
  );
}
