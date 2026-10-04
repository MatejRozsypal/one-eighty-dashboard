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
