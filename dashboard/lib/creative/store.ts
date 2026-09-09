import "server-only";

/**
 * The Creative Engine's own Postgres tables.
 *
 * Four things live here rather than in the warehouse, and all four for the same
 * reason: they are inputs somebody types, not measurements anything reports.
 * The frontend service account is read-only on BigQuery by design, so this is
 * also the only place the app *can* write.
 *
 *   creative_settings   the per-client thresholds every verdict is taken against
 *   production_rates    per-asset cost estimates by method and format
 *   creator_rates       pay model and terms per creator
 *   decisions           the accountability log
 *
 * ── Why the DDL is here and not in lib/users/db.ts ─────────────────────────
 * That module's schema is applied before every single Postgres query, including
 * the one that authenticates a sign-in. A mistake in DDL living there takes the
 * whole application down — nobody can log in — which is a wildly
 * disproportionate blast radius for four tables one section uses. Created here
 * behind its own guard, the worst case is that the Creative Engine is
 * unavailable while the dashboard carries on working. Same reasoning as
 * `lib/users/accessLog.ts`.
 */

import { sql } from "@/lib/users/db";
import type { CreativeThresholds } from "@/lib/creative/stats";
import type { PayModel } from "@/lib/creative/vocabulary";

const DDL = `
CREATE TABLE IF NOT EXISTS creative_settings (
  client_id             TEXT PRIMARY KEY,
  -- The three money lines. Deliberately nullable with NO default: a guessed
  -- kill line silently reclassifies every ad in the account, and the guess
  -- would then be indistinguishable from a decision somebody took.
  break_even_roas       NUMERIC,
  kill_roas             NUMERIC,
  target_roas           NUMERIC,
  target_cpa            NUMERIC,
  gross_margin          NUMERIC,

  scale_multiplier      NUMERIC NOT NULL DEFAULT 1.2,
  aggressive_multiplier NUMERIC NOT NULL DEFAULT 2.0,
  hold_gate_x           NUMERIC NOT NULL DEFAULT 1,
  iterate_gate_x        NUMERIC NOT NULL DEFAULT 2,
  kill_gate_x           NUMERIC NOT NULL DEFAULT 3,

  min_adset_budget_daily NUMERIC,
  per_ad_floor_daily     NUMERIC,
  monthly_budget         NUMERIC,
  no_touch_days          INT NOT NULL DEFAULT 14,
  tier                   TEXT,

  read_purchases         INT NOT NULL DEFAULT 25,
  directional_purchases  INT NOT NULL DEFAULT 10,
  -- The dial that decides how often the tool says "not separable" instead of
  -- giving an answer. Set once per client and do not move it to get the answer
  -- you wanted.
  max_ci_halfwidth       NUMERIC NOT NULL DEFAULT 0.25,

  hook_rate_floor        NUMERIC NOT NULL DEFAULT 0.20,
  hold_rate_floor        NUMERIC NOT NULL DEFAULT 0.05,
  frequency_warn         NUMERIC NOT NULL DEFAULT 2.0,
  frequency_act          NUMERIC NOT NULL DEFAULT 3.0,

  test_purchases         INT NOT NULL DEFAULT 25,
  packs_per_month_target INT NOT NULL DEFAULT 2,
  hooks_per_body_target  INT NOT NULL DEFAULT 6,
  net_new_share_target   NUMERIC NOT NULL DEFAULT 0.20,

  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by             TEXT
);

CREATE TABLE IF NOT EXISTS production_rates (
  client_id         TEXT NOT NULL,
  production_method TEXT NOT NULL,
  -- NULL means "any format", and is the fallback when no exact row exists.
  format            TEXT NOT NULL DEFAULT '*',
  cost_per_asset    NUMERIC NOT NULL,
  includes_internal_time BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        TEXT,
  PRIMARY KEY (client_id, production_method, format)
);

CREATE TABLE IF NOT EXISTS creator_rates (
  client_id              TEXT NOT NULL,
  creator_id             TEXT NOT NULL,
  pay_model              TEXT,
  rate                   NUMERIC,
  deliverables_per_shoot INT,
  product_cogs           NUMERIC,
  usage_fee              NUMERIC,
  rev_share_pct          NUMERIC,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by             TEXT,
  PRIMARY KEY (client_id, creator_id)
);

CREATE TABLE IF NOT EXISTS decisions (
  id               BIGSERIAL PRIMARY KEY,
  client_id        TEXT NOT NULL,
  level            TEXT NOT NULL CHECK (level IN ('adset', 'concept', 'ad')),
  entity_id        TEXT NOT NULL,
  entity_name      TEXT,
  review_date      DATE NOT NULL,
  computed_verdict TEXT NOT NULL,
  final_verdict    TEXT NOT NULL,
  overridden       BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason  TEXT,
  learning_note    TEXT,
  spend            NUMERIC,
  purchases        INT,
  roas             NUMERIC,
  ci_low           NUMERIC,
  ci_high          NUMERIC,
  decided_by       TEXT NOT NULL,
  decided_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The SOP says a kill without a documented learning is invalid. Software can
  -- enforce that, so it does — at the DATABASE, not only in the form. A UI-only
  -- check is a suggestion: it is bypassed by any future code path, by a script,
  -- and by the next person to add a second kill button. This constraint cannot
  -- be bypassed by anything short of a migration, which is the correct amount
  -- of friction for deleting the reason a concept died.
  CONSTRAINT kill_needs_a_learning_note CHECK (
    final_verdict <> 'kill'
    OR (learning_note IS NOT NULL AND length(btrim(learning_note)) >= 10)
  ),

  -- Same principle: overriding the engine is allowed, doing it silently is not.
  CONSTRAINT override_needs_a_reason CHECK (
    overridden = FALSE
    OR (override_reason IS NOT NULL AND length(btrim(override_reason)) >= 5)
  )
);
CREATE TABLE IF NOT EXISTS creative_mappings (
  client_id       TEXT NOT NULL,
  ad_id           TEXT NOT NULL,
  clickup_task_id TEXT NOT NULL,
  method          TEXT NOT NULL,
  confidence      NUMERIC,
  confirmed_by    TEXT NOT NULL,
  confirmed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, ad_id)
);

CREATE INDEX IF NOT EXISTS decisions_client_idx ON decisions (client_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS decisions_entity_idx ON decisions (client_id, level, entity_id, decided_at DESC);
`;

