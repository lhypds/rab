import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { LanguageSwitcher, rememberedUsername, useAuth } from "../../components/index.js";
import { Modal, Navigate, useNavigate, useSearchParams } from "../../ui/index.js";

// Where the administrator's word can be had, and the whole of what rab can do
// about a forgotten password: there is no reset link, because there is no
// address on file to send one to — an account is a name and a password and
// nothing else. Set in .env, and left out of the sheet below where it is not.
const ADMIN_EMAIL = String(import.meta.env.VITE_ADMIN_EMAIL ?? "").trim();

const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;

// The gap between the words on the line under the field and the ways out of the
// step at the end of it, and between those two words themselves. An en space,
// as in lo: each of those words is underlined, and a single word space between
// two underlined words reads as one underline with a nick in it.
const SPACE = "\u2002";

// Where to go once signed in: the page that sent the reader here, where it is
// one of rab's own, and the map otherwise.
function destination(next) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

// Signing in, in two goes: the name, then the password. A name nobody has is
// asked about before an account is opened on it, since it is more often a typo
// than a new person.
export default function AuthPage() {
  const { t } = useTranslation();
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = destination(searchParams.get("next"));
  const [username, setUsername] = useState(rememberedUsername());
  const [password, setPassword] = useState("");
  const [step, setStep] = useState("name");
  // Whether the password being typed is one being chosen for a new account.
  const [opening, setOpening] = useState(false);
  const [pending, setPending] = useState("");
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={next} replace />;

  function nameError(requestError) {
    if (requestError.code === "USER_EXISTS") return t("auth.usernameTaken");
    if (requestError.status === 400) return t("auth.usernameRule");
    return requestError.message;
  }

  function passwordError(requestError) {
    if (requestError.code === "PASSWORD_WRONG") return t("auth.passwordWrong");
    if (requestError.code === "PASSWORD_INVALID") {
      return t("auth.passwordRule", { min: PASSWORD_MIN, max: PASSWORD_MAX });
    }
    return requestError.message;
  }

  async function submitName(event) {
    event.preventDefault();
    if (submitting) return;
    const name = username.trim().normalize("NFKC").toLowerCase();
    if (!name) return;
    setSubmitting(true);
    setError("");
    try {
      await api.checkUsername(name);
      setUsername(name);
      setOpening(false);
      setStep("password");
    } catch (requestError) {
      if (requestError.code === "USER_NOT_FOUND") setPending(name);
      else setError(nameError(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  function confirmNew() {
    setUsername(pending);
    setPending("");
    setOpening(true);
    setStep("password");
  }

  function back() {
    setStep("name");
    setPassword("");
    setOpening(false);
    setError("");
  }

  async function submitPassword(event) {
    event.preventDefault();
    if (submitting) return;
    if (!password) return setError(t("auth.passwordRequired"));
    setSubmitting(true);
    setError("");
    try {
      if (opening) await register(username, password);
      else await login(username, password);
      navigate(next, { replace: true });
    } catch (requestError) {
      if (requestError.code === "USER_NOT_FOUND" || requestError.code === "USER_EXISTS") {
        back();
        setError(nameError(requestError));
      } else {
        setError(passwordError(requestError));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const naming = step === "name";
  const hint = opening ? t("auth.passwordChooseHint", { min: PASSWORD_MIN }) : "";
  const message = error || hint;
  // Whether the words on that line need a space before the way out at the end of
  // them: a sentence brings its own, the stop being the space, and where there
  // are no words there is nothing to separate.
  const spaced = Boolean(message) && !/[.。!！?？]$/.test(message);

  return (
    <>
      <main className="auth-page">
        <span className="auth-lang">
          <LanguageSwitcher />
        </span>
        <section className="auth-card" aria-labelledby="login-title">
          <h1 id="login-title" className="auth-logo">
            rab
          </h1>

          {naming ? (
            <form className="login-form" onSubmit={submitName} autoComplete="off">
              <label className="sr-only" htmlFor="rab-handle">
                {t("auth.username")}
              </label>
              <div className="joined-field">
                <input
                  id="rab-handle"
                  name="rab-handle"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setError("");
                  }}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                  enterKeyHint="next"
                  placeholder={t("auth.username")}
                  maxLength={32}
                />
                <button type="submit" disabled={submitting}>
                  {t("auth.next")}
                </button>
              </div>
            </form>
          ) : (
            <form className="login-form" onSubmit={submitPassword}>
              <label className="sr-only" htmlFor="rab-password">
                {t("auth.password")}
              </label>
              <div className="joined-field">
                <input
                  id="rab-password"
                  name="rab-password"
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError("");
                  }}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete={opening ? "new-password" : "current-password"}
                  enterKeyHint="go"
                  placeholder={t("auth.password")}
                  maxLength={PASSWORD_MAX}
                />
                <button type="submit" disabled={submitting}>
                  {opening ? t("auth.create") : t("auth.login")}
                </button>
              </div>
            </form>
          )}

          {/* The one line under the field: what it wants, or what was wrong with
              what it was given — and on the second step, the way back. */}
          <p className="form-message">
            {message}
            {!naming && spaced && SPACE}
            {/* Not offered while a password is being chosen this minute: one not
                yet had is not one to have forgotten. */}
            {!naming && !opening && (
              <>
                <button type="button" className="auth-forgot" onClick={() => setForgot(true)} disabled={submitting}>
                  {t("auth.forgot")}
                </button>
                {SPACE}
              </>
            )}
            {!naming && (
              <button type="button" className="auth-back" onClick={back} disabled={submitting}>
                {t("auth.back")}
              </button>
            )}
          </p>
        </section>
      </main>

      <Modal isOpen={Boolean(pending)} title={t("auth.createTitle")} onClose={() => setPending("")} closeOnOverlay>
        <p className="modal-text">{t("auth.createConfirm", { name: pending })}</p>
        <div className="modal-actions">
          <button type="button" className="outline-button" onClick={() => setPending("")}>
            {t("common.cancel")}
          </button>
          <button type="button" className="primary-button" onClick={confirmNew}>
            {t("auth.create")}
          </button>
        </div>
      </Modal>

      {/* rab cannot send a password out: an account is a name and a password and
          no address to send anything to. So the answer is a word to the
          administrator, written from the reader's own mail app with the account
          already named in it. */}
      <Modal isOpen={forgot} title={t("auth.forgotTitle")} onClose={() => setForgot(false)} closeOnOverlay>
        <p className="modal-text">{ADMIN_EMAIL ? t("auth.forgotBody", { email: ADMIN_EMAIL }) : t("auth.forgotNoAdmin")}</p>
        <div className="modal-actions">
          <button type="button" className="outline-button" onClick={() => setForgot(false)}>
            {t("common.cancel")}
          </button>
          {ADMIN_EMAIL && (
            <a
              className="primary-button"
              href={`mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(
                t("auth.forgotSubject", { name: username }),
              )}&body=${encodeURIComponent(t("auth.forgotMail", { name: username }))}`}
              onClick={() => setForgot(false)}
            >
              {t("auth.forgotSend")}
            </a>
          )}
        </div>
      </Modal>
    </>
  );
}
