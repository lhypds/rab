import { authHeaders } from "../api.js";

// Photographs are reduced in the browser before they are sent: every browser
// that can draw the map can also encode a canvas, so the server needs no image
// library and the wire carries the small file rather than the one off a phone.
const PHOTO_MAX = 1600;
const PHOTO_QUALITY = 0.82;
// The copy a list row, a pin and a calendar of thumbnails draw instead.
const THUMB_MAX = 320;
const THUMB_QUALITY = 0.62;

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to the <img> decoder, which reads a few formats this cannot.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Could not read that image"));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function render(image, maxSize, quality) {
  const longest = Math.max(image.width, image.height);
  const scale = longest > maxSize ? maxSize / longest : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not draw that image");
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, 0, 0, width, height);
  // Safari before 16 cannot encode WebP and hands back a PNG instead; JPEG is
  // the format it can be asked for and trusted to give.
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp?.type === "image/webp") return { blob: webp, width, height };
  const jpeg = await toBlob(canvas, "image/jpeg", quality);
  if (jpeg?.type === "image/jpeg") return { blob: jpeg, width, height };
  return null;
}

async function upload(blob) {
  const response = await fetch("/api/images", {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": blob.type || "application/octet-stream", ...authHeaders() },
    body: blob,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Upload failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

// One picked file, stored twice — the photograph and the small copy of it —
// and handed back in the shape an item keeps its photos in.
export async function uploadPhoto(file) {
  const image = await decode(file);
  try {
    const full = (await render(image, PHOTO_MAX, PHOTO_QUALITY)) ?? {
      blob: file,
      width: image.width,
      height: image.height,
    };
    const small = await render(image, THUMB_MAX, THUMB_QUALITY);
    const stored = await upload(full.blob);
    const thumb = small ? await upload(small.blob) : stored;
    return { src: stored.url, thumb: thumb.url, width: full.width, height: full.height };
  } finally {
    image.close();
  }
}
