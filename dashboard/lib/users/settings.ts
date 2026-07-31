import "server-only";

/**
 * Per-client cost assumptions.
 *
 * These are the figures the warehouse structurally cannot produce — operating
 * expenses, fulfilment, the other CM1 costs. No connected source reports them,
 * so they are inputs, not measurements.
 *
 * They lived as constants in the app before: a hardcoded 30% OpEx rate and two
 * costs pinned at zero. That is the worst version — a guess in code reads as a
 * measurement, and nobody knows to revisit it. Stored here they are visible,
 * attributable and editable, and every consumer treats a missing value as
 * *unknown* rather than substituting a default.
 */

import { sql } from "@/lib/users/db";

export interface ClientSettings {
  clientId: string;
  /** Share of revenue, 0..1. Null when nobody has stated one. */
  opexRate: number | null;
  fulfilmentPerOrder: number | null;
  otherCm1PerOrder: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface Row extends Record<string, unknown> {
  client_id: string;
  opex_rate: string | number | null;
  fulfilment_per_order: string | number | null;
  other_cm1_per_order: string | number | null;
  updated_at: Date | null;
  updated_by: string | null;
}

// pg returns NUMERIC as a string to avoid float precision loss.
const dec = (v: string | number | null): number | null =>
  v === null || v === "" ? null : Number(v);

function toSettings(r: Row): ClientSettings {
  return {
    clientId: r.client_id,
    opexRate: dec(r.opex_rate),
    fulfilmentPerOrder: dec(r.fulfilment_per_order),
    otherCm1PerOrder: dec(r.other_cm1_per_order),
    updatedAt: r.updated_at?.toISOString() ?? null,
    updatedBy: r.updated_by,
  };
}

export async function listClientSettings(): Promise<ClientSettings[]> {
  const rows = await sql<Row>(`SELECT * FROM client_settings ORDER BY client_id`);
  return rows.map(toSettings);
}

export async function getClientSettings(
  clientId: string
): Promise<ClientSettings | null> {
  const rows = await sql<Row>(
    `SELECT * FROM client_settings WHERE client_id = $1`,
    [clientId]
  );
  return rows[0] ? toSettings(rows[0]) : null;
}

export async function saveClientSettings(
  clientId: string,
  input: {
    opexRate: number | null;
    fulfilmentPerOrder: number | null;
    otherCm1PerOrder: number | null;
  },
  updatedBy: string
): Promise<void> {
  await sql(
    `INSERT INTO client_settings
       (client_id, opex_rate, fulfilment_per_order, other_cm1_per_order, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_id) DO UPDATE SET
       opex_rate            = EXCLUDED.opex_rate,
       fulfilment_per_order = EXCLUDED.fulfilment_per_order,
       other_cm1_per_order  = EXCLUDED.other_cm1_per_order,
       updated_at           = NOW(),
       updated_by           = EXCLUDED.updated_by`,
    [
      clientId,
      input.opexRate,
      input.fulfilmentPerOrder,
      input.otherCm1PerOrder,
      updatedBy,
    ]
  );
}
