import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Checkbox, Modal, Select, TextArea, showToast } from "../../ui/index.js";
import { priceLine } from "../../utils/format.js";
import { KINDS } from "../../utils/kinds.js";
import CategoryIcon from "../CategoryIcon/index.js";
import styles from "./page.module.css";

const NAME_MAX = 80;
const ABOUT_MAX = 2000;

// The sheet a page is made and changed on: what it is — a store of things, a
// space, services — its name, a word about it, where it stands, and which of
// the account's own items of that kind are on it. A store and a space stand at
// one of the account's locations (kept on the account's sheet); services may.
// `page` is the one being changed, or null for a new one; `onSaved` is told
// the page as it was kept, and `onDeleted` that it was taken off.
export default function PageModal({ isOpen, page, onClose, onSaved, onDeleted }) {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState("item");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [locationId, setLocationId] = useState("");
  const [itemIds, setItemIds] = useState([]);
  // The account's locations and items, null until they have been read.
  const [locations, setLocations] = useState(null);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Each opening starts from the page as it is, or empty.
  useEffect(() => {
    if (!isOpen) return undefined;
    setKind(page?.kind ?? "item");
    setName(page?.name ?? "");
    setDescription(page?.description ?? "");
    setLocationId(page?.location?.id ?? "");
    setItemIds(page?.items?.map((item) => item.id) ?? []);
    setError("");
    let cancelled = false;
    api
      .getLocations()
      .then((answer) => !cancelled && setLocations(answer.locations ?? []))
      .catch(() => !cancelled && setLocations([]));
    api
      .getMine()
      .then((answer) => !cancelled && setItems((answer.items ?? []).filter((item) => !item.shared)))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [isOpen, page]);

  const located = kind !== "service";
  const choices = (items ?? []).filter((item) => (item.kind || "item") === kind);
  const ready = Boolean(name.trim()) && (!located || Boolean(locationId));

  // A location kept on the page that has since gone from the account's list
  // is still the page's own until another is chosen.
  const known = locations?.some((each) => each.id === locationId);
  const options = [
    { value: "", label: t(located ? "page.locationChoose" : "page.locationNone") },
    ...(locationId && locations && !known && page?.location ? [{ value: locationId, label: page.location.name }] : []),
    ...(locations ?? []).map((each) => ({
      value: each.id,
      label: each.address ? `${each.name} — ${each.address}` : each.name,
      short: each.name,
    })),
  ];

  function toggle(id, on) {
    setItemIds((current) => (on ? [...current, id] : current.filter((each) => each !== id)));
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    // Only the ticked ones of the kind the page is now, in the order they were ticked.
    const ofKind = new Set(choices.map((item) => item.id));
    const body = {
      kind,
      name: name.trim(),
      description: description.trim(),
      locationId: locationId || null,
      itemIds: itemIds.filter((id) => ofKind.has(id)),
    };
    try {
      const answer = page ? await api.updatePage(page.id, body) : await api.createPage(body);
      showToast(t("page.saved"), 2000);
      onSaved(answer.page);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !page) return;
    setBusy(true);
    setError("");
    try {
      await api.deletePage(page.id);
      showToast(t("page.removed"), 2000);
      onDeleted();
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={t(page ? "page.edit" : "page.new")} onClose={busy ? undefined : onClose}>
      <form onSubmit={submit} autoComplete="off">
        <div className={styles.fields}>
          {/* What it is a page of, which decides what it is called and which
              items can be on it. */}
          <div className="tabs" role="group">
            {KINDS.map((each) => (
              <button
                key={each}
                type="button"
                aria-pressed={kind === each}
                className={kind === each ? "tab active" : "tab"}
                onClick={() => setKind(each)}
                disabled={busy}
              >
                <CategoryIcon kind={each} />
                {t(`page.kinds.${each}`)}
              </button>
            ))}
          </div>

          <div className="field">
            <span className="field-label">{t("page.name")}</span>
            <input
              className="text-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t(`page.namePlaceholder.${kind}`)}
              maxLength={NAME_MAX}
              aria-label={t("page.name")}
              disabled={busy}
            />
          </div>

          <div className="field">
            <span className="field-label">{t("page.description")}</span>
            <TextArea
              className="text-area"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={ABOUT_MAX}
              rows={3}
              minHeight={72}
              disabled={busy}
            />
          </div>

          <div className="field">
            <span className="field-label">{t("item.location")}</span>
            <Select options={options} value={locationId} onChange={setLocationId} label={t("item.location")} />
            <span className={styles.hint}>
              {locations?.length === 0 ? t("page.locationsEmpty") : t(located ? "page.locationRequired" : "page.locationOptional")}
            </span>
          </div>

          <div className="field">
            <span className="field-label">
              {t("page.items")}
              <span className="field-count">
                {choices.filter((item) => itemIds.includes(item.id)).length}/{choices.length}
              </span>
            </span>
            {items && choices.length === 0 && <span className={styles.hint}>{t(`page.itemsNone.${kind}`)}</span>}
            {choices.length > 0 && (
              <ul className={styles.items}>
                {choices.map((item) => (
                  <li key={item.id}>
                    <Checkbox checked={itemIds.includes(item.id)} onChange={(on) => toggle(item.id, on)} disabled={busy}>
                      <span className={styles.itemLine}>
                        {item.thumb && <img src={item.thumb} alt="" loading="lazy" />}
                        <span className={styles.itemText}>
                          {item.title}
                          <span className={styles.itemMeta}>
                            {" · "}
                            {priceLine(item, i18n.language, t)}
                            {!item.active && ` · ${t("page.unpublished")}`}
                          </span>
                        </span>
                      </span>
                    </Checkbox>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="modal-actions">
          {error && <p className="form-message error">{error}</p>}
          {page && (
            <button type="button" className={`outline-button ${styles.remove}`} onClick={remove} disabled={busy}>
              {t("page.remove")}
            </button>
          )}
          <button type="button" className="outline-button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={busy || !ready}>
            {t("common.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
