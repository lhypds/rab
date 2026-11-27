import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Link, Modal, showToast, useNavigate } from "../../ui/index.js";
import { isAdmin } from "../../utils/admin.js";
import { contactHref } from "../../utils/dialing.js";
import { barePhone, formatCoords, formatUsername, relativeTime, requestBudget, requestDates } from "../../utils/format.js";
import { directionsUrl } from "../../utils/mapbox.js";
import { requestPath } from "../../utils/spots.js";
import { loginPath, useAuth } from "../AuthProvider/index.js";
import CategoryIcon from "../CategoryIcon/index.js";
import view from "../ItemView/view.module.css";
import MessageModal from "../MessageModal/index.js";
import ShareModal from "../ShareModal/index.js";
import SpotMap from "../SpotMap/index.js";

// What a request ("I need") says, as a page: laid out as an item's page is,
// and drawn with that page's own styles (ItemView's) — what is wanted on the
// left: its category, its name, who asks, its photographs, and under them
// what they wrote; and on the right a card with what would be paid for it,
// the way to pass the page on, where it is wanted, how its maker is reached,
// and the button that reaches them. Drawn from what it is handed, so the same
// page is the request's own (/r/<id>, see pages/RequestPage) and what is read
// on a sheet over the map (RequestView), as an item's is (ItemPreview).
//
// `onEdit` is asked to open the form on it, where there is one to open;
// `onGone` is told its id once it is taken down; `onLeave` is told when a
// link inside is about to leave for a page.
export default function RequestPageView({ request, onEdit, onGone, onLeave }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messaging, setMessaging] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await api.deleteRequest(request.id);
      showToast(t("request.deleted"), 2000);
      onGone?.(request.id);
    } catch (requestError) {
      showToast(requestError.message, 3000);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  // Writing to its maker — by way of the request, where it was asked without
  // a name — for somebody signed in; anybody else is asked to sign in first.
  const write = () => (user ? setMessaging(true) : navigate(loginPath()));

  // Its maker is told so by the server: an anonymous one has no name to tell by.
  const mine = Boolean(request.mine ?? (user && user.username === request.owner));
  const images = request.images ?? [];
  const shown = images[Math.min(photo, images.length - 1)] ?? null;
  const category = request.category && request.category !== "other" ? request.category : "";
  const located = request.located !== false && request.latitude != null && request.longitude != null;
  const dates = requestDates(request, lang);
  const contacts = request.contacts ?? [];
  // Where reaching them by the way written first goes, or null where that way
  // is not one that can be pressed (a message here, an address).
  const askHref = contactHref(contacts[0], request.title);

  return (
    <>
      <article className={view.page}>
        <div className={view.columns}>
          <header className={view.head}>
            {/* What it is, as a tag over its name: its category, or that
                it is a request where it has none. */}
            <p className={view.tags}>
              <span>
                {category && <CategoryIcon category={category} />}
                {category ? t(`category.${category}`, category) : t("map.kinds.requests")}
              </span>
            </p>
            <h1 className={view.title}>{request.title}</h1>
            <p className={view.meta}>
              {/* Who asks — not named where it was asked without a name. */}
              {request.owner ? (
                <Link to={`/u/${encodeURIComponent(request.owner)}`}>{formatUsername(request.owner)}</Link>
              ) : (
                request.anonymous && <span>{t("request.anonymousName")}</span>
              )}
              {request.place && <span>{request.place}</span>}
              {request.region && request.region.name !== request.place && <span>{request.region.name}</span>}
              {request.createdAt && <span>{relativeTime(request.createdAt, lang, t)}</span>}
            </p>
            {/* The photographs of the kind of thing wanted, after its name. */}
            {shown && (
              <div className={view.gallery}>
                <button type="button" className={view.photo} onClick={() => setZoomed(true)} aria-label={t("item.photoOpen")}>
                  <img src={shown.src} alt={request.title} />
                  {images.length > 1 && (
                    <span className={view.photoCount}>
                      {Math.min(photo, images.length - 1) + 1}/{images.length}
                    </span>
                  )}
                </button>
                {images.length > 1 && (
                  <div className={view.thumbs}>
                    {images.map((image, index) => (
                      <button
                        key={image.src}
                        type="button"
                        className={index === photo ? `${view.thumb} ${view.thumbChosen}` : view.thumb}
                        onClick={() => setPhoto(index)}
                        aria-label={`${index + 1}/${images.length}`}
                      >
                        <img src={image.thumb} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </header>

          {/* ------------------------------------------------------ the card */}
          <aside className={view.card}>
            {/* What would be paid for it, as the page's one big figure, and
                at the far end when it is wanted. */}
            <p className={view.price}>
              <strong>{requestBudget(request, lang, t)}</strong>
              {request.budget != null && <span>{t("request.budget")}</span>}
              <span className={view.statusTags}>
                <span className="status status-confirmed">{dates || t("request.anyTime")}</span>
              </span>
            </p>

            {/* Passing the page on, first on the card as on an item's. */}
            <div className={view.actions}>
              <button type="button" className="small-button filled" onClick={() => setSharing(true)}>
                <svg className={view.icon} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 15V4" />
                  <path d="m8 8 4-4 4 4" />
                  <path d="M5 12v7h14v-7" />
                </svg>
                {t("item.share")}
              </button>
            </div>

            {/* Where it is wanted, for one with a spot on the map: the
                spot, and under it the address and the way there. */}
            {located ? (
              <div className={view.accessPart}>
                <div className={`${view.calendarHead} ${view.contactHead}`}>
                  <h2>{t("item.access")}</h2>
                  <span>{formatCoords(request.latitude, request.longitude)}</span>
                </div>
                <div className={view.accessMap}>
                  <SpotMap latitude={request.latitude} longitude={request.longitude} />
                </div>
                <p className={view.access}>
                  {request.place && <span>{request.place}</span>}
                  <a href={directionsUrl(request.latitude, request.longitude)} target="_blank" rel="noreferrer noopener">
                    {t("item.openMaps")}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                </p>
              </div>
            ) : (
              // With no spot, the address or the area it is asked in.
              (request.place || request.region?.name) && (
                <div className={view.accessPart}>
                  <div className={`${view.calendarHead} ${view.contactHead}`}>
                    <h2>{t("item.access")}</h2>
                  </div>
                  <p className={view.access}>
                    <span>{[request.place, request.region?.name].filter((each, index, all) => each && all.indexOf(each) === index).join(" · ")}</span>
                  </p>
                </div>
              )
            )}

            {/* How its maker is reached, as on an item. */}
            {contacts.length > 0 && (
              <>
                <div className={`${view.calendarHead} ${view.contactHead}`}>
                  <h2>{t("item.contact")}</h2>
                </div>
                <dl className={view.contacts}>
                  {contacts.map((contact, index) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <div key={index}>
                      <dt>{t(`item.contactTypes.${contact.type}`)}</dt>
                      <dd>
                        {contact.type === "message" ? (
                          // Pressed to write one, by whoever is reading. To
                          // its maker it is only words: nobody writes to
                          // themselves.
                          mine ? (
                            t("item.contactMessageNote")
                          ) : (
                            <button type="button" className={view.contactWrite} onClick={write}>
                              {t("item.contactMessageNote")}
                            </button>
                          )
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
              </>
            )}

            {/* The button that writes to whoever asked: greyed for its
                own maker, as an item's is for its owner. */}
            {/* In the card's own panel, ruled off from what is above it:
                as wide as the card and the height an item's is. */}
            {(askHref || request.owner || request.anonymous || mine) && (
              <div className={view.panel}>
                <div className={view.contactRule}>
                  {/* By the way they wrote first: a phone number called,
                      an address written to — or else a message here. */}
                  {askHref && !mine ? (
                    <a className={`primary-button ${view.ask}`} href={askHref}>
                      {t("request.offer")}
                    </a>
                  ) : (
                    <button type="button" className="primary-button" disabled={mine} onClick={write}>
                      {t("request.offer")}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* At the foot of the card, ruled off from what is for a
                reader: changing it, for its maker, and being rid of it —
                for its maker or the admin. */}
            {(mine || isAdmin(user)) && (
              <div className={view.ownerTools}>
                {mine && onEdit && (
                  <div className={view.buttons}>
                    <button type="button" className="small-button" onClick={() => onEdit(request)}>
                      {t("request.editTitle")}
                    </button>
                  </div>
                )}
                <div className={view.buttons}>
                  <button type="button" className={`small-button ${view.danger}`} disabled={busy} onClick={() => setConfirming(true)}>
                    {t("request.delete")}
                  </button>
                </div>
              </div>
            )}
          </aside>

          <div className={view.rest}>
            {/* What its maker wrote about it, under a heading and a rule. */}
            <div className={`part-heading ${view.first}`}>
              <h2>{t("item.description")}</h2>
            </div>
            {request.description ? <p className={view.description}>{request.description}</p> : <p className="part-note">{t("item.descriptionEmpty")}</p>}
          </div>
        </div>
      </article>

      {/* Asked twice before it is deleted, on a sheet over the page. */}
      <Modal isOpen={confirming} title={t("request.delete")} onClose={busy ? undefined : () => setConfirming(false)} closeOnOverlay>
        <p className="modal-text">{t("request.deleteConfirm")}</p>
        <div className="modal-actions">
          <button type="button" className="outline-button" disabled={busy} onClick={() => setConfirming(false)}>
            {t("common.cancel")}
          </button>
          <button type="button" className={`primary-button ${view.deleteButton}`} disabled={busy} onClick={remove}>
            {t("request.delete")}
          </button>
        </div>
      </Modal>
      <ShareModal isOpen={sharing} onClose={() => setSharing(false)} title={request.title} url={`${window.location.origin}${requestPath(request)}`} slug={request.id} />
      <Modal isOpen={zoomed && Boolean(shown)} title={request.title} onClose={() => setZoomed(false)} closeOnOverlay large>
        {shown && <img className={view.zoomed} src={shown.src} alt={request.title} />}
      </Modal>
      {/* One asked without a name is written to by way of the request, so
          its maker is not named. Opened from here, the exchange is headed
          by a line that leads back to this page. */}
      {messaging && <MessageModal username={request.anonymous ? `~${request.id}` : request.owner} about={request.id} aboutTitle={request.title} onClose={() => setMessaging(false)} onNavigate={onLeave} />}
    </>
  );
}
