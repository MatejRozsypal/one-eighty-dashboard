"use server";

/**
 * Settings mutations.
 *
 * Every action re-checks the session itself. Server actions are individually
 * addressable POST endpoints, the page they were rendered from is not a gate,
 * and a caller can invoke one without ever loading it, so the role check has
 * to live in the action, not in the screen that draws the form.
 */

import { revalidatePath } from "next/cache";
import { requireInternalForConfig } from "@/lib/authz";
import { saveCreativeSettings } from "@/lib/creative/store";
import { saveMarketCostCard } from "@/lib/markets/costStore";
import { checkCostCard, COST_FIELDS, isCardMarket, type CostField } from "@/lib/markets/costCardForm";
import { isDemo } from "@/lib/demo/client";

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
      // Velocity planning input only. `directionalPurchases` is not on the
      // form any more and is left out, so its stored value is not overwritten.
      readPurchases: numberOr("readPurchases", 25),
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

// ---------------------------------------------------------------------------
// Market cost cards (Markets page CM2 / CM3)
// ---------------------------------------------------------------------------

/**
 * One market's cost card. Saving with a new "effective from" date adds a card
 * and keeps the old one (history); the same date corrects that card.
 *
 * The form validates as you type; this repeats the same check because a server
 * action is a POST endpoint anyone signed in can call without the form.
 */
export async function saveMarketCostCardAction(formData: FormData): Promise<void> {
  const { email } = await requireInternalForConfig();
  const clientId = String(formData.get("clientId") ?? "");
  const market = String(formData.get("market") ?? "").toUpperCase();
  if (!clientId || isDemo(clientId)) throw new Error("This client is read only.");
  if (!isCardMarket(market)) throw new Error("Unknown market.");

  const values = Object.fromEntries(
    COST_FIELDS.map((f) => [f.key, String(formData.get(f.key) ?? "")])
  ) as Record<CostField, string>;
  const checked = checkCostCard({ effectiveFrom: String(formData.get("effectiveFrom") ?? ""), values });
  if (!checked.card) throw new Error(`Invalid cost card: ${Object.values(checked.errors).join(", ")}`);

  await saveMarketCostCard(clientId, { market, ...checked.card }, email);

  revalidatePath("/settings");
  revalidatePath("/markets");
}
