/**
 * Turning a pasted or dropped file into something sendable.
 *
 * ── Why this downscales instead of just refusing ───────────────────────────
 * A retina screenshot is routinely 4–8MB, and base64 inflates it by a third.
 * Vercel caps a serverless request body at 4.5MB, so a straight "attach the
 * bytes" implementation would reject the single most common thing anyone
 * actually pastes — which is not a working feature, it is a feature that fails
 * on the normal case and works on the exception.
 *
 * So every image is re-encoded: longest edge capped, quality dropped to a point
 * that is invisible on screen, WebP where the browser can write it. A 6MB
 * screenshot lands around 200KB, and the cap below is then reached only by
 * genuinely large photographs.
 */

/** Longest edge after scaling. Above this, detail is beyond what any reader uses. */
const MAX_EDGE = 1568;
/** Ceiling on the encoded payload, comfortably under the 4.5MB body limit. */
export const MAX_TOTAL_BYTES = 3_500_000;
export const MAX_ATTACHMENTS = 5;

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  /** `data:<mime>;base64,…` — small enough to hold in memory and to post. */
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export function isImage(file: File | null): boolean {
  return !!file && file.type.startsWith("image/");
}

/** Rough decoded size of a data URL, without allocating the bytes again. */
export function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  if (i < 0) return 0;
  const b64 = dataUrl.length - i - 1;
  return Math.floor(b64 * 0.75);
}

let nextId = 0;

export async function prepareImage(file: File): Promise<Attachment> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not read the image.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  // WebP keeps transparency and is roughly a third smaller than JPEG here.
  // `toDataURL` silently falls back to PNG when it cannot write the type asked
  // for, so the result is checked rather than assumed — a silent PNG fallback
  // on a screenshot is how you get back to megabytes without noticing.
  let dataUrl = canvas.toDataURL("image/webp", 0.85);
  let mime = "image/webp";
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    mime = "image/jpeg";
  }

  return {
    id: `att-${nextId++}`,
    name: file.name || "pasted image",
    mime,
    dataUrl,
    width,
    height,
    bytes: dataUrlBytes(dataUrl),
  };
}
