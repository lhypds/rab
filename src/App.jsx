import { Loading, useAuth } from "./components/index.js";
import { AuthPage, HomePage, ItemPage, MinePage, PreviewPage, RentalsPage, UserPage } from "./pages/index.js";
import { Navigate, useLocation } from "./ui/index.js";

// One segment after a prefix, decoded, or nothing where the path is not that
// shape: /i/<id> is an item and /u/<name> is a person.
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

export default function App() {
  const { ready, user } = useAuth();
  const { pathname } = useLocation();
  if (!ready) return <Loading />;

  // The map and an item's page are open to anybody: they are what a link that
  // somebody was sent opens on. Only what is your own asks who you are.
  if (pathname === "/") return <HomePage />;
  if (pathname === "/login") return <AuthPage />;
  if (pathname === "/mine") return user ? <MinePage /> : <Navigate to="/login?next=/mine" replace />;
  if (pathname === "/preview") return <PreviewPage />;
  if (pathname === "/rentals") return user ? <RentalsPage /> : <Navigate to="/login?next=/rentals" replace />;

  const itemId = segment(pathname, "/i/");
  if (itemId) return <ItemPage key={itemId} id={itemId} />;

  const username = segment(pathname, "/u/");
  if (username) return <UserPage key={username} username={username.normalize("NFKC").toLowerCase()} />;

  return <Navigate to="/" replace />;
}
