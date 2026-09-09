import "server-only";

/**
 * Turning a `gs://` path into something an <img> can load.
 *
 * ── Why the bucket is private ──────────────────────────────────────────────
 * These are client creatives, and some of them have not been released. A public
 * bucket would put an unreleased campaign one guessed URL away from anyone, and
 * the URL is guessable: the path is the client slug and the Meta image hash.
 * So the bucket stays private and the dashboard signs a short-lived URL per
 * render, using the same service account it already reads BigQuery with.
 *
 * ── Why not just serve Meta's URLs ─────────────────────────────────────────
 * Because they expire within hours. Storing one and rendering it tomorrow fills
 * the grid with broken images, and the breakage arrives a day after the code
 * that caused it. `image_hash` and `video_id` are stable; the URLs are not.
 * See runbooks/28.
 */

import { Storage } from "@google-cloud/storage";

/** Long enough to browse a session, short enough that a leaked link goes stale. */
const TTL_MS = 60 * 60 * 1000;

let cached: Storage | null = null;

function client(): Storage | null {
  if (cached) return cached;

  const projectId = process.env.GCP_PROJECT_ID;
  const keyBase64 = process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64;
  if (!projectId) return null;

  if (keyBase64) {
    const credentials = JSON.parse(
      Buffer.from(keyBase64, "base64").toString("utf-8")
    );
    cached = new Storage({ projectId, credentials });
    return cached;
  }

  // Local development only: Application Default Credentials. In production the
  // key is always set — signing requires a private key, and ADC on a Vercel
  // lambda has none, so this path returns null there rather than throwing.
  if (process.env.NODE_ENV === "production") return null;
  cached = new Storage({ projectId });
  return cached;
}

/** Split `gs://bucket/path/to/object` into its two halves. */
export function parseGsUri(uri: string): { bucket: string; name: string } | null {
  const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  return m ? { bucket: m[1], name: m[2] } : null;
}

/**
 * Sign one object for reading.
 *
 * Returns null rather than throwing on every failure path — a missing asset, a
 * bucket that does not exist yet, a service account without the signing role.
 * The grid renders a placeholder tile and says the asset has not been mirrored;
 * a thrown error would take down a screen whose other twenty columns are fine.
 */
export async function signedUrl(gsUri: string | null): Promise<string | null> {
  if (!gsUri) return null;
  const parts = parseGsUri(gsUri);
  if (!parts) return null;

  const storage = client();
  if (!storage) return null;

  try {
    const [url] = await storage
      .bucket(parts.bucket)
      .file(parts.name)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + TTL_MS,
      });
    return url;
  } catch (error) {
    console.warn(`[creative] could not sign ${gsUri}:`, (error as Error).message);
    return null;
  }
}

/**
 * Sign many at once.
 *
 * A grid of forty tiles is forty signatures. They are local cryptographic
 * operations rather than network calls, so this is milliseconds — but it is
 * still worth doing in one pass rather than forty awaited round trips through
 * the component tree, which is what a naive per-tile `await` would produce.
 */
export async function signMany(
  uris: Array<string | null>
): Promise<Array<string | null>> {
  return Promise.all(uris.map((u) => signedUrl(u)));
}

/** True when asset serving can work at all. Lets the UI explain itself. */
export function assetServingConfigured(): boolean {
  return Boolean(
    process.env.GCP_PROJECT_ID && process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64
  );
}

/**
 * Sign one object so that following the link SAVES it rather than plays it.
 *
 * ── Why this is a second signature and not the same URL ────────────────────
 * `<a download>` is ignored cross-origin, and a signed GCS URL is always
 * cross-origin. A download button built on `ad.assetUrl` therefore does not
 * download anything: it navigates the tab to the video and leaves the reader
 * looking at a bare player with the dashboard gone. Fetching the bytes into a
 * blob instead needs a CORS rule on the bucket that does not exist.
 *
 * What does work is asking the signature itself for the header, which is what
 * `responseDisposition` does — the object comes back as an attachment with a
 * filename, from a plain link, with no CORS involved. The cost is one extra
 * local signature per ad.
 *
 * The filename is the ad's own name, because a folder of `1039281.mp4` is not
 * something a creative person can work with. Anything that is not a letter,
 * digit, dash or underscore is collapsed, since this string reaches a
 * `Content-Disposition` header and a quote inside it would truncate the value.
 */
export async function signedDownloadUrl(
  gsUri: string | null,
  filename: string
): Promise<string | null> {
  if (!gsUri) return null;
  const parts = parseGsUri(gsUri);
  if (!parts) return null;

  const storage = client();
  if (!storage) return null;

  const extension = parts.name.includes(".") ? parts.name.split(".").pop() : null;
  const stem = filename.replace(/[^\w-]+/g, "_").slice(0, 80) || "creative";
  const safe = extension ? `${stem}.${extension}` : stem;

  try {
    const [url] = await storage
      .bucket(parts.bucket)
      .file(parts.name)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + TTL_MS,
        responseDisposition: `attachment; filename="${safe}"`,
      });
    return url;
  } catch (error) {
    console.warn(`[creative] could not sign a download for ${gsUri}:`, (error as Error).message);
    return null;
  }
}

/** The download signatures for a whole grid, in one pass. */
export async function signManyDownloads(
  items: Array<{ uri: string | null; filename: string }>
): Promise<Array<string | null>> {
  return Promise.all(items.map((i) => signedDownloadUrl(i.uri, i.filename)));
}
