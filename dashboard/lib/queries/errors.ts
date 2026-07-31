/**
 * Telling "there is no data" apart from "the query failed".
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Several queries here are wrapped in try/catch so that one missing warehouse
 * object can't take down a whole page. That's right for genuinely optional
 * panels — but the first production deploy showed the danger: every mart view
 * was returning 403 (the service account lacked authorization on the underlying
 * `stg` tables), and three screens caught it and rendered a calm "No data yet."
 *
 * A dashboard that says "no data" when it means "I wasn't allowed to look" is
 * worse than one that crashes. The crash gets fixed; the false empty state gets
 * believed, and someone concludes the client had no orders.
 *
 * So: infrastructure failures are re-thrown and surface as a real error.
 * Only "the object doesn't exist yet" is swallowed, because that is a genuine,
 * expected state for views that ship after the frontend.
 */

/** BigQuery error shapes we care about distinguishing. */
interface BigQueryLikeError {
  code?: number;
  message?: string;
}

function asBqError(error: unknown): BigQueryLikeError {
  return (error ?? {}) as BigQueryLikeError;
}

/**
 * True when the failure means "this object hasn't been created yet" — a state
 * the UI can legitimately render as an empty screen with an explanation.
 *
 * Deliberately narrow: a 404, or a 403 whose message says the object may not
 * exist *and* names no dataset the caller should already have. Anything else —
 * notably a plain permission denial — is a misconfiguration, not an empty table.
 */
export function isMissingObject(error: unknown): boolean {
  const { code, message = "" } = asBqError(error);
  if (code === 404) return true;
  return /not found|does not exist/i.test(message) && !/permission|access denied/i.test(message);
}

/**
 * Run an optional query. Returns `fallback` only when the underlying object
 * genuinely doesn't exist; re-throws anything else so it reaches the error page.
 *
 * @example
 *   const gaps = await optional(() => fetchGaps(), null);
 */
export async function optional<T>(
  run: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isMissingObject(error)) return fallback;

    // Permission denials, timeouts, quota errors — all real problems. Log with
    // enough context to find them in Vercel's runtime logs, then re-throw.
    const { code, message } = asBqError(error);
    console.error(`[bigquery] query failed (code ${code}): ${message}`);
    throw error;
  }
}
