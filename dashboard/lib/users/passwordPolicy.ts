import "server-only";

/**
 * Rules for a password someone chooses (the forced change after a temporary
 * password; admins never type a lasting password, lib/users/store.ts).
 *
 *   - at least MIN_LENGTH characters
 *   - at most MAX_BYTES bytes: bcrypt reads only the first 72 bytes, so a
 *     longer password would silently match anything sharing that prefix
 *   - not the email address or its name part
 *   - not in a known breach (Have I Been Pwned, below)
 *
 * No "one capital, one digit, one symbol" rules: they push people to
 * `Password1!`, which every breach list already holds. Length plus the breach
 * check is what NIST 800-63B recommends instead.
 *
 * ── The breach check sends nothing usable ───────────────────────────────────
 * Pwned Passwords range API (k-anonymity): we SHA-1 the password locally and
 * send only the first 5 hex characters of the hash. The service answers with
 * every leaked hash sharing that prefix (hundreds), padded so the response
 * size says nothing either, and the match happens here. Neither the password
 * nor its full hash leaves the server.
 *
 * If the service is unreachable the check is skipped and logged rather than
 * blocking the change: the other rules still apply, and an outage elsewhere
 * must not trap someone on their temporary password.
 */

import { createHash } from "crypto";

export const MIN_LENGTH = 12;
export const MAX_BYTES = 72;

export type PasswordProblem = "short" | "long" | "personal" | "breached";

export const PASSWORD_PROBLEMS: Record<PasswordProblem, string> = {
  short: `Use at least ${MIN_LENGTH} characters.`,
  long: `Use at most ${MAX_BYTES} characters.`,
  personal: "Don't use your email address in the password.",
  breached: "This password has appeared in a data breach. Choose a different one.",
};

/** Times the password appears in known breaches, or null when the service did not answer. */
export async function breachCount(password: string): Promise<number | null> {
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "one-eighty-dashboard" },
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    for (const line of (await res.text()).split("\n")) {
      const [s, n] = line.trim().split(":");
      if (s === suffix) return Number(n) || 0;
    }
    return 0;
  } catch (error) {
    console.error("[auth] breach check unavailable, skipped", (error as Error).message);
    return null;
  }
}

/** The first rule the password breaks, or null when it may be used. */
export async function passwordProblem(password: string, email: string): Promise<PasswordProblem | null> {
  if (password.length < MIN_LENGTH) return "short";
  if (Buffer.byteLength(password, "utf8") > MAX_BYTES) return "long";

  const lower = password.toLowerCase();
  const address = email.toLowerCase();
  const name = address.split("@")[0] ?? "";
  if (lower.includes(address) || (name.length >= 4 && lower.includes(name))) return "personal";

  return (await breachCount(password)) ? "breached" : null;
}
