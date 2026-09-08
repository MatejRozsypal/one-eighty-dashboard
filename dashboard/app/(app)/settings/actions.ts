"use server";

/**
 * Settings mutations.
 *
 * Every action re-checks the session itself. Server actions are individually
 * addressable POST endpoints — the page they were rendered from is not a gate,
 * and a caller can invoke one without ever loading it — so the role check has
 * to live in the action, not in the screen that draws the form.
 */

import { revalidatePath } from "next/cache";
import { isGoalMetric, saveGoal } from "@/lib/goals/store";
import { isDemo } from "@/lib/demo/client";
import { requireInternalForConfig } from "@/lib/authz";
import { saveCreativeSettings } from "@/lib/creative/store";

/**
 * Parse a target from a form field.
 *
 * An empty box clears the target rather than storing zero. The two are
 * genuinely different — zero is an intention, absent is nobody having said —
 * and the Goals page renders them differently, so the distinction has to
 * survive the form.
 */
function parseTarget(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim().replace(/\s|,/g, "");
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`"${raw}" is not a target. Use a number, or empty to clear.`);
  }
  return n;
}

export async function saveGoalsAction(formData: FormData): Promise<void> {
  const { email } = await requireInternalForConfig();

  const clientId = String(formData.get("clientId") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!clientId || !/^\d{4}-\d{2}-01$/.test(month)) {
    throw new Error("A target needs a client and a month.");
  }

  // The demo's targets are generated in code so they always frame its data.
  // Accepting a save would write rows nothing reads.
  if (isDemo(clientId)) {
    throw new Error("The demo client's targets are fixed in code.");
  }

  // One form carries every metric for a month, so a month is saved as a unit
  // rather than four separate round trips.
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("target_")) continue;
    const metric = key.slice("target_".length);
    if (!isGoalMetric(metric)) continue;
    await saveGoal(clientId, metric, month, parseTarget(value), email);
  }

  revalidatePath("/settings");
  revalidatePath("/goals");
}

// ---------------------------------------------------------------------------
// Creative Engine thresholds
// ---------------------------------------------------------------------------

/**
 * The lines every creative verdict is taken against.
 *
 * ── Why the three money fields have no default ─────────────────────────────
 * Kill ROAS, target ROAS and target CPA are left null until somebody states
 * them, and the whole Creative section refuses to issue a verdict without all
 * three. That is deliberate and slightly inconvenient: a verdict computed
 * against a guessed target is indistinguishable on screen from one computed
 * against the client's real one, and it is the screen somebody quotes in a
 * meeting. Better a section that says "no thresholds set" than one that says
 * "KILL" for a reason nobody chose.
 *
 * The derived floors are not stored at all. `min_adset_budget_daily` defaults
 * to 2x CPA and `per_ad_floor_daily` to 0.5x CPA at read time, so correcting a
 * CPA moves the whole velocity model instead of leaving two stale numbers
 * behind it.
 */
export async function saveCreativeSettingsAction(formData: FormData): Promise<void> {
  const { email } = await requireInternalForConfig();

  const numberOrNull = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const numberOr = (key: string, fallback: number): number =>
    numberOrNull(key) ?? fallback;

  const grossMarginPct = numberOrNull("grossMarginPct");
  const maxCiPct = numberOrNull("maxCiHalfWidthPct");
  const netNewPct = numberOrNull("netNewSharePct");
  const hookPct = numberOrNull("hookRateFloorPct");
  const holdPct = numberOrNull("holdRateFloorPct");

  await saveCreativeSettings(
    String(formData.get("clientId") ?? ""),
    {
      killRoas: numberOrNull("killRoas"),
      breakEvenRoas: numberOrNull("breakEvenRoas"),
      targetRoas: numberOrNull("targetRoas"),
      targetCpa: numberOrNull("targetCpa"),
      // Entered as percentages because that is how people say them; stored as
      // shares, because that is how they are used.
      grossMargin: grossMarginPct === null ? null : grossMarginPct / 100,
      monthlyBudget: numberOrNull("monthlyBudget"),
      minAdsetBudgetDaily: numberOrNull("minAdsetBudgetDaily"),
      perAdFloorDaily: numberOrNull("perAdFloorDaily"),
      noTouchDays: numberOr("noTouchDays", 14),
      tier: String(formData.get("tier") ?? "").trim() || null,
      readPurchases: numberOr("readPurchases", 25),
      directionalPurchases: numberOr("directionalPurchases", 10),
      maxCiHalfWidth: maxCiPct === null ? 0.25 : maxCiPct / 100,
      hookRateFloor: hookPct === null ? 0.2 : hookPct / 100,
      holdRateFloor: holdPct === null ? 0.05 : holdPct / 100,
      testPurchases: numberOr("testPurchases", 25),
      packsPerMonthTarget: numberOr("packsPerMonthTarget", 2),
      hooksPerBodyTarget: numberOr("hooksPerBodyTarget", 6),
      netNewShareTarget: netNewPct === null ? 0.2 : netNewPct / 100,
    },
    email
  );

  revalidatePath("/settings");
  revalidatePath("/creative");
}
