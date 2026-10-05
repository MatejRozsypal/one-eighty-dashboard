/**
 * Display clean-up for strings that arrive from ClickUp and the warehouse.
 *
 * Pure, no database client and no React, so the server queries and the check
 * scripts can both use it. These strings are data, written by people, and they
 * carry two things the UI must not print: the U+2014 dash, and the internal
 * code a persona is filed under (`... - MAN_SensitiveSkin_Switcher_40s`).
 */

const EM_DASH = /—/g;

/** U+2014 to a plain hyphen. Everything else is left as written. */
export function noEmDash(value: string): string {
  return value.replace(EM_DASH, "-");
}

/**
 * The part of a persona label a person should read.
 *
 * The label is `<description> - <PREFIX>_<Part>_<Part>_<age>s`, where the dash
 * may arrive as U+2014 or a hyphen. The internal code is dropped; a label that
 * is only a code (no description before it) is left alone rather than emptied.
 */
export function cleanPersona(value: string): string {
  const flat = noEmDash(value).trim();
  const stripped = flat.replace(/\s+-\s+[A-Za-z]{2,5}_[A-Za-z0-9_]+$/, "").trim();
  return stripped.length > 0 ? stripped : flat;
}

// ── Concept codes ────────────────────────────────────────────────────────────
// A concept is filed in ClickUp under a code such as
// `MAN_SensitiveSwitcher_ContrarianTruth_v1`: client prefix, CamelCase parts,
// a version. That is a filing key, not something to read. Every screen that
// prints a concept goes through `conceptLabel` or `humanizeConceptCode`, so the
// raw code is shown in exactly one shape.

/** `PREFIX_Part_Part_v1`: at least two underscore-joined parts, no spaces. */
const CONCEPT_CODE = /^[A-Za-z]{2,5}(?:_[A-Za-z0-9]+){2,}$/;
/** ClickUp task ids (`86ca9t2h4`): short, lowercase alphanumerics with a digit. */
const TASK_ID = /^(?=.*\d)[a-z0-9]{7,12}$/;

export function isConceptCode(value: string | null | undefined): boolean {
  return !!value && CONCEPT_CODE.test(value.trim());
}

/** `MAN_SensitiveSwitcher_ContrarianTruth_v1` to `Sensitive Switcher, Contrarian Truth, v1`. */
export function humanizeConceptCode(code: string): string {
  const flat = noEmDash(code).trim();
  if (!CONCEPT_CODE.test(flat)) return flat;
  const parts = flat.split("_").slice(1);
  return parts
    .map((p) =>
      /^v\d+$/i.test(p)
        ? p.toLowerCase()
        : p
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    )
    .join(", ");
}

/**
 * The text a person should read for a concept.
 *
 * `name` is what a person wrote and wins unless it is itself a code. The id may
 * be a code, a short id such as `C07`, or the ClickUp task id the joins fall
 * back to (never printed). Returns null when nothing readable exists.
 */
export function conceptLabel(
  id: string | null | undefined,
  name?: string | null
): string | null {
  const n = name ? noEmDash(name).trim() : "";
  const i = id ? noEmDash(id).trim() : "";
  const readableName = n ? (isConceptCode(n) ? humanizeConceptCode(n) : n) : "";
  if (readableName) {
    // A short id (`C07`) is worth keeping beside the name, a code or a task id is not.
    return i && !isConceptCode(i) && !TASK_ID.test(i) && i !== n ? `${i} ${readableName}` : readableName;
  }
  if (!i) return null;
  if (isConceptCode(i)) return humanizeConceptCode(i);
  return TASK_ID.test(i) ? null : i;
}
