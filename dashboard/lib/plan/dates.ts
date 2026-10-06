/**
 * Calendar helpers for the Plan page. ISO `YYYY-MM-DD` strings in, strings
 * out, all in UTC so a date never shifts with the server's timezone. Pure.
 */

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
  const d = parse(monthStart(date));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return iso(d);
}

export function addMonths(date: string, months: number): string {
  const d = parse(monthStart(date));
  d.setUTCMonth(d.getUTCMonth() + months);
  return iso(d);
}

/** Whole months from the month of `a` to the month of `b`. */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

export function quarterStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const q = Math.floor((m - 1) / 3);
  return `${y}-${String(q * 3 + 1).padStart(2, "0")}-01`;
}

/** `2026-Q4`, the id the pacing table uses. */
export function quarterId(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/** ISO 8601 week: the year it belongs to and its number. */
export function isoWeek(date: string): { year: number; week: number; monday: string } {
  const d = parse(date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday 0
  const monday = addDays(date, -dow);
  const thursday = parse(addDays(monday, 3));
  const year = thursday.getUTCFullYear();
  const jan4 = parse(`${year}-01-04`);
  const jan4Monday = addDays(iso(jan4), -((jan4.getUTCDay() + 6) % 7));
  const week = Math.round(daysBetween(jan4Monday, monday) / 7) + 1;
  return { year, week, monday };
}

/** `2026-W41`. */
export function isoWeekId(date: string): string {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function datesFrom(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "Oct 5". */
export function fmtDay(date: string): string {
  return date ? SHORT.format(parse(date)) : "";
}

/** "October 2026". */
export function fmtMonth(date: string): string {
  return MONTH_YEAR.format(parse(monthStart(date)));
}

/** "Oct 2026". */
export function fmtMonthShort(date: string): string {
  return MONTH_SHORT.format(parse(monthStart(date)));
}

/** "Oct 9 to Oct 31", or one day. */
export function fmtRange(from: string, to: string): string {
  if (!from) return "";
  return from === to ? fmtDay(from) : `${fmtDay(from)} to ${fmtDay(to)}`;
}
