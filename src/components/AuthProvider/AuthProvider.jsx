import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "../../api.js";

const storageKey = "rab:user";
const AuthContext = createContext(null);

// The name last signed in with on this browser, to put back in the field.
export function rememberedUsername() {
  try {
    return localStorage.getItem(storageKey) || "";
  } catch {
    return "";
  }
}

function remember(username) {
  try {
    if (username) localStorage.setItem(storageKey, username);
    else localStorage.removeItem(storageKey);
  } catch {
    // The field starts empty next time, which is all this costs.
  }
}

// How often the count of unread messages is asked for while nothing else is
// asking: the dot on the envelope is the only thing waiting on it.
const UNREAD_REFRESH_MS = 60 * 1000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Nobody is signed in on a browser holding no token, and that is most
    // visits to a link somebody was sent: the page opens without a round trip.
    if (!api.hasSession()) {
      setReady(true);
      return undefined;
    }
    api
      .getSession()
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setUnread(data.unread ?? 0);
      })
      .catch(() => {
        // Signed out, or the server could not be reached: either way the page
        // opens as it would for a stranger, which is all of it but the writing.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const username = user?.username ?? null;
  useEffect(() => {
    if (!username) return undefined;
    const ask = () => {
      if (document.hidden) return;
      api
        .getUnread()
        .then((data) => setUnread(data.unread ?? 0))
        .catch((error) => {
          if (error?.status === 401) setUser(null);
        });
    };
    const timer = window.setInterval(ask, UNREAD_REFRESH_MS);
    document.addEventListener("visibilitychange", ask);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [username]);

  function signedIn(data) {
    remember(data.user.username);
    setUser(data.user);
    setUnread(data.unread ?? 0);
    return data.user;
  }

  const login = (name, password) => api.login(name, password).then(signedIn);
  const register = (name, password) => api.createUser(name, password).then(signedIn);

  async function logout() {
    await api.logout().catch(() => {});
    setUser(null);
    setUnread(0);
  }

  const noteUnread = useCallback((count) => setUnread(count), []);
  const updateUser = useCallback((account) => setUser(account), []);

  return (
    <AuthContext.Provider value={{ user, ready, unread, noteUnread, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Where to send somebody who has to sign in first, so that they land back on
// the page they were reading once they have.
export function loginPath() {
  const here = `${window.location.pathname}${window.location.search}`;
  return here === "/" || here.startsWith("/login") ? "/login" : `/login?next=${encodeURIComponent(here)}`;
}
