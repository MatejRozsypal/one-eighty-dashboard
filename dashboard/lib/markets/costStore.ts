import "server-only";

/**
 * Market cost cards: the owner's per-market costs beyond COGS (SPEC 3.4, F6).
 *
 * Postgres, like the Creative Engine thresholds and the client cost
 * assumptions, and for the same reason: these are inputs somebody types, not
 * measurements anything reports, and the app's BigQuery service account is
 * read-only by design. The Markets page reads them here and applies them to
 * the warehouse rows in `lib/markets/model.ts` (`marketCosts`).
 *
 * ── History ─────────────────────────────────────────────────────────────────
 * One row per client x market x effective_from. Saving a card with a new date
 * adds a row and keeps the old one, so a range before a rate change is costed
 * with the old rates; saving with the same date corrects that card in place.
 *
 * ── Why the DDL is here ─────────────────────────────────────────────────────
 * The same guard as lib/creative/store.ts: created behind its own `ensure`, so
 * a failure here leaves CM2 n/a and nothing else down. lib/users/db.ts runs its
 * schema before every query, including sign-in, which is the wrong blast radius
 * for one Settings section.
 */

import { sql } from "@/lib/users/db";
import type { CostCard } from "@/lib/markets/types";

const DDL = `
CREATE TABLE IF NOT EXISTS market_cost_cards (
  client_id           TEXT NOT NULL,
  -- ISO-2 of a sold market, or OTHER for every country pooled into Other.
  market              TEXT NOT NULL,
  effective_from      DATE NOT NULL,
  -- Every cost nullable with NO default: empty is "not stated" and shows n/a,
  -- a guessed 0 would read as a market that costs nothing to serve.
  ship_cost_per_order NUMERIC CHECK (ship_cost_per_order >= 0),
  pay_fee_pct         NUMERIC CHECK (pay_fee_pct >= 0 AND pay_fee_pct <= 1),
  cod_fee             NUMERIC CHECK (cod_fee >= 0),
  return_cost         NUMERIC CHECK (return_cost >= 0),
  fixed_monthly       NUMERIC CHECK (fixed_monthly >= 0),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          TEXT,
  PRIMARY KEY (client_id, market, effective_from)
);
`;

const globalForSchema = globalThis as unknown as { oeMarketCostSchema?: Promise<boolean> };

function ensure(): Promise<boolean> {
  if (!globalForSchema.oeMarketCostSchema) {
    globalForSchema.oeMarketCostSchema = sql(DDL)
      .then(() => true)
      .catch((error: unknown) => {
        const code = (error as { code?: string })?.code;
        // Two lambdas racing on CREATE ... IF NOT EXISTS: the loser's error is the race resolving.
        if (code === "23505" || code === "42P07" || code === "42710") return true;
        console.error("[markets] could not create market_cost_cards", error);
        globalForSchema.oeMarketCostSchema = undefined;
        return false;
      });
  }
  return globalForSchema.oeMarketCostSchema;
}

// pg returns NUMERIC as a string to avoid float precision loss.
const dec = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * Every card of a client, oldest first. Empty when there are none or the store
 * cannot be read: the page then shows CM2 n/a with the Settings reason, which
 * is the honest answer either way.
 */
export async function getMarketCostCards(clientId: string): Promise<CostCard[]> {
  try {
    if (!(await ensure())) return [];
    const rows = await sql<Record<string, unknown>>(
      // effective_from as text: a DATE parsed into a JS Date can shift a day with the server's time zone.
      `SELECT market, effective_from::text AS effective_from, ship_cost_per_order, pay_fee_pct, cod_fee,
              return_cost, fixed_monthly, updated_at, updated_by
       FROM market_cost_cards WHERE client_id = $1 ORDER BY market, effective_from`,
      [clientId]
    );
    return rows.map((r) => ({
      market: String(r.market),
      effectiveFrom: String(r.effective_from).slice(0, 10),
      shipCostPerOrder: dec(r.ship_cost_per_order),
      payFeePct: dec(r.pay_fee_pct),
      codFee: dec(r.cod_fee),
      returnCost: dec(r.return_cost),
      fixedMonthly: dec(r.fixed_monthly),
      updatedAt: (r.updated_at as Date | null)?.toISOString() ?? null,
      updatedBy: (r.updated_by as string) ?? null,
    }));
  } catch (error) {
    console.error("[markets] could not read market_cost_cards", error);
    return [];
  }
}

/** Insert a card, or correct the one with the same market and date. */
export async function saveMarketCostCard(
  clientId: string,
  card: Omit<CostCard, "updatedAt" | "updatedBy">,
  updatedBy: string
): Promise<void> {
  if (!(await ensure())) throw new Error("The cost card store is not available.");
  await sql(
    `INSERT INTO market_cost_cards
       (client_id, market, effective_from, ship_cost_per_order, pay_fee_pct, cod_fee, return_cost, fixed_monthly, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
     ON CONFLICT (client_id, market, effective_from) DO UPDATE SET
       ship_cost_per_order = EXCLUDED.ship_cost_per_order,
       pay_fee_pct         = EXCLUDED.pay_fee_pct,
       cod_fee             = EXCLUDED.cod_fee,
       return_cost         = EXCLUDED.return_cost,
       fixed_monthly       = EXCLUDED.fixed_monthly,
       updated_at          = NOW(),
       updated_by          = EXCLUDED.updated_by`,
    [
      clientId,
      card.market,
      card.effectiveFrom,
      card.shipCostPerOrder,
      card.payFeePct,
      card.codFee,
      card.returnCost,
      card.fixedMonthly,
      updatedBy,
    ]
  );
}
