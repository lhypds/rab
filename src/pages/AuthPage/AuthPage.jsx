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
// than a new person. Opening one takes two goes more: an address, and the
// code that is mailed to it — which is what shows the address is theirs.
export default function AuthPage() {
  const { t, i18n } = useTranslation();
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = destination(searchParams.get("next"));
  const [username, setUsername] = useState(rememberedUsername());
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // Whether this server asks a new account for an address and its code: a
  // setting of the server's, asked for when an account is about to be opened.
  const [verifying, setVerifying] = useState(false);
  // "name", "password", and for a new account "email" and then "code".
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
    // Asked now and not waited on: the password comes first either way. A
    // server that cannot say is one from before there was anything to ask.
    api
      .signupRules()
      .then((rules) => setVerifying(rules?.email === true))
      .catch(() => setVerifying(false));
    setUsername(pending);
    setPending("");
    setOpening(true);
    setStep("password");
  }

  function back() {
    setStep("name");
    setPassword("");
    setEmail("");
    setCode("");
    setOpening(false);
    setError("");
  }

  // What went wrong with the address or the code, in the reader's words.
  function mailError(requestError) {
    const said = {
      EMAIL_INVALID: t("auth.emailInvalid"),
      EMAIL_TAKEN: t("auth.emailTaken"),
      MAIL_FAILED: t("auth.mailFailed"),
      CODE_TOO_SOON: t("auth.codeTooSoon"),
      CODE_WRONG: t("auth.codeWrong"),
      CODE_EXPIRED: t("auth.codeExpired"),
    };
    return said[requestError.code] ?? passwordError(requestError);
  }

  // The code is mailed to the address: from the address step, and again from
  // the code step by whoever did not get it.
  async function sendCode(event) {
    event?.preventDefault();
    if (submitting) return;
    const address = email.trim();
    if (!address) return setError(t("auth.emailRequired"));
    setSubmitting(true);
    setError("");
    try {
      await api.sendSignupCode(username, password, address, i18n.language);
      setEmail(address);
      setCode("");
      setStep("code");
    } catch (requestError) {
      if (requestError.code === "USER_EXISTS") {
        back();
        setError(nameError(requestError));
      } else {
        setError(mailError(requestError));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCode(event) {
    event.preventDefault();
    if (submitting) return;
    if (!code.trim()) return setError(t("auth.codeRequired"));
    setSubmitting(true);
    setError("");
    try {
      await register(username, password, email, code.trim());
      navigate(next, { replace: true });
    } catch (requestError) {
      if (requestError.code === "USER_EXISTS") {
        back();
        setError(nameError(requestError));
      } else {
        setError(mailError(requestError));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    if (submitting) return;
    if (!password) return setError(t("auth.passwordRequired"));
    // A password being chosen is not sent anywhere yet: the address is asked
    // for next, and the account is made once its code has come back.
    if (opening && verifying) {
      if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
        return setError(t("auth.passwordRule", { min: PASSWORD_MIN, max: PASSWORD_MAX }));
      }
      setError("");
      return setStep("email");
    }
    setSubmitting(true);
    setError("");
    try {
      // Where no address is asked for, the password is all a new account takes.
      if (opening) await register(username, password);
      else await login(username, password);
      navigate(next, { replace: true });
    } catch (requestError) {
      if (requestError.code === "USER_NOT_FOUND" || requestError.code === "USER_EXISTS") {
        back();
        setError(nameError(requestError));
      } else if (requestError.code === "EMAIL_INVALID") {
        // The setting was turned on since the form asked: the address is
        // asked for after all.
        setVerifying(true);
        setStep("email");
      } else {
        setError(passwordError(requestError));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const naming = step === "name";
  const hint =
    step === "email"
      ? t("auth.emailHint")
      : step === "code"
        ? t("auth.codeHint", { email })
        : opening
          ? t("auth.passwordChooseHint", { min: PASSWORD_MIN })
          : "";
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
          ) : step === "email" ? (
            <form className="login-form" onSubmit={sendCode}>
              <label className="sr-only" htmlFor="rab-email">
                {t("auth.email")}
              </label>
              <div className="joined-field">
                <input
                  id="rab-email"
                  name="rab-email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError("");
                  }}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="email"
                  enterKeyHint="next"
                  placeholder={t("auth.email")}
                  maxLength={254}
                />
                <button type="submit" disabled={submitting}>
                  {t("auth.sendCode")}
                </button>
              </div>
            </form>
          ) : step === "code" ? (
            <form className="login-form" onSubmit={submitCode}>
              <label className="sr-only" htmlFor="rab-code">
                {t("auth.code")}
              </label>
              <div className="joined-field">
                <input
                  id="rab-code"
                  name="rab-code"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                    setError("");
                  }}
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  enterKeyHint="go"
                  placeholder={t("auth.code")}
                  maxLength={6}
                />
                <button type="submit" disabled={submitting}>
                  {t("auth.create")}
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
                  {opening ? (verifying ? t("auth.next") : t("auth.create")) : t("auth.login")}
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
            {/* The code did not come: the way to have it mailed again. */}
            {step === "code" && (
              <>
                <button type="button" className="auth-forgot" onClick={() => sendCode()} disabled={submitting}>
                  {t("auth.resend")}
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
