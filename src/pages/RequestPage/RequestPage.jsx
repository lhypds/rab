import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../api.js";
import { Header, useAuth } from "../../components/index.js";
import RequestModal, { RequestPageView } from "../../components/RequestModal/index.js";
import { Skeleton, useNavigate } from "../../ui/index.js";
import { requestPath } from "../../utils/spots.js";

// A request's own page (/r/<id>): what somebody needs, at an address that can
// be sent to whoever might have one — as an item has at /i/<id> and a spot at
// /s/<id>. This is the half that talks to the server; what is on the page is
// RequestPageView's, the same as on the sheet over the map.
export default function RequestPage({ id }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [request, setRequest] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    return api
      .getRequest(id)
      .then((answer) => {
        setRequest(answer.request);
        setError("");
      })
      .catch((requestError) => {
        // A page already on screen stays on screen through a request that
        // failed; only the first one has nothing else to show.
        setRequest((current) => {
          if (!current) setError(requestError.status === 404 ? t("request.missing") : requestError.code === "AGE_REQUIRED" ? t("item.ageRequired") : requestError.message);
          return current;
        });
      });
  }, [id, t]);

  // Asked again when the account changes: the same page is a different answer
  // to whoever made the request and to anybody else.
  const username = user?.username ?? null;
  useEffect(() => {
    load();
  }, [load, username]);

  // Opened by the id it had before ids were times, the address is put right,
  // so what is passed on from here is the one it has now.
  const idNow = request?.id ?? null;
  useEffect(() => {
    if (idNow && idNow !== id) navigate(`${requestPath({ id: idNow })}${window.location.search}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idNow, id]);

  useEffect(() => {
    if (request) document.title = `${request.title} — rab`;
    return () => {
      document.title = "rab";
    };
  }, [request]);

  return (
    <div className="page-shell">
      <Header back />
      <main className="wide-page">
        {!request ? (
          error ? (
            <p className="empty-state">{error}</p>
          ) : (
            <Skeleton rows={5} lines={2} label={t("common.loading")} />
          )
        ) : (
          <RequestPageView
            request={request}
            onEdit={() => setEditing(true)}
            // Taken down, there is no page left to stand on: back to its
            // maker's own list, or to the map for anybody else.
            onGone={() => navigate(request.mine ? "/mine" : "/", { replace: true })}
          />
        )}
      </main>

      {/* The form, for whoever made it. */}
      {request?.mine && (
        <RequestModal
          isOpen={editing}
          request={request}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            setRequest(saved);
          }}
        />
      )}
    </div>
  );
}
