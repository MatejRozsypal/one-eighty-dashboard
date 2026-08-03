import "server-only";

/**
 * Monthly targets per client.
 *
 * ── Why monthly, and only monthly ───────────────────────────────────────────
 * A target is stored for one metric in one calendar month. Quarters and years
 * are summed from those months rather than stored alongside them, because two
 * independent numbers that ought to agree eventually will not: someone edits
 * March, nobody revisits the annual figure, and the dashboard then shows two
 * different answers to "what are we aiming at". Summing has one source.
 *
 * The cost is that a genuine annual target cannot be expressed except by
 * dividing it across months. That is the right trade here — the plan the
 * business actually runs on is monthly, and it is the grain the Growth page
 * already uses.
 *
 * ── Why targets are absolute, never ratios ──────────────────────────────────
 * Revenue, orders, new customers and CM3 are all quantities that add up across
 * months, so attainment means the same thing at every level: 87% of a month,
 * of a quarter, of a year. A target on MER or CAC would not survive the same
 * roll-up — you cannot sum a ratio — and "under target" would be *good* for
 * CAC and bad for revenue, so each would have to carry a direction. Excluded
 * deliberately rather than by omission.
 *
 * ── Why this is not in BigQuery ─────────────────────────────────────────────
 * Same reasoning as `client_settings` next door: a target is a stated
 * intention, not a measurement. The warehouse holds what happened; this holds
 * what somebody said they wanted to happen.
 */

import { sql, userStoreConfigured } from "@/lib/users/db";

/** The metrics a target may be set on. Absolute quantities only — see above. */
export const GOAL_METRICS = [
  {
    key: "revenue",
    label: "Revenue",
    /** How the Goals page should render the number. */
    format: "money" as const,
    blurb: "Net sales plus shipping, in the client's trading currency.",
  },
  {
    key: "orders",
    label: "Orders",
    format: "number" as const,
    blurb: "Every order in the month, first-time and returning.",
  },
  {
    key: "new_customers",
    label: "New customers",
    format: "number" as const,
    blurb: "First-time customer orders — the acquisition number.",
  },
  {
    key: "cm3",
    label: "CM3",
    format: "money" as const,
    blurb: "Contribution margin after COGS, paid media and fulfilment.",
  },
] as const;

export type GoalMetric = (typeof GOAL_METRICS)[number]["key"];

export const GOAL_METRIC_KEYS: GoalMetric[] = GOAL_METRICS.map((m) => m.key);

export function isGoalMetric(value: string): value is GoalMetric {
  return (GOAL_METRIC_KEYS as string[]).includes(value);
}

export function goalMetricSpec(metric: GoalMetric) {
  return GOAL_METRICS.find((m) => m.key === metric)!;
}

export interface Goal {
  clientId: string;
  metric: GoalMetric;
  /** First day of the target month, ISO. */
  month: string;
  target: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Created lazily and separately from the shared schema, for the same reason as
 * the access log: `ensureSchema()` runs before every query including sign-in,
 * so a mistake in DDL living there locks everyone out.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS client_goals (
  client_id   TEXT NOT NULL,
  metric      TEXT NOT NULL CHECK (metric IN ('revenue', 'orders', 'new_customers', 'cm3')),
  month       DATE NOT NULL,
  target      NUMERIC NOT NULL CHECK (target >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT,
  PRIMARY KEY (client_id, metric, month)
);
CREATE INDEX IF NOT EXISTS client_goals_client_month_idx ON client_goals (client_id, month);
`;

const globalForGoals = globalThis as unknown as { oeGoalsReady?: Promise<boolean> };

function ensureTable(): Promise<boolean> {
  if (!globalForGoals.oeGoalsReady) {
    globalForGoals.oeGoalsReady = sql(DDL)
      .then(() => true)
      .catch((error: unknown) => {
        const code = (error as { code?: string })?.code;
        if (code === "23505" || code === "42P07" || code === "42710") return true;
        console.error("[goals] could not create client_goals", error);
        globalForGoals.oeGoalsReady = undefined;
        return false;
      });
  }
  return globalForGoals.oeGoalsReady;
}

interface Row extends Record<string, unknown> {
  client_id: string;
  metric: GoalMetric;
  month: Date;
  target: string | number;
  updated_at: Date | null;
  updated_by: string | null;
}

function toGoal(r: Row): Goal {
  return {
    clientId: r.client_id,
    metric: r.metric,
    // Read as UTC — a DATE has no timezone, and letting the server's offset
    // shift it turns 2026-03-01 into February for anyone west of UTC.
    month: new Date(r.month).toISOString().slice(0, 10),
    target: Number(r.target),
    updatedAt: r.updated_at?.toISOString() ?? null,
    updatedBy: r.updated_by,
  };
}

/** Every goal for a client within a year, oldest first. */
export async function listGoals(
  clientId: string,
  year: number
): Promise<Goal[]> {
  if (!userStoreConfigured()) return [];
  if (!(await ensureTable())) return [];

  const rows = await sql<Row>(
    `SELECT client_id, metric, month, target, updated_at, updated_by
       FROM client_goals
      WHERE client_id = $1
        AND month >= make_date($2, 1, 1)
        AND month <  make_date($2 + 1, 1, 1)
      ORDER BY month, metric`,
    [clientId, year]
  );
  return rows.map(toGoal);
}

/**
 * Set or clear one month's target.
 *
 * A null target deletes the row rather than storing zero. Zero is a target of
 * nothing — a real, if odd, intention — whereas absent means nobody has said,
 * and the Goals page renders those two very differently.
 */
export async function saveGoal(
  clientId: string,
  metric: GoalMetric,
  month: string,
  target: number | null,
  updatedBy: string
): Promise<void> {
  if (!(await ensureTable())) {
    throw new Error("The goals table is unavailable; the target was not saved.");
  }

  if (target === null) {
    await sql(
      `DELETE FROM client_goals WHERE client_id = $1 AND metric = $2 AND month = $3`,
      [clientId, metric, month]
    );
    return;
  }

  await sql(
    `INSERT INTO client_goals (client_id, metric, month, target, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_id, metric, month) DO UPDATE SET
       target     = EXCLUDED.target,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by`,
    [clientId, metric, month, target, updatedBy]
  );
}
