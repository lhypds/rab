import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { ActionButton, Checkbox, Modal, Select, TextArea, hideToast, showToast, useNavigate } from "../../ui/index.js";
import { CURRENCIES, barePhone, currencyDigits, defaultCurrency, requestLine } from "../../utils/format.js";
import { contactHref, dialCodeOf } from "../../utils/dialing.js";
import { uploadPhoto } from "../../utils/image.js";
import { DEFAULT_VIEW, MAPBOX_TOKEN, addressLanguage, areaAt, areaOf, savedView } from "../../utils/mapbox.js";
import { currentRegion, useRegion } from "../../utils/region.js";
import { isAdmin } from "../../utils/admin.js";
import { loginPath, useAuth } from "../AuthProvider/index.js";
import { categoriesOf } from "../CategoryFilter/index.js";
import ContactFields, { contactLines, keptContacts, noContacts } from "../ContactFields/index.js";
import { AreaField } from "../ItemModal/index.js";
import LocationField from "../LocationField/index.js";
import MessageModal from "../MessageModal/index.js";
import UserName from "../UserName/index.js";
import styles from "./request.module.css";

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 2000;
// A few photographs of the kind of thing wanted (the server keeps as many).
const IMAGES_MAX = 6;

// Where a new request starts: wherever the map was last looking.
function startingFields(contacts) {
  const view = savedView() ?? currentRegion().center ?? DEFAULT_VIEW;
  return {
    title: "",
    category: "",
    description: "",
    located: true,
    latitude: view.latitude,
    longitude: view.longitude,
    place: "",
    start: "",
    end: "",
    budget: "",
    currency: defaultCurrency(currentRegion().country),
    anonymous: false,
    region: null,
    images: [],
    contacts: contacts.length > 0 ? contacts : noContacts(),
  };
}

// Where the form starts on a request being changed: everything it says, as
// the form holds it.
function fieldsOf(request) {
  return {
    title: request.title ?? "",
    category: request.category && request.category !== "other" ? request.category : "",
    description: request.description ?? "",
    located: true,
    latitude: request.latitude,
    longitude: request.longitude,
    place: request.place ?? "",
    start: request.start ?? "",
    end: request.end ?? "",
    budget: request.budget == null ? "" : String(request.budget),
    currency: request.currency,
    anonymous: Boolean(request.anonymous),
    region: request.region ?? null,
    images: request.images ?? [],
    contacts: request.contacts?.length > 0 ? contactLines(request.contacts) : noContacts(),
  };
}

