import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Modal, Skeleton } from "../../ui/index.js";
import { messagePreview } from "../../utils/bookings.js";
import { formatUsername, relativeTime } from "../../utils/format.js";
import { useAuth } from "../AuthProvider/index.js";
import MessageModal from "../MessageModal/index.js";
import styles from "./messages.module.css";

// The inbox: one row per person you have an exchange with, the last thing said
// in it, and a wash on the rows with something unread.
export default function MessagesModal({ isOpen, onClose }) {
  const { t, i18n } = useTranslation();
  const { noteUnread } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // The correspondent whose exchange is open over the list, or null.
  const [reading, setReading] = useState(null);
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

  function openThread(conversation) {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    if (revealed) {
      setRevealed(null);
      return;
    }
    setReading(conversation.username);
  }

  function closeThread() {
    setReading(null);
    setRevealed(null);
    // What was just read is no longer unread, and what was just said is the
    // row's new last line.
    load();
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
    <>
      <Modal isOpen={isOpen} title={t("messages.title")} onClose={onClose} closeOnOverlay wide>
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
            <ul className={styles.list}>
              {conversations.map((conversation) => {
                const key = conversation.username;
                const preview = messagePreview(conversation, t, i18n.language);
                return (
                  <li key={key} className={styles.row}>
                    <div
                      className={[
                        styles.slider,
                        revealed === key && styles.revealed,
                        conversation.unread > 0 && styles.unread,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onPointerDown={(event) => onSwipeStart(event, key)}
                      onPointerUp={onSwipeEnd}
                      onPointerCancel={() => {
                        swipe.current = null;
                      }}
                    >
                      <button type="button" className={styles.item} onClick={() => openThread(conversation)}>
                        <span className={styles.lines}>
                          <span className={styles.who}>{formatUsername(conversation.username)}</span>
                          <span className={styles.preview}>
                            <time className={styles.when} dateTime={conversation.time}>
                              {relativeTime(conversation.time, i18n.language, t)}
                            </time>
                            <span className={styles.previewText}>
                              {conversation.mine ? t("messages.said", { body: preview }) : preview}
                            </span>
                          </span>
                        </span>
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
          )}
        </div>
      </Modal>

      {/* Beside the inbox rather than inside it: two sheets, one over the
          other, each the page's own child. */}
      <MessageModal username={reading} onClose={closeThread} onNavigate={onClose} />
    </>
  );
}
