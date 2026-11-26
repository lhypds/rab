import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "../../ui/index.js";
import { dialCodeOf, dialCodes, splitDialCode } from "../../utils/dialing.js";
import { useRegion } from "../../utils/region.js";
import styles from "./contacts.module.css";

// The ways somebody is reached, as a form writes them — an item's, a page's.
// "message" is a message here on rab: a way with nothing to write for it.
export const CONTACT_TYPES = ["phone", "email", "address", "message"];
export const CONTACTS_MAX = 5;
const CONTACT_MAX = 200;
// What a contact's field is, to the keyboard that comes up for it.
const CONTACT_INPUT = { phone: "tel", email: "email", address: "text" };

// A phone number is its code and its digits. One kept from before a code was
// asked for has its code read off its front where it was written with one,
// and otherwise none yet: it is shown with the reader's own country's, and
// saved with it.
function contactLine(contact) {
  if (contact.type === "message") return { type: "message", value: "" };
  if (contact.type !== "phone") return { type: contact.type, value: contact.value };
  const split = contact.code ? { code: contact.code, value: contact.value } : splitDialCode(contact.value);
  return {
    type: "phone",
    code: split?.code,
    value: String(split?.value ?? contact.value).replace(/\D/g, ""),
  };
}

// The form's lines for how somebody is reached, from the ways as they are
// kept: a phone number with its hyphens off.
export const contactLines = (contacts) => contacts.slice(0, CONTACTS_MAX).map(contactLine);

// The one empty line a form starts with.
export const noContacts = () => [{ type: CONTACT_TYPES[0], value: "" }];

// The form's lines as they are sent to be kept: a phone number as its digits,
// with the code it is dialled with from abroad beside it — `dialCode` where
// none was chosen; a message here with nothing written for it, and left out
// where `noMessage`; any other way left out where nothing is written for it.
export function keptContacts(lines, dialCode, { noMessage = false } = {}) {
  return lines
    .map((contact) =>
      contact.type === "phone"
        ? {
            type: "phone",
            code: contact.code ?? dialCode,
            value: contact.value.replace(/\D/g, ""),
          }
        : contact.type === "message"
          ? { type: "message", value: "" }
          : { type: contact.type, value: contact.value.trim() },
    )
    .filter((contact) => (contact.type === "message" ? !noMessage : contact.value));
}