const globalForSchema = globalThis as unknown as { oeCreativeSchema?: Promise<boolean> };

function ensure(): Promise<boolean> {
  if (!globalForSchema.oeCreativeSchema) {
    globalForSchema.oeCreativeSchema = sql(DDL)
      .then(() => true)
      .catch((error: unknown) => {
        const code = (error as { code?: string })?.code;
        // Two lambdas racing on CREATE ... IF NOT EXISTS: the loser sees a
        // duplicate-object error, which is the race resolving correctly.
        if (code === "23505" || code === "42P07" || code === "42710") return true;
        console.error("[creative] could not create the Creative Engine tables", error);
        globalForSchema.oeCreativeSchema = undefined;
        return false;
      });
  }
  return globalForSchema.oeCreativeSchema;
}

async function q<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!(await ensure())) return [];
  return sql<T>(text, params);
}

// pg returns NUMERIC as a string to avoid float precision loss.
const dec = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * The stored half of a client's settings. The three money lines are nullable
 * because an unset one must stop the engine rather than be filled in with a
 * plausible number.
 */
export interface StoredCreativeSettings {
  clientId: string;
  breakEvenRoas: number | null;
  killRoas: number | null;
  targetRoas: number | null;
  targetCpa: number | null;
  grossMargin: number | null;
  scaleMultiplier: number;
  aggressiveMultiplier: number;
  holdGateX: number;
  iterateGateX: number;
  killGateX: number;
  minAdsetBudgetDaily: number | null;
  perAdFloorDaily: number | null;
  monthlyBudget: number | null;
  noTouchDays: number;
  tier: string | null;
  readPurchases: number;
  directionalPurchases: number;
  maxCiHalfWidth: number;
  hookRateFloor: number;
  holdRateFloor: number;
  frequencyWarn: number;
  frequencyAct: number;
  testPurchases: number;
  packsPerMonthTarget: number;
  hooksPerBodyTarget: number;
  netNewShareTarget: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

const DEFAULTS: Omit<StoredCreativeSettings, "clientId" | "updatedAt" | "updatedBy"> = {
  breakEvenRoas: null, killRoas: null, targetRoas: null, targetCpa: null,
  grossMargin: null,
  scaleMultiplier: 1.2, aggressiveMultiplier: 2.0,
  holdGateX: 1, iterateGateX: 2, killGateX: 3,
  minAdsetBudgetDaily: null, perAdFloorDaily: null, monthlyBudget: null,
  noTouchDays: 14, tier: null,
  readPurchases: 25, directionalPurchases: 10, maxCiHalfWidth: 0.25,
  hookRateFloor: 0.2, holdRateFloor: 0.05, frequencyWarn: 2, frequencyAct: 3,
  testPurchases: 25, packsPerMonthTarget: 2, hooksPerBodyTarget: 6,
  netNewShareTarget: 0.2,
};

function toSettings(r: Record<string, unknown>): StoredCreativeSettings {
  const n = (k: string, fallback: number) => dec(r[k]) ?? fallback;
  return {
    clientId: String(r.client_id),
    breakEvenRoas: dec(r.break_even_roas),
    killRoas: dec(r.kill_roas),
    targetRoas: dec(r.target_roas),
    targetCpa: dec(r.target_cpa),
    grossMargin: dec(r.gross_margin),
    scaleMultiplier: n("scale_multiplier", DEFAULTS.scaleMultiplier),
    aggressiveMultiplier: n("aggressive_multiplier", DEFAULTS.aggressiveMultiplier),
    holdGateX: n("hold_gate_x", DEFAULTS.holdGateX),
    iterateGateX: n("iterate_gate_x", DEFAULTS.iterateGateX),
    killGateX: n("kill_gate_x", DEFAULTS.killGateX),
    minAdsetBudgetDaily: dec(r.min_adset_budget_daily),
    perAdFloorDaily: dec(r.per_ad_floor_daily),
    monthlyBudget: dec(r.monthly_budget),
    noTouchDays: n("no_touch_days", DEFAULTS.noTouchDays),
    tier: (r.tier as string) ?? null,
    readPurchases: n("read_purchases", DEFAULTS.readPurchases),
    directionalPurchases: n("directional_purchases", DEFAULTS.directionalPurchases),
    maxCiHalfWidth: n("max_ci_halfwidth", DEFAULTS.maxCiHalfWidth),
    hookRateFloor: n("hook_rate_floor", DEFAULTS.hookRateFloor),
    holdRateFloor: n("hold_rate_floor", DEFAULTS.holdRateFloor),
    frequencyWarn: n("frequency_warn", DEFAULTS.frequencyWarn),
    frequencyAct: n("frequency_act", DEFAULTS.frequencyAct),
    testPurchases: n("test_purchases", DEFAULTS.testPurchases),
    packsPerMonthTarget: n("packs_per_month_target", DEFAULTS.packsPerMonthTarget),
    hooksPerBodyTarget: n("hooks_per_body_target", DEFAULTS.hooksPerBodyTarget),
    netNewShareTarget: n("net_new_share_target", DEFAULTS.netNewShareTarget),
    updatedAt: (r.updated_at as Date | null)?.toISOString() ?? null,
    updatedBy: (r.updated_by as string) ?? null,
  };
}

export async function getCreativeSettings(
  clientId: string
): Promise<StoredCreativeSettings> {
  const rows = await q(`SELECT * FROM creative_settings WHERE client_id = $1`, [clientId]);
  if (!rows[0]) {
    return { clientId, ...DEFAULTS, updatedAt: null, updatedBy: null };
  }
  return toSettings(rows[0]);
}

/**
 * Turn stored settings into the thresholds the engine runs on.
 *
 * Returns null when a money line is missing. Every caller must handle that by
 * showing the delivery figures and refusing to render a verdict — which is the
 * correct behaviour, because "SCALE" computed against an invented target is
 * indistinguishable on screen from one computed against the client's real one.
 */
/**
 * Thresholds good enough to RENDER with, when the money lines are missing.
 *
 * The kill line sits at 0 and the target at infinity, so nothing is ever
 * coloured as winning or losing and no verdict can fire. Everything that does
 * not depend on the money lines — shrinkage, the confidence classes, the
 * attention-metric floors — keeps working, which is what lets the creative
 * wall render before anybody has been to Settings.
 *
 * The alternative, and what shipped first, was to render no grid at all until
 * the three lines existed. That turned the main screen of the product into a
 * warning box: 195 ads and 585 607 Kc of real delivery sat behind it, invisible.
 * Refusing to *judge* without a target is right. Refusing to *show* is not.
 */
export function toDisplayThresholds(s: StoredCreativeSettings): CreativeThresholds {
  return {
    killRoas: 0,
    targetRoas: Number.POSITIVE_INFINITY,
    targetCpa: s.targetCpa ?? 0,
    grossMargin: s.grossMargin,
    scaleMultiplier: s.scaleMultiplier,
    aggressiveMultiplier: s.aggressiveMultiplier,
    holdGateX: s.holdGateX,
    iterateGateX: s.iterateGateX,
    killGateX: s.killGateX,
    readPurchases: s.readPurchases,
    directionalPurchases: s.directionalPurchases,
    maxCiHalfWidth: s.maxCiHalfWidth,
    hookRateFloor: s.hookRateFloor,
    holdRateFloor: s.holdRateFloor,
    frequencyWarn: s.frequencyWarn,
    frequencyAct: s.frequencyAct,
    noTouchDays: s.noTouchDays,
    minAdsetBudgetDaily: s.minAdsetBudgetDaily,
    perAdFloorDaily: s.perAdFloorDaily,
    tier: s.tier,
  };
}

export function toThresholds(s: StoredCreativeSettings): CreativeThresholds | null {
  if (s.killRoas === null || s.targetRoas === null || s.targetCpa === null) return null;
  return {
    killRoas: s.killRoas,
    targetRoas: s.targetRoas,
    targetCpa: s.targetCpa,
    grossMargin: s.grossMargin,
    scaleMultiplier: s.scaleMultiplier,
    aggressiveMultiplier: s.aggressiveMultiplier,
    holdGateX: s.holdGateX,
    iterateGateX: s.iterateGateX,
    killGateX: s.killGateX,
    readPurchases: s.readPurchases,
    directionalPurchases: s.directionalPurchases,
    maxCiHalfWidth: s.maxCiHalfWidth,
    hookRateFloor: s.hookRateFloor,
    holdRateFloor: s.holdRateFloor,
    frequencyWarn: s.frequencyWarn,
    frequencyAct: s.frequencyAct,
    noTouchDays: s.noTouchDays,
    minAdsetBudgetDaily: s.minAdsetBudgetDaily,
    perAdFloorDaily: s.perAdFloorDaily,
    tier: s.tier,
  };
}

export async function saveCreativeSettings(
  clientId: string,
  input: Partial<Omit<StoredCreativeSettings, "clientId" | "updatedAt" | "updatedBy">>,
  updatedBy: string
): Promise<void> {
  const columns: Record<string, unknown> = {
    break_even_roas: input.breakEvenRoas,
    kill_roas: input.killRoas,
    target_roas: input.targetRoas,
    target_cpa: input.targetCpa,
    gross_margin: input.grossMargin,
    min_adset_budget_daily: input.minAdsetBudgetDaily,
    per_ad_floor_daily: input.perAdFloorDaily,
    monthly_budget: input.monthlyBudget,
    no_touch_days: input.noTouchDays,
    tier: input.tier,
    read_purchases: input.readPurchases,
    directional_purchases: input.directionalPurchases,
    max_ci_halfwidth: input.maxCiHalfWidth,
    hook_rate_floor: input.hookRateFloor,
    hold_rate_floor: input.holdRateFloor,
    test_purchases: input.testPurchases,
    packs_per_month_target: input.packsPerMonthTarget,
    hooks_per_body_target: input.hooksPerBodyTarget,
    net_new_share_target: input.netNewShareTarget,
  };
  const present = Object.entries(columns).filter(([, v]) => v !== undefined);
  const names = present.map(([k]) => k);
  const values = present.map(([, v]) => v);

  const placeholders = names.map((_, i) => `$${i + 2}`);
  const updates = names.map((n, i) => `${n} = $${i + 2}`);

  await q(
    `INSERT INTO creative_settings (client_id${names.length ? ", " + names.join(", ") : ""}, updated_by)
     VALUES ($1${placeholders.length ? ", " + placeholders.join(", ") : ""}, $${names.length + 2})
     ON CONFLICT (client_id) DO UPDATE SET
       ${updates.length ? updates.join(", ") + "," : ""}
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by`,
    [clientId, ...values, updatedBy]
  );
}

// ---------------------------------------------------------------------------
// Production rates and creator terms
// ---------------------------------------------------------------------------

export interface StoredProductionRate {
  productionMethod: string;
  /** `*` in the database; null in the domain, meaning "any format". */
  format: string | null;
  costPerAsset: number;
  includesInternalTime: boolean;
  notes: string | null;
}

export async function getProductionRates(
  clientId: string
): Promise<StoredProductionRate[]> {
  const rows = await q(
    `SELECT production_method, format, cost_per_asset, includes_internal_time, notes
     FROM production_rates WHERE client_id = $1 ORDER BY production_method, format`,
    [clientId]
  );
  return rows.map((r) => ({
    productionMethod: String(r.production_method),
    format: r.format === "*" ? null : String(r.format),
    costPerAsset: dec(r.cost_per_asset) ?? 0,
    includesInternalTime: r.includes_internal_time === true,
    notes: (r.notes as string) ?? null,
  }));
}

export async function saveProductionRate(
  clientId: string,
  input: StoredProductionRate,
  updatedBy: string
): Promise<void> {
  await q(
    `INSERT INTO production_rates
       (client_id, production_method, format, cost_per_asset, includes_internal_time, notes, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (client_id, production_method, format) DO UPDATE SET
       cost_per_asset = EXCLUDED.cost_per_asset,
       includes_internal_time = EXCLUDED.includes_internal_time,
       notes = EXCLUDED.notes,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by`,
    [
      clientId, input.productionMethod, input.format ?? "*",
      input.costPerAsset, input.includesInternalTime, input.notes, updatedBy,
    ]
  );
}

export interface StoredCreatorTerms {
  creatorId: string;
  payModel: PayModel | null;
  rate: number | null;
  deliverablesPerShoot: number | null;
  productCogs: number | null;
  usageFee: number | null;
  revSharePct: number | null;
}

export async function getCreatorTerms(clientId: string): Promise<StoredCreatorTerms[]> {
  const rows = await q(`SELECT * FROM creator_rates WHERE client_id = $1`, [clientId]);
  return rows.map((r) => ({
    creatorId: String(r.creator_id),
    payModel: (r.pay_model as PayModel) ?? null,
    rate: dec(r.rate),
    deliverablesPerShoot: dec(r.deliverables_per_shoot),
    productCogs: dec(r.product_cogs),
    usageFee: dec(r.usage_fee),
    revSharePct: dec(r.rev_share_pct),
  }));
}

export async function saveCreatorTerms(
  clientId: string,
  input: StoredCreatorTerms,
  updatedBy: string
): Promise<void> {
  await q(
    `INSERT INTO creator_rates
       (client_id, creator_id, pay_model, rate, deliverables_per_shoot,
        product_cogs, usage_fee, rev_share_pct, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (client_id, creator_id) DO UPDATE SET
       pay_model = EXCLUDED.pay_model, rate = EXCLUDED.rate,
       deliverables_per_shoot = EXCLUDED.deliverables_per_shoot,
       product_cogs = EXCLUDED.product_cogs, usage_fee = EXCLUDED.usage_fee,
       rev_share_pct = EXCLUDED.rev_share_pct,
       updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [
      clientId, input.creatorId, input.payModel, input.rate,
      input.deliverablesPerShoot, input.productCogs, input.usageFee,
      input.revSharePct, updatedBy,
    ]
  );
}

// ---------------------------------------------------------------------------
// The decisions log
// ---------------------------------------------------------------------------

export interface Decision {
  id: number;
  clientId: string;
  level: "adset" | "concept" | "ad";
  entityId: string;
  entityName: string | null;
  reviewDate: string;
  computedVerdict: string;
  finalVerdict: string;
  overridden: boolean;
  overrideReason: string | null;
  learningNote: string | null;
  spend: number | null;
  purchases: number | null;
  roas: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  decidedBy: string;
  decidedAt: string;
}

export interface NewDecision {
  clientId: string;
  level: "adset" | "concept" | "ad";
  entityId: string;
  entityName: string | null;
  reviewDate: string;
  computedVerdict: string;
  finalVerdict: string;
  overrideReason: string | null;
  learningNote: string | null;
  spend: number | null;
  purchases: number | null;
  roas: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  decidedBy: string;
}

/**
 * Record a decision.
 *
 * `overridden` is derived rather than passed: it is true exactly when the human
 * did something other than what the engine said, which is a fact about the two
 * values and not a checkbox anybody should be able to get wrong.
 *
 * The kill-without-a-learning-note rejection comes from the database
 * constraint, not from a check here. This function deliberately does not
 * pre-validate it — a caller that bypassed this function would then bypass the
 * rule, and the whole point is that it cannot be bypassed.
 */
export async function recordDecision(input: NewDecision): Promise<void> {
  const overridden = input.finalVerdict !== input.computedVerdict;
  await q(
    `INSERT INTO decisions
       (client_id, level, entity_id, entity_name, review_date,
        computed_verdict, final_verdict, overridden, override_reason, learning_note,
        spend, purchases, roas, ci_low, ci_high, decided_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      input.clientId, input.level, input.entityId, input.entityName, input.reviewDate,
      input.computedVerdict, input.finalVerdict, overridden, input.overrideReason,
      input.learningNote, input.spend, input.purchases, input.roas,
      input.ciLow, input.ciHigh, input.decidedBy,
    ]
  );
}

export async function listDecisions(
  clientId: string,
  limit = 100
): Promise<Decision[]> {
  const rows = await q(
    `SELECT * FROM decisions WHERE client_id = $1 ORDER BY decided_at DESC LIMIT $2`,
    [clientId, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    clientId: String(r.client_id),
    level: r.level as Decision["level"],
    entityId: String(r.entity_id),
    entityName: (r.entity_name as string) ?? null,
    reviewDate: (r.review_date as Date)?.toISOString().slice(0, 10) ?? "",
    computedVerdict: String(r.computed_verdict),
    finalVerdict: String(r.final_verdict),
    overridden: r.overridden === true,
    overrideReason: (r.override_reason as string) ?? null,
    learningNote: (r.learning_note as string) ?? null,
    spend: dec(r.spend),
    purchases: dec(r.purchases),
    roas: dec(r.roas),
    ciLow: dec(r.ci_low),
    ciHigh: dec(r.ci_high),
    decidedBy: String(r.decided_by),
    decidedAt: (r.decided_at as Date)?.toISOString() ?? "",
  }));
}

