import { useEffect, useRef, useState } from "react";
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
import * as api from "../../api.js";
import { homePath } from "../../utils/categories.js";
import { priceLine } from "../../utils/format.js";
import { listedNow, seek } from "../../utils/seek.js";
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

// What has been asked of the AI and what it answered, oldest first: asking
// again goes on from it. Kept outside the bar, which each page puts up anew,
// for as long as the tab is open; ASK_ROUNDS at most with the question being
// asked, the oldest let go of first.
const ASK_ROUNDS = 7;
// How many of the page's rows are told with a question, to be chosen among.
const ASK_SEEN = 40;
let rounds = [];

// How far apart two places are, in metres, as the crow flies.
function metresBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(h)));
}

export default function Header({ back = false, view, onView, query = "", onQuery }) {
  const { t, i18n } = useTranslation();
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
  // What is written in the box: something asked of the AI, in the asker's
  // own words — or, once it has been turned into a search, the word the list
  // is narrowed to, which the box then shows (as it shows one typed into the
  // list's own box: the two say the same thing).
  const [written, setWritten] = useState(query);
  useEffect(() => {
    if (onQuery) setWritten(query);
  }, [query]);
  // What the AI said to do about it, hung under the box: a line, and the one
  // control to press — { say, action, words, category } — or { thinking } while it is
  // being worked out. The control it means is ringed in the bar meanwhile.
  const [hint, setHint] = useState(null);
  const asking = useRef(null);
  const boxRef = useRef(null);
  const dismiss = () => {
    asking.current?.abort();
    asking.current = null;
    setHint(null);
  };
  // The list narrowed to a word: here where the page has the list, and on the
  // home page otherwise, which is gone to.
  const look = (words) => {
    if (onQuery) return onQuery(words);
    seek(words);
    navigate("/");
  };
  const write = (value) => {
    setWritten(value);
    // Emptied, it lets go of what it was narrowing to and of what was said.
    if (!value) {
      if (onQuery && query) onQuery("");
      dismiss();
    }
  };
  async function ask(value) {
    const question = String(value ?? "").trim();
    if (!question) return;
    asking.current?.abort();
    const controller = new AbortController();
    asking.current = controller;
    setHint({ thinking: true });
    // Asked, the box is empty again for the next thing — and lets go of what
    // the list was narrowed to before, the answer being about to say anew.
    setWritten("");
    if (onQuery && query) onQuery("");
    try {
      // What the page lists as this is asked, the first rows of it: what the
      // AI may choose one of ("pick one for me"), each as its row says it.
      // With where the reader stands, and how far each row is from there:
      // the nearest of them are the ones told, where there are more.
      const { items: listed, narrowed, where } = onView ? listedNow() : { items: [], narrowed: false, where: null };
      const far = (item) => (where && item.latitude != null && item.longitude != null ? metresBetween(where, item) : null);
      const rows = (where ? [...listed].sort((a, b) => (far(a) ?? Infinity) - (far(b) ?? Infinity)) : listed).slice(0, ASK_SEEN);
      const seen = {
        narrowed,
        where: where && { name: where.name, exact: where.exact, away: where.away },
        items: rows.map((item) => ({
          id: String(item.id),
          title: item.title,
          what: item.what ?? "",
          category: item.category ?? "",
          price: priceLine(item, i18n.language, t),
          place: item.place ?? item.region?.name ?? "",
          rating: item.rating?.average ?? item.rating?.stars ?? (typeof item.rating === "number" ? item.rating : 0),
          count: item.spot ? item.count ?? 0 : 0,
          distance: far(item),
        })),
      };
      const answer = await api.ask(question, i18n.language.slice(0, 2), onView ? view : null, rounds, seen, { signal: controller.signal });
      if (asking.current !== controller) return;
      // The one chosen, kept with the answer for its button to open.
      if (answer.action === "open") answer.chosen = rows.find((item) => String(item.id) === answer.item) ?? null;
      if (answer.action === "open" && !answer.chosen) answer.action = "none";
      const { chosen: _row, item: _id, ...said } = answer;
      rounds = [...rounds, { question, ...said }].slice(-(ASK_ROUNDS - 1));
      setHint(answer);
    } catch (error) {
      if (asking.current !== controller) return;
      // A server with no model to ask is a box that searches, as it was.
      if (error.code === "DESCRIBE_UNAVAILABLE") {
        setHint(null);
        look(question);
      } else {
        setHint({ say: t(error.code === "DESCRIBE_BUSY" ? "ask.busy" : "ask.failed"), action: "search", words: question.slice(0, 60) });
      }
    } finally {
      if (asking.current === controller) asking.current = null;
    }
  }
  // The step the hint points at, taken — by its own button under the words.
  function follow() {
    const { action, words, category, chosen } = hint;
    const mine = (go) => (user ? go() : navigate(loginPath()));
    setHint(null);
    if (action === "open") navigate(itemPath(chosen));
    else if (action === "search") look(words);
    else if (action === "category") navigate(homePath(category));
    else if (action === "add") post();
    else if (action === "request") need(words);
    else if (action === "mine") mine(() => navigate("/mine"));
    else if (action === "messages") mine(() => setMessagesOpen(true));
    else if (action === "travel") setTravelOpen(true);
    else if (action === "account") mine(() => setAccountOpen(true));
    else if (action === "list" || action === "map") onView ? onView(action) : navigate("/");
  }
  // What its button says: the step, in the language the hint was said in —
  // the one the question was typed in, where that is not the page's.
  const said = hint?.lang ? i18n.getFixedT(hint.lang) : t;
  const step = !hint || hint.thinking || hint.action === "none"
    ? null
    : hint.action === "account" && !user
      ? said("header.signIn")
      : said(`ask.do.${hint.action}`, { words: hint.words, category: hint.category ? said(`category.${hint.category}`) : "" });
  // Put away by Escape, and by a press anywhere but on it or the box.
  useEffect(() => {
    if (!hint) return undefined;
    const key = (event) => {
      if (event.key === "Escape") dismiss();
    };
    const press = (event) => {
      if (!boxRef.current?.contains(event.target)) dismiss();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", press);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", press);
    };
  }, [hint]);

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
      <header className="topbar" data-guide={hint?.action}>
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
                write("");
                onQuery?.("");
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
            "Request", which asks for something — and a box that is asked:
            what somebody wants, said in their own words, and Enter has the
            AI say what to do about it here — a hint hung under the box, with
            the one thing to press (see `ask`). The request form opens already
            saying what the list is narrowed to. Not on a phone, where the bar is full — there the two are
            marks among the buttons, and the box that narrows stands over the
            list (see MapView). */}
        <span className="topbar-filter">
          <button type="button" className="topbar-have" data-guide-target="add" onClick={post}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            {t("header.have")}
          </button>
          <button type="button" className="topbar-have topbar-ask" data-guide-target="request" onClick={() => need(query)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m15.5 15.5 5 5" />
            </svg>
            {t("header.need")}
          </button>
          <span className="topbar-ask-box" ref={boxRef}>
            <FilterBox slash brain busy={Boolean(hint?.thinking)} value={written} onChange={write} onEnter={ask} placeholder={t("ask.placeholder")} />
            {hint && (
              <span className="ask-hint" role="status">
                {hint.thinking ? (
                  <span className="ask-hint-say ask-hint-thinking">{t("ask.thinking")}</span>
                ) : (
                  <>
                    <span className="ask-hint-say">{hint.say}</span>
                    {step && (
                      <button type="button" className="ask-hint-do" onClick={follow}>
                        {step}
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M5 12h14" />
                          <path d="m13 6 6 6-6 6" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
                <button type="button" className="ask-hint-close" aria-label={t("ask.close")} onClick={dismiss}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </span>
            )}
          </span>
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
              <ActionButton tooltip={t("header.viewMap")} data-guide-target="map" aria-pressed={view === "map"} onClick={() => onView("map")}>
                <svg viewBox="0 0 24 24">
                  <path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
                  <path d="M9 4v14" />
                  <path d="M15 6v14" />
                </svg>
              </ActionButton>
              <ActionButton tooltip={t("header.viewList")} data-guide-target="list" aria-pressed={view === "list"} onClick={() => onView("list")}>
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
            <ActionButton tooltip={t("header.mine")} data-guide-target="mine" onClick={() => navigate("/mine")}>
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
            <ActionButton tooltip={t("travel.title")} data-guide-target="travel" onClick={() => setTravelOpen(true)}>
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
                data-guide-target="messages"
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
            data-guide-target="account"
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
