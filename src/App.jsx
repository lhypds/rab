import { Loading, ReviewPrompt, useAuth } from "./components/index.js";
import { AuthPage, HomePage, ItemPage, MinePage, PreviewPage, RequestPage, UserPage } from "./pages/index.js";
import { useRef } from "react";
import { LocationScope, Navigate, useLocation } from "./ui/index.js";
import { homeFilter, homePath } from "./utils/categories.js";

// One segment after a prefix, decoded, or nothing where the path is not that
// shape: /i/<id> is an item, /s/<id> a spot, /r/<id> a request and /u/<name>
// a person.
function segment(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return "";
  const rest = pathname.slice(prefix.length).replace(/\/$/, "");
  if (!rest || rest.includes("/")) return "";
  try {
    return decodeURIComponent(rest);
  } catch {
    return "";
  }
}

// Whatever page is open, a booking that is complete asks both its sides to
// rate each other: the sheet for that stands over all of them.
export default function App() {
  return (
    <>
      <Page />
      <ReviewPrompt />
    </>
  );
}

function Page() {
  const { ready, user } = useAuth();
  const location = useLocation();
  // The map as it was last left, kept standing out of sight while an item's
  // or a spot's page is open over it, so that the way back finds it where it
  // was — its place, its scale, its list — rather than loading it again.
  const keptHome = useRef(null);
  if (!ready) return <Loading />;

  const home = homeFilter(location.pathname);
  const page = otherPage(location.pathname, user);
  if (home && !home.old) keptHome.current = location;
  else if (!isItemPath(location.pathname)) keptHome.current = null;

  return (
    <>
      {keptHome.current && (
        <LocationScope location={keptHome.current}>
          <div hidden={Boolean(page)}>
            <HomePage active={!page} />
          </div>
        </LocationScope>
      )}
      {page}
    </>
  );
}

// An item's page or a spot's: what the map is kept standing under.
function isItemPath(pathname) {
  return Boolean(segment(pathname, "/i/") || segment(pathname, "/s/") || segment(pathname, "/r/") || /^\/u\/[^/]+\/p\/[^/]+\/?$/.test(pathname));
}

// Whatever is open that is not the map: null on the map itself.
function otherPage(pathname, user) {
  // The map and an item's page are open to anybody: they are what a link that
  // somebody was sent opens on. Only what is your own asks who you are.
  // What it is narrowed to is in its address — /c/camera — so a link to it
  // opens on the same category. One from before every listing was an item
  // (/things/camera) is put at its own.
  const home = homeFilter(pathname);
  if (home?.old) return <Navigate to={homePath(home.category)} replace />;
  if (home) return null;
  if (pathname === "/login") return <AuthPage />;
  if (pathname === "/mine") return user ? <MinePage /> : <Navigate to="/login?next=/mine" replace />;
  if (pathname === "/preview") return <PreviewPage />;
  // What you asked other people for and what you kept had a page of their
  // own once (/others, and /rentals before that): they are on /mine now.
  if (pathname === "/others" || pathname === "/rentals") return <Navigate to="/mine" replace />;

  const itemId = segment(pathname, "/i/");
  if (itemId) return <ItemPage key={itemId} id={itemId} />;

  // /s/<id> is a spot — one of the stores somebody made of their items: an
  // item like any other (see server/db.js), at an address of its own.
  const spotId = segment(pathname, "/s/");
  if (spotId) return <ItemPage key={spotId} id={spotId} />;

  // /r/<id> is a request — what somebody needs ("I need"): a page of its own
  // too, to be sent to whoever might have one.
  const requestId = segment(pathname, "/r/");
  if (requestId) return <RequestPage key={requestId} id={requestId} />;

  // /u/<name>/p/<id> is where a spot was before: opened, and put right to
  // /s/<id> (see ItemPage).
  const page = /^\/u\/([^/]+)\/p\/([^/]+)\/?$/.exec(pathname);
  if (page) {
    try {
      const id = decodeURIComponent(page[2]);
      return <ItemPage key={id} id={id} />;
    } catch {
      return <Navigate to="/" replace />;
    }
  }

  const username = segment(pathname, "/u/");
  if (username) return <UserPage key={username} username={username.normalize("NFKC").toLowerCase()} />;

  return <Navigate to="/" replace />;
}
