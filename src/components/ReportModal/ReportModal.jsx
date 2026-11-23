import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Modal, Radio, TextArea, showToast } from "../../ui/index.js";
import styles from "./report.module.css";

// What can be wrong with an item, as the server knows them (see its
// REPORT_REASONS): the first is that it is not there to be had any more, which
// asks the administrator to delete it; the last is whatever the others are
// not, and has to say so.
const REASONS = ["unavailable", "spam", "inaccurate", "prohibited", "scam", "offensive", "other"];
const NOTE_MAX = 500;

// The sheet something is sent to the administrator from, about one item.
// `mode` is which: "report" — what is wrong with it, picked from a list, and a
// word about it — or "delete" — asking for an item listed for somebody else
// to be deleted, which only the administrator does — or null for the sheet to
// be closed. Either goes as a message, into the reader's own conversation
// with the administrator, where the answer comes back.
export default function ReportModal({ item, mode, onClose }) {
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
  const reporting = mode === "report";
  // A report says what kind of thing is wrong, and "other" says it in words.
  const ready = !reporting || (Boolean(reason) && (reason !== "other" || Boolean(note.trim())));

  async function submit(event) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      if (reporting) await api.reportItem(item.id, reason, note.trim());
      else await api.requestDelete(item.id, note.trim());
      showToast(t(reporting ? "report.sent" : "report.deleteSent"), 2400);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen title={t(reporting ? "report.title" : "report.deleteTitle")} onClose={busy ? undefined : onClose} closeOnOverlay>
      <form onSubmit={submit}>
        <div className="field">
          <p className={styles.lead}>{t(reporting ? "report.lead" : "report.deleteLead", { item: item.title })}</p>
          {reporting && (
            <div className={styles.reasons} role="radiogroup" aria-label={t("report.title")}>
              {REASONS.map((each) => (
                <Radio key={each} name="report-reason" value={each} checked={reason === each} onChange={setReason} disabled={busy}>
                  {t(`report.reasons.${each}`)}
                </Radio>
              ))}
            </div>
          )}
          <TextArea
            className="text-area"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setError("");
            }}
            placeholder={t(reporting ? (reason === "other" ? "report.placeholderOther" : "report.placeholder") : "report.deletePlaceholder")}
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
            {t(reporting ? "report.send" : "report.deleteSend")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
