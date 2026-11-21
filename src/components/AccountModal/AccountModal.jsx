import { useTranslation } from "react-i18next";
import { Link, Modal, useNavigate } from "../../ui/index.js";
import { formatDate, formatUsername } from "../../utils/format.js";
import { useAuth } from "../AuthProvider/index.js";
import styles from "./account.module.css";

// Your own account, as a sheet over whatever page you were on: who you are
// here, and the way out.
export default function AccountModal({ isOpen, onClose }) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  async function signOut() {
    onClose();
    await logout();
    navigate("/");
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

      <div className="modal-actions">
        <button type="button" className="outline-button" onClick={signOut}>
          {t("account.signOut")}
        </button>
      </div>
    </Modal>
  );
}
