import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Link, Modal, Select, showToast, useNavigate } from "../../ui/index.js";
import { dialCodeOf, dialCodes, splitDialCode } from "../../utils/dialing.js";
import { formatDate, formatUsername } from "../../utils/format.js";
import { useRegion } from "../../utils/region.js";
import { useAuth } from "../AuthProvider/index.js";
import styles from "./account.module.css";

// The ways an account can say it is reached, and how many of them.
const CONTACT_TYPES = ["phone", "email", "address"];
const CONTACT_INPUT = { phone: "tel", email: "email", address: "text" };
const CONTACT_MAX = 200;
const CONTACTS_MAX = 5;

// A way as it is kept, as a line of the form: a phone number is its code and
// its digits; one kept with its code in front has it read off.
function lineOf(contact) {
  if (contact.type !== "phone") return { type: contact.type, value: contact.value };
  const split = contact.code ? { code: contact.code, value: contact.value } : splitDialCode(contact.value);
  return { type: "phone", code: split?.code, value: String(split?.value ?? contact.value).replace(/\D/g, "") };
}

// Your own account, as a sheet over whatever page you were on: who you are
// here, how you are reached, and the way out.
//
// How you are reached is yours to write here — a phone number, an email
// address, an address — and nowhere else: nothing written on an item is kept
// for the account. What is here is what an item of yours that is booked by
// asking starts with (see the item form).
export default function AccountModal({ isOpen, onClose }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const lang = i18n.language;
  const dialCode = dialCodeOf(useRegion().country);
  const dialOptions = useMemo(
    () => dialCodes(lang).map(({ code, name }) => ({ value: code, short: code, label: `${code} ${name}`, text: `${code} ${name}` })),
    [lang],
  );
  // The lines as they are being written, null until they have been read; and
  // whether they differ from what is kept.
  const [contacts, setContacts] = useState(null);
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The account's own address: what is kept ({ email, verify }, null until it
  // has been read), what is written in the box, and — where a new one has to
  // be proved — the address a code was mailed to and the code typed back.
  const [account, setAccount] = useState(null);
  const [email, setEmail] = useState("");
  const [codeFor, setCodeFor] = useState("");
  const [code, setCode] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    if (!isOpen || !user) return undefined;
    let cancelled = false;
    setContacts(null);
    setChanged(false);
    setError("");
    setAccount(null);
    setEmail("");
    setCodeFor("");
    setCode("");
    setEmailError("");
    api
      .getAccount()
      .then((answer) => {
        if (cancelled) return;
        setAccount(answer);
        setEmail(answer.email ?? "");
      })
      .catch(() => !cancelled && setAccount({ email: null, verify: false }));
    api
      .getContacts()
      .then((answer) => !cancelled && setContacts((answer.contacts ?? []).slice(0, CONTACTS_MAX).map(lineOf)))
      .catch(() => !cancelled && setContacts([]));
    return () => {
      cancelled = true;
    };
  }, [isOpen, user]);

  if (!user) return null;

  async function signOut() {
    onClose();
    await logout();
    navigate("/");
  }

  // The address as it would be kept, whether it differs from the one that is,
  // and whether its code has been sent and is waited for.
  const typedEmail = email.trim().toLowerCase();
  const emailChanged = Boolean(account) && typedEmail !== (account.email ?? "");
  const proving = Boolean(account?.verify) && typedEmail !== "";
  const awaitingCode = proving && codeFor === typedEmail;

  function emailFault(requestError) {
    const known = {
      EMAIL_INVALID: "auth.emailInvalid",
      EMAIL_TAKEN: "auth.emailTaken",
      MAIL_FAILED: "auth.mailFailed",
      CODE_WRONG: "auth.codeWrong",
      CODE_EXPIRED: "auth.codeExpired",
      CODE_TOO_SOON: "auth.codeTooSoon",
    }[requestError.code];
    return known ? t(known) : requestError.message;
  }

  // One button, two goes where the address has to be proved: the first mails
  // the code, the second brings it back with the address.
  async function saveEmail(event) {
    event.preventDefault();
    if (emailBusy || !emailChanged) return;
    setEmailBusy(true);
    setEmailError("");
    try {
      if (proving && !awaitingCode) {
        await api.sendEmailCode(typedEmail, lang);
        setCodeFor(typedEmail);
        setCode("");
      } else {
        const answer = await api.setAccountEmail(typedEmail, awaitingCode ? code : undefined);
        setAccount({ ...account, email: answer.email });
        setEmail(answer.email ?? "");
        setCodeFor("");
        setCode("");
        showToast(t(answer.email ? "account.emailSaved" : "account.emailRemoved"), 2000);
      }
    } catch (requestError) {
      // A code that is no good any more is asked for again.
      if (requestError.code === "CODE_EXPIRED") setCodeFor("");
      setEmailError(emailFault(requestError));
    } finally {
      setEmailBusy(false);
    }
  }

  const edit = (next) => {
    setContacts(next);
    setChanged(true);
    setError("");
  };
  const setContact = (index, patch) => edit(contacts.map((contact, each) => (each === index ? { ...contact, ...patch } : contact)));

  async function save(event) {
    event.preventDefault();
    if (saving || !contacts) return;
    setSaving(true);
    try {
      // A line left empty is not kept.
      const answer = await api.saveContacts(
        contacts
          .map((contact) =>
            contact.type === "phone"
              ? { type: "phone", code: contact.code ?? dialCode, value: contact.value.replace(/\D/g, "") }
              : { type: contact.type, value: contact.value.trim() },
          )
          .filter((contact) => contact.value),
      );
      setContacts((answer.contacts ?? []).map(lineOf));
      setChanged(false);
      showToast(t("account.contactsSaved"), 2000);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={t("account.title")} onClose={onClose} closeOnOverlay>
      <dl className={styles.facts}>
        <div>
          <dt>{t("account.username")}</dt>
          <dd>
            <Link to={`/u/${encodeURIComponent(user.username)}`} onClick={onClose}>
              {formatUsername(user.username)}
            </Link>
          </dd>
        </div>
        <div>
          <dt>{t("account.joined")}</dt>
          <dd>{formatDate(user.createdAt, i18n.language)}</dd>
        </div>
      </dl>

      {/* The account's own address, apart from the ways it is reached below:
          one box, and the button that keeps what is in it once it differs. */}
      <form className={styles.contacts} onSubmit={saveEmail} autoComplete="off">
        <span className="field-label">{t("account.email")}</span>
        <div className={styles.contactRow}>
          <input
            className="text-input"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailError("");
            }}
            maxLength={254}
            disabled={!account || emailBusy}
            aria-label={t("account.email")}
          />
          {emailChanged && !awaitingCode && (
            <button type="submit" className="small-button" disabled={emailBusy}>
              {proving ? t("auth.sendCode") : t("common.save")}
            </button>
          )}
        </div>
        {awaitingCode && (
          <div className={styles.contactRow}>
            <input
              className="text-input"
              inputMode="numeric"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                setEmailError("");
              }}
              placeholder={t("auth.code")}
              disabled={emailBusy}
              aria-label={t("auth.code")}
            />
            <button type="submit" className="small-button" disabled={emailBusy || code.length < 6}>
              {t("common.save")}
            </button>
          </div>
        )}
        <span className={styles.hint}>
          {awaitingCode ? t("auth.codeHint", { email: typedEmail }) : t("account.emailHint")}
        </span>
        {emailError && <p className="form-message error">{emailError}</p>}
      </form>

      {/* How the account is reached: as many ways as are added, each a kind
          and what is written for it, saved together. */}
      <form className={styles.contacts} onSubmit={save} autoComplete="off">
        <span className="field-label">{t("account.contacts")}</span>
        {contacts?.map((contact, index) => (
          <div key={index} className={styles.contactRow}>
            <Select
              className={styles.small}
              label={t("item.contactType")}
              value={contact.type}
              // Turned into a phone number, what is written already loses
              // whatever is not a digit.
              onChange={(value) => setContact(index, { type: value, value: value === "phone" ? contact.value.replace(/\D/g, "") : contact.value })}
              options={CONTACT_TYPES.map((each) => ({ value: each, label: t(`item.contactTypes.${each}`) }))}
            />
            {contact.type === "phone" && (
              <Select
                className={styles.small}
                fit
                label={t("item.contactCode")}
                value={contact.code ?? dialCode}
                onChange={(value) => setContact(index, { code: value })}
                searchPlaceholder={t("item.contactCodeSearch")}
                emptyLabel={t("item.contactCodeNoMatch")}
                options={dialOptions}
              />
            )}
            <input
              className="text-input"
              type={CONTACT_INPUT[contact.type]}
              value={contact.value}
              onChange={(event) =>
                setContact(index, { value: contact.type === "phone" ? event.target.value.replace(/\D/g, "") : event.target.value })
              }
              maxLength={CONTACT_MAX}
              aria-label={t(`item.contactTypes.${contact.type}`)}
            />
            <button
              type="button"
              className={styles.remove}
              onClick={() => edit(contacts.filter((_, each) => each !== index))}
              aria-label={t("item.contactRemove")}
              title={t("item.contactRemove")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        ))}
        <div className={styles.contactActions}>
          {contacts && contacts.length < CONTACTS_MAX && (
            <button
              type="button"
              className="small-button"
              onClick={() =>
                edit([
                  ...contacts,
                  // The kind the next one starts as: the first not in use yet.
                  { type: CONTACT_TYPES.find((each) => !contacts.some((contact) => contact.type === each)) ?? CONTACT_TYPES[0], value: "" },
                ])
              }
            >
              {t("item.contactAdd")}
            </button>
          )}
          {changed && (
            <button type="submit" className="small-button" disabled={saving}>
              {t("common.save")}
            </button>
          )}
        </div>
        <span className={styles.hint}>{t("account.contactsHint")}</span>
        {error && <p className="form-message error">{error}</p>}
      </form>

      <div className="modal-actions">
        <button type="button" className="outline-button" onClick={signOut}>
          {t("account.signOut")}
        </button>
      </div>
    </Modal>
  );
}
