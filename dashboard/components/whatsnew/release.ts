/**
 * The release the "what's new" sequence belongs to, and the one piece of state
 * it keeps: whether this browser has already been shown it.
 *
 * ── Why a release id is in the key ─────────────────────────────────────────
 * The next release reuses this whole mechanism by changing `RELEASE_ID` and
 * the beats, and nothing else. A new id is a new key, so every browser is
 * eligible again; the old key is left behind rather than migrated, which costs
 * a few bytes per browser and removes any chance of a half-migrated flag
 * deciding that somebody has already seen a sequence that did not exist yet.
 *
 * ── Why every access is wrapped, and why failure means "do not show" ───────
 * `window.localStorage` is not a property you can safely read. In a Safari
 * private window, with site data blocked, or inside a third-party frame, the
 * getter itself throws, and so do `getItem` and `setItem` afterwards. An
 * uncaught throw here would happen during the dashboard's own render, so it
 * would take the page with it.
 *
 * When storage is unavailable we fail closed: the sequence does not run at
 * all. The alternative, running it anyway, means it cannot be remembered, so
 * it would play again on every single page view, and an overlay that reappears
 * forever is much worse than one that never appears.
 */

/** Bump this to show a new sequence to everybody again. */
export const RELEASE_ID = "2026-10-redesign";

const SEEN_KEY = `one-eighty:whats-new:${RELEASE_ID}`;

/**
 * The store, or null when it cannot be used.
 *
 * Reading the property is not enough to prove it works: some browsers hand
 * back an object whose `setItem` throws on the first write (Safari private
 * mode did exactly this for years, and quota-exceeded still does). So this
 * writes and removes a probe key, and only a clean round trip counts.
 */
function store(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = "one-eighty:probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** True only when storage works AND this browser has not been shown this release. */
export function shouldAutoPlay(): boolean {
  const s = store();
  if (!s) return false;
  try {
    return s.getItem(SEEN_KEY) !== "1";
  } catch {
    return false;
  }
}

/** Records that this browser has been shown the release. Never throws. */
export function markSeen(): void {
  try {
    store()?.setItem(SEEN_KEY, "1");
  } catch {
    // Storage filled up or was revoked between the probe and here. The only
    // cost is that the sequence may play once more; not worth failing over.
  }
}