// The fields themselves: the first way, the second, the third and so on, each
// a kind — a phone number, an email address, an address, a message here — and
// what is written for it. More are added with the button under them and taken
// off with the cross beside them, and the ones after move up a place; the last
// cannot be taken off. `onChange` is given the lines as they now are. Where
// `noMessage`, a message here is not one of the ways: somebody else's item
// has no account to send one to.
// `saved` are the account's own ways of being reached (see the account sheet),
// as form lines: any one of them not on the form yet is picked from the list
// under the fields, and taken in place of an empty line or after the rest.
// Anything given as `children` is said under them, as a hint.
export default function ContactFields({ contacts, onChange, saved = [], noMessage = false, onInput, children }) {
  const { t, i18n } = useTranslation();
  const { country } = useRegion();
  const dialCode = dialCodeOf(country);
  const dialOptions = useMemo(
    () =>
      dialCodes(i18n.language).map(({ code, name }) => ({
        value: code,
        short: code,
        label: `${code} ${name}`,
        text: `${code} ${name}`,
      })),
    [i18n.language],
  );
  const same = (a, b) => a.type === b.type && (a.type === "message" || (a.value === b.value && (a.type !== "phone" || (a.code ?? dialCode) === (b.code ?? dialCode))));
  const pickable = saved.filter((line) => !(noMessage && line.type === "message") && !contacts.some((contact) => same(contact, line)));
  const describe = (line) =>
    line.type === "message"
      ? t("item.contactMessageNote")
      : `${t(`item.contactTypes.${line.type}`)} · ${line.type === "phone" ? `${line.code ?? dialCode} ${line.value}` : line.value}`;
  const pick = (index) => {
    const line = pickable[Number(index)];
    if (!line) return;
    const empty = contacts.findIndex((contact) => contact.type !== "message" && !contact.value.trim());
    onChange(empty >= 0 ? contacts.map((contact, at) => (at === empty ? { ...line } : contact)) : [...contacts, { ...line }]);
    onInput?.();
  };
  const setContact = (index, patch) => onChange(contacts.map((contact, each) => (each === index ? { ...contact, ...patch } : contact)));

  return (
    <div className="field">
      <span className="field-label">{t("item.contact")}</span>
      {contacts.map((contact, index) => (
        <div key={index} className={styles.contact}>
          <span className={`field-label ${styles.sub}`}>{t(`item.contactNth.${index}`)}</span>
          <div className={styles.row}>
            <Select
              className={styles.choice}
              label={t("item.contactType")}
              value={contact.type}
              // Turned into a phone number, what is written already loses
              // whatever is not a digit.
              onChange={(value) =>
                setContact(index, {
                  type: value,
                  value: value === "message" ? "" : value === "phone" ? contact.value.replace(/\D/g, "") : contact.value,
                })
              }
              // A message here is said once.
              options={CONTACT_TYPES.filter(
                (each) =>
                  each !== "message" || contact.type === "message" || (!noMessage && !contacts.some((other) => other.type === "message")),
              ).map((each) => ({
                value: each,
                label: t(`item.contactTypes.${each}`),
              }))}
            />
            {/* A phone number's code, chosen in front of it: the reader's own
                country's until another is. The box says the code; the list
                says whose it is. */}
            {contact.type === "phone" && (
              <Select
                className={styles.choice}
                fit
                label={t("item.contactCode")}
                value={contact.code ?? dialCode}
                onChange={(value) => setContact(index, { code: value })}
                searchPlaceholder={t("item.contactCodeSearch")}
                emptyLabel={t("item.contactCodeNoMatch")}
                options={dialOptions}
              />
            )}
            {contact.type === "message" && <span className={styles.note}>{t("item.contactMessageNote")}</span>}
            <input
              className="text-input"
              hidden={contact.type === "message"}
              type={CONTACT_INPUT[contact.type] ?? "text"}
              value={contact.value}
              onChange={(event) => {
                // A phone number is typed as digits only: a hyphen typed or
                // pasted among them is dropped at once, and its code is chosen
                // beside it.
                setContact(index, {
                  value: contact.type === "phone" ? event.target.value.replace(/\D/g, "") : event.target.value,
                });
                onInput?.();
              }}
              maxLength={CONTACT_MAX}
              aria-label={`${t(`item.contactNth.${index}`)} · ${t(`item.contactTypes.${contact.type}`)}`}
            />
            <button
              type="button"
              className={styles.remove}
              onClick={() => onChange(contacts.filter((_, each) => each !== index))}
              disabled={contacts.length <= 1}
              aria-label={t("item.contactRemove")}
              title={t("item.contactRemove")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
      ))}
      {contacts.length < CONTACTS_MAX && (
        <button
          type="button"
          className={`small-button ${styles.add}`}
          // The kind the next one starts as: the first not in use yet.
          onClick={() =>
            onChange([
              ...contacts,
              {
                type:
                  CONTACT_TYPES.find((each) => !(each === "message" && noMessage) && !contacts.some((contact) => contact.type === each)) ??
                  CONTACT_TYPES[0],
                value: "",
              },
            ])
          }
        >
          {t("item.contactAdd")}
        </button>
      )}
      {/* Or one of the account's own, picked from a list — always there, and
          greyed where none of them is left to take, or there is no room for
          one more. */}
      {(
        <Select
          disabled={pickable.length === 0 || (contacts.length >= CONTACTS_MAX && !contacts.some((contact) => contact.type !== "message" && !contact.value.trim()))}
          className={`${styles.add} ${styles.pick}`}
          label={t("item.contactPick")}
          value=""
          onChange={pick}
          options={[
            { value: "", label: t("item.contactPick") },
            ...pickable.map((line, index) => ({ value: String(index), label: describe(line) })),
          ]}
        />
      )}
      {children}
    </div>
  );
}
