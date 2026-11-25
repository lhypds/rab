import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Checkbox, Modal, showToast } from "../../ui/index.js";
import { priceLine } from "../../utils/format.js";
import styles from "./items.module.css";

// The sheet the items on a store are chosen on, apart from the one the store
// itself is changed on: the account's own items, of any kind, one to a
// line, ticked to be on it — in the order they were ticked. `onSaved` is told
// the store as it was kept.
export default function StoreItemsModal({ isOpen, store, onClose, onSaved }) {
  const { t, i18n } = useTranslation();
  const [itemIds, setItemIds] = useState([]);
  // The account's items, null until they have been read.
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Each opening starts from the store as it is.
  useEffect(() => {
    if (!isOpen || !store) return undefined;
    setItemIds(store.items.map((item) => item.id));
    setError("");
    setItems(null);
    let cancelled = false;
    api
      .getMine()
      .then((answer) => !cancelled && setItems((answer.items ?? []).filter((item) => !item.shared)))
      .catch((requestError) => !cancelled && setError(requestError.message));
    return () => {
      cancelled = true;
    };
  }, [isOpen, store?.id]);

  if (!store) return null;
  // A store takes the account's items of every kind.
  const choices = items ?? [];

  function toggle(id, on) {
    setItemIds((current) => (on ? [...current, id] : current.filter((each) => each !== id)));
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || items === null) return;
    setBusy(true);
    setError("");
    const offered = new Set(choices.map((item) => item.id));
    try {
      const answer = await api.setStoreItems(
        store.id,
        itemIds.filter((id) => offered.has(id)),
      );
      showToast(t("store.saved"), 2000);
      onSaved(answer.store);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={isOpen} title={t("store.editItems")} onClose={busy ? undefined : onClose}>
      <form onSubmit={submit} autoComplete="off">
        <div className="field">
          <span className="field-label">
            {t("store.itemsHeading")}
            <span className="field-count">
              {choices.filter((item) => itemIds.includes(item.id)).length}/{choices.length}
            </span>
          </span>
          {items && choices.length === 0 && <span className={styles.hint}>{t("store.itemsNone")}</span>}
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
                          {!item.active && ` · ${t("store.unpublished")}`}
                        </span>
                      </span>
                    </span>
                  </Checkbox>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal-actions">
          {error && <p className="form-message error">{error}</p>}
          <button type="button" className="outline-button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={busy || items === null}>
            {t("common.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
