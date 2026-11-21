import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemView, LanguageSwitcher, useAuth } from "../../components/index.js";
import { readPreview, watchPreview } from "../../utils/preview.js";

// The booking page of an item that has not been published yet, as a page of its
// own: what the form is holding, drawn exactly as /i/<id> will draw it. It
// opens in its own tab beside the form and follows it — press Preview again
// after a change and this page is the newer draft.
export default function PreviewPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [draft, setDraft] = useState(readPreview);

  useEffect(() => watchPreview(setDraft), []);

  useEffect(() => {
    document.title = draft ? `${draft.item.title} — ${t("item.previewTitle")}` : t("item.previewTitle");
    return () => {
      document.title = "rab";
    };
  }, [draft, t]);

  return (
    <div className="page-shell">
      {/* The bar says what this page is instead of offering the site: nothing
          here is published, so there is nowhere on it to go. */}
      <header className="topbar">
        <span className="topbar-brand">
          <span className="wordmark">rab</span>
          <span className="status status-pending">{t("item.previewTitle")}</span>
        </span>
        <span className="topbar-action-slot">
          <button type="button" className="small-button" onClick={() => window.close()}>
            {t("item.previewClose")}
          </button>
          <LanguageSwitcher />
        </span>
      </header>
      <main className="wide-page">
        {draft ? (
          <>
            <p className="preview-note">{t("item.previewNote")}</p>
            {/* Keyed by when the draft was written, so a newer one starts the
                page over rather than keeping a day picked on the old calendar. */}
            <ItemView key={draft.at} item={draft.item} calendar={draft.calendar} viewer={user} preview />
          </>
        ) : (
          <p className="empty-state">{t("item.previewEmpty")}</p>
        )}
      </main>
    </div>
  );
}