// The sheet "I need" opens: what is wanted, where, between which dates, what
// its maker would pay for it, and how they are reached. Saved, it stands on
// the map under "Requests" for whoever has one to offer. Given a `request`, the
// sheet opens on it instead, and saving changes that one.
export default function RequestModal({ isOpen, request: editing = null, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { country } = useRegion();
  // Whether the model is filling the form in from what is being looked for.
  const [thinking, setThinking] = useState(false);
  const dialCode = dialCodeOf(country);
  const [ownContacts, setOwnContacts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [fields, setFields] = useState(() => (editing ? fieldsOf(editing) : startingFields([])));
  const [opening, setOpening] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Until somebody picks an area, the request is asked in the town the form
  // opened on — where the map was looking: the answer most people would
  // give, there to be changed, and never written over one somebody picked.
  const regionPicked = useRef(false);
  const [here, setHere] = useState(null);
  const placeLang = addressLanguage(country);
  useEffect(() => {
    if (!isOpen) return undefined;
    // One being changed keeps the area it was saved with; one saved without
    // is given the town its own spot is in, as a new one is.
    regionPicked.current = Boolean(editing?.region);
    const spot = editing ?? startingFields([]);
    setHere({ latitude: spot.latitude, longitude: spot.longitude });
    if (regionPicked.current || !MAPBOX_TOKEN) return undefined;
    const controller = new AbortController();
    areaAt(spot.latitude, spot.longitude, placeLang, controller.signal)
      .then((area) => {
        const region = areaOf(area);
        if (region && !regionPicked.current) setFields((current) => ({ ...current, region }));
      })
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, placeLang, editing?.id]);
  // How many photographs are on their way up, and the picker behind the plus.
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef(null);
  const set = (name, value) => {
    setFields((current) => ({ ...current, [name]: value }));
    setError("");
  };

  // Each opening starts afresh, with the account's own ways of being reached
  // filled in and its places to choose from.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setFields(editing ? fieldsOf(editing) : startingFields([]));
    setOpening((count) => count + 1);
    setError("");
    api
      .getContacts()
      .then((answer) => {
        if (cancelled) return;
        const lines = contactLines(answer.contacts ?? []);
        setOwnContacts(lines);
        // A request being changed keeps the ways it was saved with.
        if (lines.length > 0 && !editing) setFields((current) => ({ ...current, contacts: lines }));
      })
      .catch(() => {});
    api
      .getLocations()
      .then((answer) => !cancelled && setLocations(answer.locations ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing?.id]);

  if (!isOpen) return null;
  // Asked without a name, a message here on rab is still a way to be reached:
  // it is written to the request, and its maker is not named in the exchange.
  const contacts = keptContacts(fields.contacts, dialCode);
  // No day already gone: a request that ends in the past is never shown.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // One being changed may have started already: that day is still allowed.
  const earliest = editing?.start && editing.start < today ? editing.start : today;
  const priceText = (value) => value.replace(currencyDigits(fields.currency) ? /[^\d.]/g : /\D/g, "");

  // The photographs picked, sent up one after another and added to the ones
  // the request carries, as many as there is room for.
  async function addPhotos(event) {
    const room = IMAGES_MAX - fields.images.length - uploading;
    const files = [...event.target.files].slice(0, room);
    // The same file picked again is still a change.
    event.target.value = "";
    if (files.length === 0) return;
    setError("");
    setUploading((count) => count + files.length);
    for (const file of files) {
      try {
        const photo = await uploadPhoto(file);
        setFields((current) =>
          current.images.some((image) => image.src === photo.src) ? current : { ...current, images: [...current.images, photo].slice(0, IMAGES_MAX) },
        );
      } catch (uploadError) {
        setError(uploadError.message || t("item.photoFailed"));
      }
      setUploading((count) => count - 1);
    }
  }

  // The brain beside what is being looked for: the model chooses its category
  // and writes the details out from those words, over whatever was there.
  async function fillIn() {
    const title = fields.title.trim();
    if (thinking || !title) return;
    setError("");
    setThinking(true);
    // Said at the foot for as long as it takes: the model takes its time.
    showToast(t("request.fillingIn"), null);
    try {
      const answer = await api.describeRequest(title, i18n.language.slice(0, 2));
      setFields((current) => ({
        ...current,
        category: answer.category && answer.category !== "other" ? answer.category : "",
        description: answer.description || current.description,
      }));
    } catch (describeError) {
      setError(t(describeError.code === "DESCRIBE_UNAVAILABLE" ? "request.fillInUnavailable" : "request.fillInFailed"));
    } finally {
      hideToast();
      setThinking(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || uploading > 0) return;
    if (!fields.title.trim()) return setError(t("request.titleRequired"));
    if (!fields.located) return setError(t("request.placeRequired"));
    if (contacts.length === 0) return setError(t("item.contactRequired"));
    setBusy(true);
    setError("");
    try {
      const wanted = {
        title: fields.title.trim(),
        category: fields.category,
        description: fields.description.trim(),
        latitude: fields.latitude,
        longitude: fields.longitude,
        place: fields.place.trim(),
        start: fields.start || null,
        end: fields.end || null,
        budget: fields.budget === "" ? null : Number(fields.budget),
        currency: fields.currency,
        anonymous: fields.anonymous,
        region: fields.region,
        images: fields.images,
        contacts,
      };
      const { request } = await (editing ? api.updateRequest(editing.id, wanted) : api.createRequest(wanted));
      showToast(t(editing ? "request.updated" : "request.saved"), 2000);
      onSaved?.(request);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen title={t(editing ? "request.editTitle" : "request.title")} onClose={busy ? undefined : onClose} large>
      <form className={styles.form} onSubmit={submit}>
        {/* Two columns where the sheet is wide enough, as the form for
            putting something out has: what is wanted, when and for how much on
            the left; where — the map — and how to be reached on the right. */}
        <div className={styles.columns}>
        <div className={styles.column}>
        <label className="field">
          <span className="field-label">{t("request.what")}</span>
          {/* Beside it the brain, as the item form's has it: from these words
              the category is chosen and the details written. */}
          <span className={styles.whatRow}>
            <input
              className="text-input"
              value={fields.title}
              onChange={(event) => set("title", event.target.value)}
              maxLength={TITLE_MAX}
              placeholder={t("request.whatPlaceholder")}
            />
            <ActionButton tooltip={t("request.fillIn")} tooltipRight onClick={fillIn} disabled={thinking || !fields.title.trim()} aria-busy={thinking}>
              <svg viewBox="0 0 24 24">
                <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
                <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
                <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
                <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
                <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
                <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
                <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
                <path d="M6 18a4 4 0 0 1-1.967-.516" />
                <path d="M19.967 17.484A4 4 0 0 1 18 18" />
              </svg>
            </ActionButton>
          </span>
        </label>

        <div className="field">
          <span className="field-label">{t("item.category")}</span>
          <Select
            label={t("item.category")}
            value={fields.category}
            onChange={(value) => set("category", value)}
            searchPlaceholder={t("item.categorySearch")}
            emptyLabel={t("item.categoryNoMatch")}
            options={[
              { value: "", label: t("request.categoryNone") },
              ...categoriesOf(Boolean(user?.adult)).map((slug) => ({ value: slug, label: t(`category.${slug}`), text: `${t(`category.${slug}`)} ${slug}` })),
            ]}
          />
        </div>

        <label className="field">
          <span className="field-label">{t("request.note")}</span>
          <TextArea
            className="text-area"
            value={fields.description}
            onChange={(event) => set("description", event.target.value)}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            minHeight={72}
            placeholder={t("request.notePlaceholder")}
          />
        </label>

        {/* Photographs of the kind of thing wanted, where one says it better
            than words: the first is the one its pin and its row wear. */}
        <div className="field">
          <span className="field-label">{t("item.photos")}</span>
          <div className={styles.photos}>
            {fields.images.map((image) => (
              <span key={image.src} className={styles.photo}>
                <img src={image.thumb} alt="" loading="lazy" />
                <button
                  type="button"
                  className={styles.photoRemove}
                  onClick={() => set("images", fields.images.filter((each) => each.src !== image.src))}
                  aria-label={t("item.photoRemove")}
                  title={t("item.photoRemove")}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </span>
            ))}
            {Array.from({ length: uploading }, (_, index) => (
              // Placeholders for what is still going up; they have no identity.
              // eslint-disable-next-line react/no-array-index-key
              <span key={`up-${index}`} className={`${styles.photo} ${styles.photoWaiting}`} aria-hidden="true" />
            ))}
            {fields.images.length + uploading < IMAGES_MAX && (
              <button
                type="button"
                className={styles.photoAdd}
                onClick={() => fileRef.current?.click()}
                aria-label={t("item.photoAdd")}
                title={t("item.photoAdd")}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
          </div>
          <span className={styles.hint}>{t("request.photosHint")}</span>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={addPhotos} />
        </div>

        <div className="field">
          <span className="field-label">{t("request.when")}</span>
          <div className={styles.row}>
            <input
              className="text-input"
              type="date"
              value={fields.start}
              min={earliest}
              onChange={(event) => set("start", event.target.value)}
              aria-label={t("request.from")}
            />
            <span className={styles.dash}>–</span>
            <input
              className="text-input"
              type="date"
              value={fields.end}
              min={fields.start || earliest}
              onChange={(event) => set("end", event.target.value)}
              aria-label={t("request.until")}
            />
          </div>
          <span className={styles.hint}>{t("request.whenHint")}</span>
        </div>

        <div className="field">
          <span className="field-label">{t("request.budget")}</span>
          <div className={styles.row}>
            <Select
              className={styles.currency}
              label={t("item.currency")}
              value={fields.currency}
              onChange={(value) => set("currency", value)}
              options={CURRENCIES.map((code) => ({ value: code, label: code }))}
            />
            <input
              className="text-input mono"
              value={fields.budget}
              onChange={(event) => set("budget", priceText(event.target.value))}
              inputMode="decimal"
              maxLength={12}
              placeholder={t("request.budgetPlaceholder")}
              aria-label={t("request.budget")}
            />
          </div>
        </div>
        </div>
        <div className={styles.column}>
        {/* The area the request is asked in, as an item has the area it is
            offered in: whoever is looking there finds it in the list. */}
        <div className="field">
          <span className="field-label">{t("request.region")}</span>
          <AreaField
            value={fields.region}
            near={here}
            onChange={(region) => {
              regionPicked.current = true;
              set("region", region);
            }}
          />
          <span className={styles.hint}>{t("request.regionHint")}</span>
        </div>

        <div className="field">
          <span className="field-label">{t("request.where")}</span>
          <LocationField
            key={opening}
            value={fields}
            onChange={(patch) => {
              setFields((current) => ({ ...current, ...patch }));
              setError("");
            }}
            locations={locations}
            onSaved={(location) => setLocations((current) => [...current.filter((each) => each.id !== location.id), location])}
            onError={setError}
          />
        </div>

        <ContactFields contacts={fields.contacts} saved={ownContacts} onChange={(next) => set("contacts", next)}>
          <span className={styles.hint}>{t("request.contactHint")}</span>
        </ContactFields>

        {/* Without a name: nobody else is told whose request it is, in the
            messages written about it either. */}
        <div className="field">
          <Checkbox className={styles.tick} checked={fields.anonymous} onChange={(on) => set("anonymous", on)}>
            {t("request.anonymous")}
          </Checkbox>
          <span className={styles.hint}>{t("request.anonymousHint")}</span>
        </div>
        </div>
        </div>

        <div className="modal-actions">
          {error && <p className="form-message error">{error}</p>}
          <button type="button" className="outline-button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={busy || uploading > 0}>
            {t(editing ? "common.save" : "request.post")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// A request read on a sheet over the map: what is wanted, what its maker would
// pay and when, where, and how to reach them — a message here, or whatever
// way they gave. Its maker, or the admin, may take it down.
export function RequestView({ request, onClose, onGone }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messaging, setMessaging] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!request) return null;
  // Its maker is told so by the server: an anonymous one has no name to tell by.
  const mine = request.mine ?? user?.username === request.owner;

  async function remove() {
    if (busy || !window.confirm(t("request.deleteConfirm"))) return;
    setBusy(true);
    try {
      await api.deleteRequest(request.id);
      showToast(t("request.deleted"), 2000);
      onGone?.(request.id);
    } catch (requestError) {
      showToast(requestError.message, 3000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal isOpen title={request.title} onClose={onClose} closeOnOverlay>
        <div className={styles.view}>
          {request.images?.length > 0 && (
            <div className={styles.shots}>
              {request.images.map((image) => (
                <a key={image.src} href={image.src} target="_blank" rel="noopener">
                  <img src={image.thumb} alt="" loading="lazy" />
                </a>
              ))}
            </div>
          )}
          <p className={styles.line}>{requestLine(request, i18n.language, t)}</p>
          <p className={styles.meta}>
            {[request.category && request.category !== "other" && t(`category.${request.category}`, request.category), request.place, request.region?.name]
              .filter(Boolean)
              .join(" · ")}
            {request.owner && (
              <>
                {" · "}
                <UserName name={request.owner} />
              </>
            )}
            {request.anonymous && ` · ${t("request.anonymousName")}`}
          </p>
          {request.description && <p className={styles.description}>{request.description}</p>}
          {request.contacts?.length > 0 && (
            <dl className={styles.contacts}>
              {request.contacts.map((contact, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={index}>
                  <dt>{t(`item.contactTypes.${contact.type}`)}</dt>
                  <dd>
                    {contact.type === "message" ? (
                      t("item.contactMessageNote")
                    ) : contact.type === "phone" ? (
                      <a href={contactHref(contact)}>
                        {contact.code ? `${contact.code} ` : ""}
                        {barePhone(contact.value)}
                      </a>
                    ) : contactHref(contact) ? (
                      <a href={contactHref(contact, request.title)}>{contact.value}</a>
                    ) : (
                      contact.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="modal-actions">
          {(mine || isAdmin(user)) && (
            <button type="button" className="outline-button" onClick={remove} disabled={busy}>
              {t("request.delete")}
            </button>
          )}
          {!mine && (request.owner || request.anonymous) && (
            <button
              type="button"
              className="primary-button"
              onClick={() => (user ? setMessaging(true) : navigate(loginPath()))}
            >
              {t("request.offer")}
            </button>
          )}
        </div>
      </Modal>
      {/* One asked without a name is written to by way of the request, so
          its maker is not named — to the admin either, who is told the name. */}
      {messaging && <MessageModal username={request.anonymous ? `~${request.id}` : request.owner} onClose={() => setMessaging(false)} onNavigate={onClose} />}
    </>
  );
}
