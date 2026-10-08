/**
 * The greeting at the top of Home. Pure, safe in client components.
 */

/** The founders work from Prague; the server renders in this zone, the browser then uses its own. */
export const HOME_TIME_ZONE = "Europe/Prague";

/** Hour of day (0 to 23) in a time zone. */
export function hourIn(date: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(date);
  const n = Number(h);
  return Number.isFinite(n) ? n : date.getHours();
}

export function partOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * First name from the session: the first word of the account name, else the
 * email's local part ("lukas.novak@" -> "Lukas"). Null when neither gives one.
 */
export function firstName(name: string | null | undefined, email: string | null | undefined): string | null {
  const fromName = name?.trim().split(/\s+/)[0];
  if (fromName && !fromName.includes("@")) return callName(fromName);
  const local = email?.split("@")[0]?.split(/[._-]/)[0];
  if (!local) return null;
  return callName(local.charAt(0).toUpperCase() + local.slice(1));
}

/** The names the founders go by, whatever the account stores. */
const CALL_NAMES: Record<string, string> = {
  matej: "Matt",
  lukas: "Lukas",
};

function callName(first: string): string {
  const key = first.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  return CALL_NAMES[key] ?? first;
}

/** "Thursday, 8 October". */
export function longDate(date: Date, timeZone?: string): string {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone });
}
