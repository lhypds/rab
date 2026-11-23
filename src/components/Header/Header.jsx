import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton, Link, useNavigate } from "../../ui/index.js";
import { loginPath, useAuth } from "../AuthProvider/index.js";
import AccountModal from "../AccountModal/index.js";
import FilterBox from "../FilterBox/index.js";
import ItemModal from "../ItemModal/index.js";
import LanguageSwitcher from "../LanguageSwitcher/index.js";
import MessagesModal from "../MessagesModal/index.js";
import TravelModal from "../TravelModal/index.js";

// The bar on every page. `back` swaps the wordmark for the way back, on the
// pages that are somewhere you went to rather than where you start: back to the
// list the page was opened from, where it was opened from one (the row says so
// in the entry's state), and to the map otherwise.
// Asked of the window by anything that wants the form for putting something
// out for rent opened: `window.dispatchEvent(new Event(LIST_EVENT))`.
export const LIST_EVENT = "rab:list";
// And by anything that wants the account's messages opened.
export const MESSAGES_EVENT = "rab:messages";

export default function Header({ back = false, view, onView, query = "", onQuery }) {
  const { t } = useTranslation();
  const { user, unread } = useAuth();
  const navigate = useNavigate();
  const fromList = back && window.history.state?.back === true;
  // The sheets opened from here and nowhere else, so the bar holds them open
  // itself.
  const [accountOpen, setAccountOpen] = useState(false);
  // The inbox is also what a step back returns to: a link pressed inside it
  // leaves the name of the open exchange on the entry being left (see
  // leaveMessages), and an entry carrying one opens the inbox on that exchange
  // again — when the bar is first put up on it, and when a step back lands on
  // it under a bar that was already standing.
  const [messagesWith, setMessagesWith] = useState(() => window.history.state?.messages ?? null);
  const [messagesOpen, setMessagesOpen] = useState(() => Boolean(window.history.state?.messages));
  const [listing, setListing] = useState(false);
  const [travelOpen, setTravelOpen] = useState(false);

  // The form for putting something out is opened from the bar, and from
  // wherever else on the page asks for it (see LIST_EVENT): an area with
  // nothing in it does. A stranger is sent to sign in first, as from the bar.
  useEffect(() => {
    const open = () => (user ? setListing(true) : navigate(loginPath()));
    const read = () => (user ? setMessagesOpen(true) : navigate(loginPath()));
    window.addEventListener(LIST_EVENT, open);
    window.addEventListener(MESSAGES_EVENT, read);
    return () => {
      window.removeEventListener(LIST_EVENT, open);
      window.removeEventListener(MESSAGES_EVENT, read);
    };
  }, [user, navigate]);

  useEffect(() => {
    const onPopState = (event) => {
      const username = event.state?.messages;
      if (!username) return;
      setMessagesWith(username);
      setMessagesOpen(true);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Put away by the reader: the entry gives up its note, so the inbox does not
  // come back on a reload or on a later step back to here.
  function closeMessages() {
    setMessagesOpen(false);
    setMessagesWith(null);
    if (window.history.state?.messages) {
      const { messages: _gone, ...rest } = window.history.state;
      window.history.replaceState(rest, "");
    }
  }

  // Put away by a link inside it, on the way to another page: the entry being
  // left is told whose exchange was open, before the router pushes the next.
  function leaveMessages(username) {
    setMessagesOpen(false);
    setMessagesWith(null);
    window.history.replaceState({ ...window.history.state, messages: username }, "");
  }

  return (
    <>
      <header className="topbar">
        <span className="topbar-brand">
          {back ? (
            <ActionButton
              tooltip={t(fromList ? "header.back" : "header.backHome")}
              tooltipLeft
              onClick={() => (fromList ? window.history.back() : navigate("/"))}
            >
              <svg viewBox="0 0 24 24">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </ActionButton>
          ) : (
            <Link className="wordmark" to="/">
              rab
            </Link>
          )}
        </span>
        {/* In the middle of the bar, on the page that has a list to narrow: the
            box that looks among what is offered here. Not on a phone, where
            the bar is full — there it stands over the list (see MapView). */}
        {onQuery && (
          <span className="topbar-filter">
            <FilterBox slash value={query} onChange={onQuery} placeholder={t("search.placeholder")} />
          </span>
        )}
        <span className="topbar-action-slot">
          {/* How the home page is read: on the map, or as lists. A pair, the
              one in force turned over. Only on the page that has both. */}
          {onView && (
            <span className="topbar-view" role="group">
              <ActionButton tooltip={t("header.viewMap")} aria-pressed={view === "map"} onClick={() => onView("map")}>
                <svg viewBox="0 0 24 24">
                  <path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
                  <path d="M9 4v14" />
                  <path d="M15 6v14" />
                </svg>
              </ActionButton>
              <ActionButton tooltip={t("header.viewList")} aria-pressed={view === "list"} onClick={() => onView("list")}>
                <svg viewBox="0 0 24 24">
                  <path d="M9 6h11" />
                  <path d="M9 12h11" />
                  <path d="M9 18h11" />
                  <path d="M4 6h.01" />
                  <path d="M4 12h.01" />
                  <path d="M4 18h.01" />
                </svg>
              </ActionButton>
            </span>
          )}
          {/* Putting something out for rent: the one thing in the bar that adds
              to the map rather than reading it. Shown to everybody — to a
              stranger it is the way in, by way of signing in. */}
          <ActionButton
            tooltip={t("header.list")}
            onClick={() => (user ? setListing(true) : navigate(loginPath()))}
          >
            <svg viewBox="0 0 24 24">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </ActionButton>
          {/* What is yours: what you have out for rent, and who has asked for
              any of it. */}
          {user && (
            <ActionButton tooltip={t("header.mine")} onClick={() => navigate("/mine")}>
              <svg viewBox="0 0 24 24">
                <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
                <path d="M3 8l9 5 9-5" />
                <path d="M12 13v8" />
              </svg>
            </ActionButton>
          )}
          {/* What is other people's: what you have asked them for. A key —
              theirs, handed to you for a while — beside the box that is what
              you have yourself. */}
          {user && (
            <ActionButton tooltip={t("header.others")} onClick={() => navigate("/others")}>
              <svg viewBox="0 0 24 24">
                <circle cx="8" cy="16" r="4" />
                <path d="m11 13 9-9" />
                <path d="m16 8 3 3" />
              </svg>
            </ActionButton>
          )}
          {/* Somewhere else to stand: another country, another town, and the
              map goes there (see TravelModal). A plane leaving the ground,
              filled rather than outlined. */}
          <span className="topbar-travel">
            <ActionButton tooltip={t("travel.title")} onClick={() => setTravelOpen(true)}>
              <svg viewBox="0 0 24 24">
                <path d="M2.5 19h19v2h-19v-2Zm19.57-9.36a1.5 1.5 0 0 0-1.84-1.06l-5.59 1.5-7.25-6.76-1.93.52 4.35 7.53-5.23 1.4-2.07-1.62-1.45.39 2.55 4.41 16.89-4.52a1.5 1.5 0 0 0 1.06-1.86l-.49-1.93Z" />
              </svg>
            </ActionButton>
          </span>
          {/* What somebody said to you — and what became of a booking, which
              arrives as a line in the same place. The dot says something is
              waiting; how much, and from whom, is the answer inside. */}
          {user && (
            <span className="topbar-badge">
              <ActionButton
                tooltip={t("messages.title")}
                aria-label={unread > 0 ? t("messages.waiting", { n: unread }) : t("messages.title")}
                onClick={() => setMessagesOpen(true)}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M3 6h18v12H3z" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
              </ActionButton>
              {unread > 0 && <span className="topbar-dot" aria-hidden="true" />}
            </span>
          )}
          <ActionButton
            tooltip={user ? t("header.account") : t("header.signIn")}
            onClick={() => (user ? setAccountOpen(true) : navigate(loginPath()))}
          >
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
            </svg>
          </ActionButton>
          <LanguageSwitcher />
        </span>
      </header>

      {/* Mounted beside the bar rather than inside it: the bar is sticky and
          carries a stacking context of its own, and a sheet opened in there
          would be pinned under it. */}
      <TravelModal isOpen={travelOpen} onClose={() => setTravelOpen(false)} />
      {user && <MessagesModal isOpen={messagesOpen} username={messagesWith} onClose={closeMessages} onLeave={leaveMessages} />}
      {user && <AccountModal isOpen={accountOpen} onClose={() => setAccountOpen(false)} />}
      {user && (
        <ItemModal
          isOpen={listing}
          onClose={() => setListing(false)}
          onSaved={(item) => {
            setListing(false);
            // Straight to the page it now has, which is where its calendar is
            // and what there is to send to somebody.
            navigate(`/i/${item.id}`);
          }}
        />
      )}
    </>
  );
}
