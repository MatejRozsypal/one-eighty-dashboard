/**
 * Small pure formatters for the report list, the switcher and the share menu.
 * Owner: RS9.
 */

import type { Visibility } from "@/lib/reports/types";

/** Row label of a visibility (design 1.3: "Team:edit"). */
export const VISIBILITY_SHORT: Readonly<Record<Visibility, string>> = {
  private: "Private",
  team_view: "Team: view",
  team_edit: "Team: edit",
};

/** Menu label of a visibility. */
export const VISIBILITY_LONG: Readonly<Record<Visibility, string>> = {
  private: "Private",
  team_view: "Team can view",
  team_edit: "Team can edit",
};

/** Initials of an email local part: "matej.r@x" gives "MR", "lukas@x" gives "LU". */
export function ownerInitials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase() || "?";
}

/** "now", "5m", "2h", "3d", "9w", then a month and year. */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d`;
  const w = Math.round(d / 7);
  if (w < 9) return `${w}w`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "1 widget", "12 widgets". */
export function widgetCountLabel(n: number): string {
  return `${n} ${n === 1 ? "widget" : "widgets"}`;
}

/** `/reports/<id>` plus the filter params of the current query string. */
export function reportHref(id: string, search: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams(search);
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  const qs = params.toString();
  return qs ? `/reports/${id}?${qs}` : `/reports/${id}`;
}
