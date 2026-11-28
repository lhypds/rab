import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionButton, canGoBack, Link, useNavigate } from "../../ui/index.js";
import { loginPath, useAuth } from "../AuthProvider/index.js";
import AccountModal from "../AccountModal/index.js";
import FilterBox from "../FilterBox/index.js";
import ItemModal from "../ItemModal/index.js";
import LanguageSwitcher from "../LanguageSwitcher/index.js";
import MessagesModal from "../MessagesModal/index.js";
import RequestModal from "../RequestModal/index.js";
import TravelModal from "../TravelModal/index.js";
import { itemPath } from "../../utils/spots.js";

// The bar on every page. `back` swaps the wordmark for the way back, on the
// pages that are somewhere you went to rather than where you start: back to the
// list the page was opened from, where it was opened from one (the row says so
// in the entry's state), and to the map otherwise.
// Asked of the window by anything that wants the form for putting something
// out for rent opened: `window.dispatchEvent(new Event(LIST_EVENT))`.
export const LIST_EVENT = "rab:list";
// And by anything that wants the account's messages opened.
export const MESSAGES_EVENT = "rab:messages";
// And by anything that wants the form for asking for something opened ("I
// need"); told with the request once one is posted (REQUESTED_EVENT, its
// `detail`), for the map to show it.
export const NEED_EVENT = "rab:need";
export const REQUESTED_EVENT = "rab:requested";
// Told when the wordmark is pressed: the map goes back to showing what is
// offered (see MapView).
export const HOME_EVENT = "rab:home";

export default function Header({ back = false, view, onView, query = "", onQuery }) {
  const { t } = useTranslation();
  const { user, unread } = useAuth();
  const navigate = useNavigate();
  // Never a step back off the site: from anywhere else it is home.
  const fromList = back && canGoBack();
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
  const post = () => (user ? setListing(true) : navigate(loginPath()));
  const [travelOpen, setTravelOpen] = useState(false);
  // The form for asking for something, and what it opens already saying is
  // looked for: what was written in the bar's box when Enter was pressed.
  const [needing, setNeeding] = useState(false);
  const [needed, setNeeded] = useState("");
  const need = (words) => {
    if (!user) return navigate(loginPath());
    setNeeded(typeof words === "string" ? words.trim() : "");
    setNeeding(true);
  };
  // What is written in the box, on a page with no list for it to narrow.
  const [written, setWritten] = useState("");

  // The form for putting something out is opened from the bar, and from
  // wherever else on the page asks for it (see LIST_EVENT): an area with
  // nothing in it does. A stranger is sent to sign in first, as from the bar.
  useEffect(() => {
    const open = post;
    const read = () => (user ? setMessagesOpen(true) : navigate(loginPath()));
    window.addEventListener(LIST_EVENT, open);
    const ask = () => need();
    window.addEventListener(NEED_EVENT, ask);
    window.addEventListener(MESSAGES_EVENT, read);
    return () => {
      window.removeEventListener(LIST_EVENT, open);
      window.removeEventListener(NEED_EVENT, ask);
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
            // The way home, and home is everything that is offered: the map
            // is told to turn back to offers, where it was showing requests,
            // and what was being searched for is let go of. (The category is
            // in the address, and "/" is none.)
            <Link
              className="wordmark"
              to="/"
              onClick={() => {
                window.dispatchEvent(new Event(HOME_EVENT));
                (onQuery ?? setWritten)("");
              }}
            >
              {/* rab's own mark, as its icon has it: a glass with a plus in
                  it — what is looked for, and what is put out. */}
              <svg className="wordmark-icon" viewBox="0 0 512 512" aria-hidden="true">
                <circle cx="216" cy="216" r="150" />
                <path d="M322 322 470 470" />
                <path d="M216 146v140" />
                <path d="M146 216h140" />
              </svg>
              rab
            </Link>
          )}
        </span>
        {/* In the middle of the bar: the two buttons that add to the map
            rather than read it — "Add", which puts something out, and
            "Request", which asks for something — and a box that searches:
            what is written in it narrows the list on the page that has one.
            The request form opens already saying what is written in the
            box. Not on a phone, where the bar is full — there the two are
            marks among the buttons, and the box that narrows stands over the
            list (see MapView). */}
        <span className="topbar-filter">
          <button type="button" className="topbar-have" onClick={post}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            {t("header.have")}
          </button>
          <button type="button" className="topbar-have topbar-ask" onClick={() => need(onQuery ? query : written)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m15.5 15.5 5 5" />
            </svg>
            {t("header.need")}
          </button>
          <FilterBox slash value={onQuery ? query : written} onChange={onQuery ?? setWritten} placeholder={t("search.placeholder")} />
        </span>
        <span className="topbar-action-slot">
          {/* On a phone only, where the middle of the bar is put away: "I
              have" — a plus in a ring — and "I need" — a glass — as marks. */}
          <button type="button" className="topbar-word" aria-label={t("header.have")} title={t("header.have")} onClick={post}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v8" />
              <path d="M8 12h8" />
            </svg>
          </button>
          <button type="button" className="topbar-word" aria-label={t("header.need")} title={t("header.need")} onClick={() => need()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m15.5 15.5 5 5" />
            </svg>
          </button>
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
          {/* What is yours: what you have out, who has asked for any of it,
              and what you have asked other people for and kept. */}
          {user && (
            <ActionButton tooltip={t("header.mine")} onClick={() => navigate("/mine")}>
              <svg viewBox="0 0 24 24">
                <path d="M3 8l9-5 9 5v8l-9 5-9-5z" />
                <path d="M3 8l9 5 9-5" />
                <path d="M12 13v8" />
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
      {user && (
        <RequestModal
          isOpen={needing}
          title={needed}
          onClose={() => setNeeding(false)}
          onSaved={(request) => {
            setNeeding(false);
            window.dispatchEvent(new CustomEvent(REQUESTED_EVENT, { detail: request }));
          }}
        />
      )}
      {user && <AccountModal isOpen={accountOpen} onClose={() => setAccountOpen(false)} />}
      {user && (
        <ItemModal
          isOpen={listing}
          onClose={() => setListing(false)}
          onSaved={(item) => {
            setListing(false);
            // Straight to the page it now has, which is where its calendar is
            // and what there is to send to somebody — a page's at its own
            // address under its owner's.
            navigate(itemPath(item));
          }}
        />
      )}
    </>
  );
}
