import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import qrcode from "qrcode-generator";
import { Modal, showToast } from "../../ui/index.js";
import styles from "./share.module.css";

// The squares of a QR code for some text, as rows of on and off.
function qrModules(text) {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => code.isDark(row, column)));
}

// One path for every dark square, so the code is a single crisp shape at any
// size rather than a few hundred rectangles with seams between them.
function qrPath(modules) {
  let path = "";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    });
  });
  return path;
}

// The code as a picture file, for a poster or a printed card: drawn large on a
// canvas with the quiet border a scanner needs around it.
function saveQr(modules, name) {
  const scale = 16;
  const margin = 4;
  const size = (modules.length + margin * 2) * scale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#000";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) context.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    });
  });
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${name}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, "image/png");
}

// Everything there is for getting an item's page in front of people: its
// address to copy, the phone's own share sheet, and a QR code to scan off a
// screen or print on a flyer.
export default function ShareModal({ isOpen, onClose, title, url, slug }) {
  const { t } = useTranslation();
  const modules = useMemo(() => (isOpen && url ? qrModules(url) : null), [isOpen, url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      showToast(t("share.copied"), 1800);
    } catch {
      showToast(url, 4000);
    }
  }

  async function send() {
    try {
      await navigator.share({ title, url });
    } catch {
      // Dismissed, which is an answer rather than a failure.
    }
  }

  return (
    <Modal isOpen={isOpen} title={t("share.title")} onClose={onClose} closeOnOverlay>
      <div className={styles.sheet}>
        <p className={styles.lead}>{t("share.lead")}</p>
        {modules && (
          <svg
            className={styles.qr}
            viewBox={`-2 -2 ${modules.length + 4} ${modules.length + 4}`}
            shapeRendering="crispEdges"
            role="img"
            aria-label={t("share.qr")}
          >
            <rect x="-2" y="-2" width={modules.length + 4} height={modules.length + 4} fill="#fff" />
            <path d={qrPath(modules)} fill="#000" />
          </svg>
        )}
        <div className={styles.link}>
          <input
            className="text-input mono"
            value={url}
            readOnly
            onFocus={(event) => event.target.select()}
            aria-label={t("share.link")}
          />
          <button type="button" className="small-button filled" onClick={copy}>
            {t("share.copy")}
          </button>
        </div>
        <div className={styles.buttons}>
          {typeof navigator.share === "function" && (
            <button type="button" className="small-button" onClick={send}>
              {t("share.send")}
            </button>
          )}
          <button type="button" className="small-button" onClick={() => modules && saveQr(modules, `rab-${slug}`)}>
            {t("share.saveQr")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