/** The most recent decision per entity, for showing "last reviewed" inline. */
export async function latestDecisionByEntity(
  clientId: string
): Promise<Map<string, Decision>> {
  const all = await listDecisions(clientId, 500);
  const out = new Map<string, Decision>();
  for (const d of all) {
    const key = `${d.level}:${d.entityId}`;
    if (!out.has(key)) out.set(key, d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Confirmed mappings
// ---------------------------------------------------------------------------

/**
 * A local record of a mapping a human confirmed.
 *
 * ── Why this exists when the warehouse is the source of truth ──────────────
 * Confirming a match writes the ad_id into ClickUp, and the sync then rebuilds
 * `ref.creative_tags` from it — but that sync runs hourly. Without this table
 * the ad you just mapped stays in the Unmapped queue for up to an hour, which
 * reads as "the button did not work" and invites somebody to press it again.
 *
 * It is a read-through cache with an audit trail attached, never an authority.
 * The queue subtracts it; nothing else consults it. If ClickUp and this
 * disagree, ClickUp wins on the next sync, and it should.
 */
export interface ConfirmedMapping {
  adId: string;
  clickupTaskId: string;
  method: string;
  confidence: number | null;
  confirmedBy: string;
  confirmedAt: string;
}

export async function listConfirmedMappings(
  clientId: string
): Promise<ConfirmedMapping[]> {
  const rows = await q(
    `SELECT ad_id, clickup_task_id, method, confidence, confirmed_by, confirmed_at
     FROM creative_mappings WHERE client_id = $1`,
    [clientId]
  );
  return rows.map((r) => ({
    adId: String(r.ad_id),
    clickupTaskId: String(r.clickup_task_id),
    method: String(r.method),
    confidence: dec(r.confidence),
    confirmedBy: String(r.confirmed_by),
    confirmedAt: (r.confirmed_at as Date)?.toISOString() ?? "",
  }));
}

export async function recordMapping(
  clientId: string,
  input: { adId: string; clickupTaskId: string; method: string; confidence: number | null },
  confirmedBy: string
): Promise<void> {
  await q(
    `INSERT INTO creative_mappings
       (client_id, ad_id, clickup_task_id, method, confidence, confirmed_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (client_id, ad_id) DO UPDATE SET
       clickup_task_id = EXCLUDED.clickup_task_id,
       method = EXCLUDED.method,
       confidence = EXCLUDED.confidence,
       confirmed_by = EXCLUDED.confirmed_by,
       confirmed_at = NOW()`,
    [clientId, input.adId, input.clickupTaskId, input.method, input.confidence, confirmedBy]
  );
}
