/**
 * Where the Plan page reads from, in one place.
 *
 * Production and previews both read the deployed objects in `mart`. Set
 * `PLAN_DATASET_OVERRIDE=mart_qa` to read the QA copies instead (the reader
 * then needs access to that dataset). The demo client never reaches either.
 *
 * Every name is fully qualified and backtick-ready. Plan rows (Target state
 * and the rest) are read through `plan_input`, the single reader of plan rows:
 * after the ClickUp loader swap it wraps the ClickUp staging view, which the
 * dashboard's service account cannot read directly.
 */

import { PROJECT_ID } from "@/lib/bigquery";

export type PlanSource = "mart" | "mart_qa";

export interface PlanTables {
  source: PlanSource;
  /** Client x period x metric pacing (all period types). */
  pacing: string;
  /** Client x day x metric curve target. */
  targetsDaily: string;
  /** Promo x day attribution, plus one `total` row per promo. */
  promoPerf: string;
  /** Client x day store actuals (plan revenue definition). */
  actualsDaily: string;
  /** Current plan rows per task (Target state, Quarter, Month, Promo, Checkpoint). */
  planInput: string;
}

const QA_NAMES = {
  pacing: "pp1_plan_pacing",
  targetsDaily: "pp1_plan_targets_daily",
  promoPerf: "pp2_plan_promo_perf",
  actualsDaily: "pp1_plan_actuals_daily",
  planInput: "pp1_plan_input",
} as const;

const PROD_NAMES = {
  pacing: "plan_pacing",
  targetsDaily: "plan_targets_daily",
  promoPerf: "plan_promo_perf",
  actualsDaily: "plan_actuals_daily",
  planInput: "plan_input",
} as const;

export function planSource(env: Record<string, string | undefined> = process.env): PlanSource {
  const override = env.PLAN_DATASET_OVERRIDE?.trim();
  return override === "mart_qa" ? "mart_qa" : "mart";
}

export function planTables(env: Record<string, string | undefined> = process.env): PlanTables {
  const source = planSource(env);
  const names = source === "mart_qa" ? QA_NAMES : PROD_NAMES;
  const q = (table: string) => `\`${PROJECT_ID}.${source}.${table}\``;
  return {
    source,
    pacing: q(names.pacing),
    targetsDaily: q(names.targetsDaily),
    promoPerf: q(names.promoPerf),
    actualsDaily: q(names.actualsDaily),
    planInput: q(names.planInput),
  };
}

export const PLAN_TABLES: PlanTables = planTables();
