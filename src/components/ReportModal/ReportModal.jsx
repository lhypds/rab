import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Modal, Radio, TextArea, showToast } from "../../ui/index.js";
import styles from "./report.module.css";

// What can be wrong with an item, as the server knows them (see its
// REPORT_REASONS), in the order they are read down: what the page says being
// wrong; then the two that ask the administrator to delete it — the thing is
// not there to be had any more, or the page uses what is somebody's without
// their leave; then the ways a listing is abused; and last whatever the
// others are not, which has to say so.
const REASONS = ["inaccurate", "unavailable", "infringement", "spam", "scam", "prohibited", "offensive", "other"];
const NOTE_MAX = 500;

// The sheet a report about one item — a page among them — is sent to the
// administrator from: what
// is wrong with it, picked from a list, and a word about it. `mode` is
// "report" for the sheet to be open, null for it to be closed. It goes as a
// message, into the reader's own conversation with the administrator, where
// the answer comes back. `send` is what sends it, where what is reported is
// not an item: a request ("I need"), handed here as `item` for its id and name.
export default function ReportModal({ item, mode, onClose, send = api.reportItem }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Each opening starts empty.
  useEffect(() => {
    setReason("");
    setNote("");
    setError("");
  }, [mode]);

  if (!mode || !item) return null;
  // A report says what kind of thing is wrong, and "other" says it in words.
  const ready = Boolean(reason) && (reason !== "other" || Boolean(note.trim()));

  async function submit(event) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      await send(item.id, reason, note.trim());
      showToast(t("report.sent"), 2400);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen title={t("report.title")} onClose={busy ? undefined : onClose} closeOnOverlay>
      <form onSubmit={submit}>
        <div className="field">
          <p className={styles.lead}>{t("report.lead", { item: item.title })}</p>
          <div className={styles.reasons} role="radiogroup" aria-label={t("report.title")}>
            {REASONS.map((each) => (
              <Radio key={each} name="report-reason" value={each} checked={reason === each} onChange={setReason} disabled={busy}>
                {t(`report.reasons.${each}`)}
              </Radio>
            ))}
          </div>
          <TextArea
            className="text-area"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setError("");
            }}
            placeholder={t(reason === "other" ? "report.placeholderOther" : "report.placeholder")}
            maxLength={NOTE_MAX}
            rows={3}
            minHeight={72}
            disabled={busy}
          />
        </div>
        <div className="modal-actions">
          {error && <p className="form-message error">{error}</p>}
          <button type="button" className="outline-button" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={busy || !ready}>
            {t("report.send")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
