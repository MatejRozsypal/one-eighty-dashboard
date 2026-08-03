"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listClientSettings = listClientSettings;
exports.getClientSettings = getClientSettings;
exports.saveClientSettings = saveClientSettings;
require("server-only");
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
const db_1 = require("@/lib/users/db");
const client_1 = require("@/lib/demo/client");
// pg returns NUMERIC as a string to avoid float precision loss.
const dec = (v) => v === null || v === "" ? null : Number(v);
function toSettings(r) {
    return {
        clientId: r.client_id,
        opexRate: dec(r.opex_rate),
        fulfilmentPerOrder: dec(r.fulfilment_per_order),
        otherCm1PerOrder: dec(r.other_cm1_per_order),
        updatedAt: r.updated_at?.toISOString() ?? null,
        updatedBy: r.updated_by,
    };
}
async function listClientSettings() {
    const rows = await (0, db_1.sql)(`SELECT * FROM client_settings ORDER BY client_id`);
    return rows.map(toSettings);
}
async function getClientSettings(clientId) {
    // The demo states its own assumptions rather than storing them, so the margin
    // stack runs all the way to EBITDA without a Postgres row — and without an
    // admin being able to edit figures that are fiction anyway.
    if ((0, client_1.isDemo)(clientId))
        return client_1.DEMO_SETTINGS;
    const rows = await (0, db_1.sql)(`SELECT * FROM client_settings WHERE client_id = $1`, [clientId]);
    return rows[0] ? toSettings(rows[0]) : null;
}
async function saveClientSettings(clientId, input, updatedBy) {
    // Nothing to store: the demo states its assumptions in code. Silently
    // accepting a save would write a row that `getClientSettings` then ignores,
    // so the admin screen would show a value that changes nothing.
    if ((0, client_1.isDemo)(clientId)) {
        throw new Error("The demo client's cost assumptions are fixed in code.");
    }
    await (0, db_1.sql)(`INSERT INTO client_settings
       (client_id, opex_rate, fulfilment_per_order, other_cm1_per_order, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_id) DO UPDATE SET
       opex_rate            = EXCLUDED.opex_rate,
       fulfilment_per_order = EXCLUDED.fulfilment_per_order,
       other_cm1_per_order  = EXCLUDED.other_cm1_per_order,
       updated_at           = NOW(),
       updated_by           = EXCLUDED.updated_by`, [
        clientId,
        input.opexRate,
        input.fulfilmentPerOrder,
        input.otherCm1PerOrder,
        updatedBy,
    ]);
}
