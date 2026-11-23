import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Modal, Skeleton } from "../../ui/index.js";
import { formatUsername } from "../../utils/format.js";
import { useAuth } from "../AuthProvider/index.js";
import { MessageThread } from "../MessageModal/index.js";
import styles from "./messages.module.css";

// The inbox, in two columns: the people you have an exchange with down the
// left, a wash on the ones with something unread, and the exchange with the one
// that is picked on the right.
//
// `username` is whose exchange to open on, when the inbox is being put back
// where a step back found it. `onLeave` is told, with the open exchange's name,
// when a link inside is about to leave for a page.
export default function MessagesModal({ isOpen, username, onClose, onLeave }) {
  const { t } = useTranslation();
  const { noteUnread } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // The correspondent who was last picked, or null before anyone has been.
  const [picked, setPicked] = useState(username ?? null);

  useEffect(() => {
    if (isOpen && username) setPicked(username);
  }, [isOpen, username]);
  // The row whose delete is uncovered, by a swipe to the left.
  const [revealed, setRevealed] = useState(null);

  const askedRef = useRef(0);

  const load = useCallback(() => {
    const ticket = ++askedRef.current;
    setLoading(true);
    setError("");
    api
      .getMessages()
      .then((data) => {
        if (ticket !== askedRef.current) return;
        setConversations(data.conversations ?? []);
        noteUnread(data.unread ?? 0);
      })
      .catch((requestError) => {
        if (ticket === askedRef.current) setError(requestError.message);
      })
      .finally(() => {
        if (ticket === askedRef.current) setLoading(false);
      });
  }, [noteUnread]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  // Whose exchange the right column shows: the one picked while it is still in
  // the list, and otherwise the first — so the column is never left empty
  // beside a list with somebody in it, and deleting the open one moves on to
  // the next.
  const reading = conversations.some((conversation) => conversation.username === picked)
    ? picked
    : (conversations[0]?.username ?? null);

  // The exchange on the right is read by being shown, so its row gives up the
  // wash without waiting for the list to be asked for again.
  useEffect(() => {
    if (!isOpen || !reading) return;
    setConversations((current) =>
      current.some((conversation) => conversation.username === reading && conversation.unread > 0)
        ? current.map((conversation) =>
            conversation.username === reading ? { ...conversation, unread: 0 } : conversation,
          )
        : current,
    );
  }, [isOpen, reading, conversations]);

  const swipe = useRef(null);
  const swiped = useRef(false);

  function onSwipeStart(event, key) {
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY, key };
  }

  function onSwipeEnd(event) {
    const gesture = swipe.current;
    swipe.current = null;
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy)) return;
    // The click that follows the lift is the end of the swipe, not a press.
    swiped.current = true;
    setRevealed(dx < 0 ? gesture.key : null);
  }

  function pick(conversation) {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    if (revealed) {
      setRevealed(null);
      return;
    }
    setPicked(conversation.username);
  }

  async function remove(username) {
    setRevealed(null);
    setError("");
    try {
      await api.deleteConversation(username);
      setConversations((current) => current.filter((conversation) => conversation.username !== username));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <Modal isOpen={isOpen} title={t("messages.title")} onClose={onClose} closeOnOverlay className={styles.box}>
      <div className={styles.sheet}>
        {error && <p className="form-message error">{error}</p>}

        {/* Waiting is not the same answer as none. */}
        {conversations.length === 0 ? (
          loading ? (
            <Skeleton rows={4} lines={2} label={t("common.loading")} />
          ) : (
            !error && <p className={styles.empty}>{t("messages.empty")}</p>
          )
        ) : (
          <div className={styles.columns}>
            <ul className={styles.list}>
              {conversations.map((conversation) => {
                const key = conversation.username;
                return (
                  <li key={key} className={styles.row}>
                    <div
                      className={[
                        styles.slider,
                        revealed === key && styles.revealed,
                        conversation.unread > 0 && styles.unread,
                        reading === key && styles.current,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onPointerDown={(event) => onSwipeStart(event, key)}
                      onPointerUp={onSwipeEnd}
                      onPointerCancel={() => {
                        swipe.current = null;
                      }}
                    >
                      <button
                        type="button"
                        className={styles.item}
                        onClick={() => pick(conversation)}
                        aria-current={reading === key ? "true" : undefined}
                      >
                        <span className={styles.who}>{formatUsername(conversation.username)}</span>
                      </button>
                    </div>
                    {/* Behind the row until a swipe uncovers it. */}
                    <button
                      type="button"
                      className={styles.delete}
                      onClick={() => remove(conversation.username)}
                      aria-label={t("messages.delete")}
                      title={t("messages.delete")}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 7h16" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M6 7l1 13h10l1-13" />
                        <path d="M9 7V4h6v3" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className={styles.pane}>
              <MessageThread username={reading} onLeave={() => (onLeave ?? onClose)(reading)} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
