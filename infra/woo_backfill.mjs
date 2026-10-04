// woo_backfill.mjs -- one-off WooCommerce history load into oneeighty-warehouse.raw
//
// Why this exists: wf_woocommerce holds every fetched order of a run in one n8n
// item and stops at MAX_PAGES = 200 (20,000 orders) without raising. Fine for
// Ethia (~2k orders), not for a 50k-order shop on the same box that runs every
// other client's sync. Same split as Shopify (runbook 12): history loads from
// Cloud Shell, n8n only does the incremental sync.
//
// The transform below is copied from wf_woocommerce > "Transform orders" and
// "Transform items" (2026-09-20 version) so backfilled rows are identical to
// cron rows. Deliberate deviations, all marked DEVIATION below:
//   1. pages with orderby=id, not date: ids are unique, so OFFSET paging cannot
//      skip or repeat orders that share a creation second.
//   2. LINE_META_KEEP also keeps dog_meal_type and pack_kg (RawBark meal plans,
//      not personal data). wf_woocommerce needs the same two keys, otherwise a
//      later cron re-read of a modified order drops them again.
//   3. item-level numerics rounded to 6 dp: load jobs reject NUMERIC values with
//      float noise past 9 dp; streaming inserts round silently.
//
// Usage (Cloud Shell, needs Node 18+ and access to the woocommerce-<slug>-* secrets):
//   node woo_backfill.mjs <client_id> <slug> <created_after_gmt> [timezone]
//   node woo_backfill.mjs rawbark rawbark 2022-01-01T00:00:00 Europe/Prague
// Writes <client_id>_orders.ndjson and <client_id>_items.ndjson, then:
//   bq load --source_format=NEWLINE_DELIMITED_JSON oneeighty-warehouse:raw.raw_woo_orders rawbark_orders.ndjson
//   bq load --source_format=NEWLINE_DELIMITED_JSON oneeighty-warehouse:raw.raw_woo_order_items rawbark_items.ndjson
// Re-running is safe: raw is append-only and stg keeps the newest ingested_at.

import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';

const [, , CLIENT_ID, SLUG, CREATED_AFTER, TZ = 'Europe/Prague'] = process.argv;
if (!CLIENT_ID || !SLUG || !CREATED_AFTER) {
  console.error('usage: node woo_backfill.mjs <client_id> <slug> <created_after_gmt> [timezone]');
  process.exit(1);
}

const PROJECT = 'oneeighty-warehouse';
const secret = name => execFileSync('gcloud',
  ['secrets', 'versions', 'access', 'latest', '--secret=' + name, '--project=' + PROJECT],
  { encoding: 'utf8' }).trim();

const BASE = secret('woocommerce-' + SLUG + '-base-url').replace(/\/+$/, '');
// Over HTTPS WooCommerce wants HTTP Basic Auth, not query-string keys.
const AUTH = Buffer.from(secret('woocommerce-' + SLUG + '-consumer-key') + ':'
  + secret('woocommerce-' + SLUG + '-consumer-secret')).toString('base64');

const PER_PAGE = 100;
const LIMIT_PAGES = Number(process.env.LIMIT_PAGES || 0);   // smoke test: LIMIT_PAGES=2 node woo_backfill.mjs ...
const PAGE_PAUSE = 800;
const MAX_RETRIES = 5;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Copied from wf_woocommerce > Transform orders
// ---------------------------------------------------------------------------
const INGESTED_AT = new Date().toISOString();

const clean = v => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) { out += s[i]; continue; }
    if (c < 32 || c === 127) continue;
    if (c >= 0xD800 && c <= 0xDBFF) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xDC00 && n <= 0xDFFF) { out += s[i] + s[i + 1]; i++; continue; }
      continue;
    }
    if (c >= 0xDC00 && c <= 0xDFFF) continue;
    out += s[i];
  }
  return out;
};

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
};
const sum = (arr, pick) => {
  let t = 0;
  for (const x of (arr || [])) {
    const n = Number(pick(x));
    if (Number.isFinite(n)) t += n;
  }
  return Math.round(t * 1e6) / 1e6;
};

const parseTs = v => {
  if (!v) return null;
  const raw = String(v).trim();
  if (!raw || raw.startsWith('0000') || raw.startsWith('-')) return null;
  const d = new Date(/[Zz]$/.test(raw) ? raw : raw + 'Z');
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 1990 || y > 2200) return null;
  return d.toISOString();
};
const toLocalDate = (tz, ...candidates) => {
  for (const c of candidates) {
    const iso = parseTs(c);
    if (iso) return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
  }
  return null;
};

// GDPR rule 6: meta_data is filtered through a WHITELIST, never a blacklist.
const ORDER_META_KEEP = new Set([
  '_wc_order_attribution_source_type', '_wc_order_attribution_utm_source',
  '_wc_order_attribution_utm_medium', '_wc_order_attribution_utm_campaign',
  '_wc_order_attribution_utm_content', '_wc_order_attribution_utm_id',
  '_wc_order_attribution_utm_term', '_wc_order_attribution_referrer',
  '_wc_order_attribution_device_type', '_wc_order_attribution_session_count',
  '_wc_order_attribution_session_pages',
  '_woo_pi_data',
  '_packing_box', '_packing_box_id', '_packed_by', '_packing_status',
  'tppl_api', 'tppl_package_api', 'tppl_package_status', 'tppl_package_status_id',
  'tppl_cpl_batch_state', 'tppl_package_sent',
  '_comgate_method', '_comgate_status',
  '_ethia_price_overrides_total', '_ethia_price_overrides_summary',
  '_ethia_price_overrides_sources', '_ethia_order_card',
  'is_vat_exempt', '_wpify_vat_exempt_reason'
]);
const LINE_META_KEEP = new Set([
  '_woo_cost_price', '_reduced_stock',
  '_ethia_price_overrides', '_ethia_price_override_reason',
  '_ethia_upsell_original_price', '_ethia_upsell_discount_percent', '_ethia_upsell_offer_type',
  'dog_meal_type', 'pack_kg'   // DEVIATION 2
]);

const mv = (arr, key) => {
  const m = (arr || []).find(x => x.key === key);
  return m ? m.value : null;
};
const keepMeta = (arr, set) => (arr || []).filter(m => set.has(m.key))
  .map(m => ({ key: clean(m.key), value: typeof m.value === 'string' ? clean(m.value) : m.value }));

const REVENUE_STATUSES = new Set(['processing', 'completed', 'on-hold']);
const MAX_PAYLOAD = 800000;

// Returns the raw_woo_orders row, or null for a dateless non-revenue order.
function transformOrder(o) {
  const orderDate = toLocalDate(TZ, o.date_created_gmt, o.date_created, o.date_paid_gmt);
  if (!orderDate) {
    if (REVENUE_STATUSES.has(o.status)) {
      throw new Error('Order ' + o.id + ' has status "' + o.status + '" but no usable date. '
        + 'Refusing to drop an order that counts as revenue.');
    }
    return null;
  }

  const lines = o.line_items || [];
  const costs = lines.map(li => {
    const c = mv(li.meta_data, '_woo_cost_price');
    if (c === null || c === '') return null;
    const unit = Number(c), qty = Number(li.quantity || 0);
    return (Number.isFinite(unit) && Number.isFinite(qty)) ? unit * qty : null;
  });
  const hasImprint = lines.length > 0 && costs.every(c => c !== null);

  const fees = o.fee_lines || [];
  const codFee = fees.find(f => /dob[ií]rk|cash on delivery/i.test(f.name || ''));

  const basePayload = {
    id: o.id, number: clean(o.number), status: clean(o.status), currency: clean(o.currency),
    prices_include_tax: o.prices_include_tax,
    date_created_gmt: parseTs(o.date_created_gmt), date_modified_gmt: parseTs(o.date_modified_gmt),
    date_paid_gmt: parseTs(o.date_paid_gmt), date_completed_gmt: parseTs(o.date_completed_gmt),
    discount_total: o.discount_total, discount_tax: o.discount_tax,
    shipping_total: o.shipping_total, shipping_tax: o.shipping_tax,
    cart_tax: o.cart_tax, total: o.total, total_tax: o.total_tax,
    customer_id: o.customer_id, created_via: clean(o.created_via),
    payment_method: clean(o.payment_method), payment_method_title: clean(o.payment_method_title),
    billing: { country: clean(o.billing?.country), city: clean(o.billing?.city), state: clean(o.billing?.state) },
    line_items: lines.map(li => ({
      id: li.id, product_id: li.product_id, variation_id: li.variation_id,
      sku: clean(li.sku), name: clean(li.name), quantity: li.quantity,
      subtotal: li.subtotal, subtotal_tax: li.subtotal_tax,
      total: li.total, total_tax: li.total_tax,
      meta_data: keepMeta(li.meta_data, LINE_META_KEEP)
    })),
    shipping_lines: (o.shipping_lines || []).map(s => ({ method_id: clean(s.method_id), method_title: clean(s.method_title), total: s.total, total_tax: s.total_tax })),
    fee_lines: fees.map(f => ({ name: clean(f.name), total: f.total, total_tax: f.total_tax })),
    coupon_lines: (o.coupon_lines || []).map(c => ({ code: clean(c.code), discount: c.discount })),
    refunds: (o.refunds || []).map(r => ({ id: r.id, total: r.total })),
    tax_lines: (o.tax_lines || []).map(t => ({ rate_percent: t.rate_percent, tax_total: t.tax_total, shipping_tax_total: t.shipping_tax_total })),
    meta_data: keepMeta(o.meta_data, ORDER_META_KEEP)
  };

  let payload = JSON.stringify(basePayload);
  if (payload.length > MAX_PAYLOAD) {
    basePayload.meta_data = basePayload.meta_data.filter(m => m.key !== '_woo_pi_data');
    basePayload._truncated = 'dropped _woo_pi_data';
    payload = JSON.stringify(basePayload);
  }
  if (payload.length > MAX_PAYLOAD) {
    payload = JSON.stringify({ id: o.id, _truncated: 'payload exceeded ' + MAX_PAYLOAD + ' bytes' });
  }

  return {
    client_id: CLIENT_ID,
    ingested_at: INGESTED_AT,
    ingest_source: 'backfill',

    order_id: String(o.id),
    order_number: clean(o.number) ?? '',
    status: clean(o.status) ?? '',
    currency: clean(o.currency) ?? '',
    prices_include_tax: Boolean(o.prices_include_tax),
    order_date: orderDate,

    date_created_gmt: parseTs(o.date_created_gmt),
    date_modified_gmt: parseTs(o.date_modified_gmt),
    date_paid_gmt: parseTs(o.date_paid_gmt),
    date_completed_gmt: parseTs(o.date_completed_gmt),

    total: num(o.total),
    total_tax: num(o.total_tax),
    subtotal_ex_tax: sum(lines, li => li.total),
    shipping_total: num(o.shipping_total),
    shipping_tax: num(o.shipping_tax),
    discount_total: num(o.discount_total),
    discount_tax: num(o.discount_tax),
    fees_total: sum(fees, f => f.total),
    cod_fee: codFee ? num(codFee.total) : null,
    refunds_total: sum(o.refunds, r => Math.abs(Number(r.total || 0))),

    payment_method: clean(o.payment_method) ?? '',
    shipping_method: clean((o.shipping_lines || [])[0]?.method_id) ?? '',
    customer_id: String(o.customer_id ?? ''),
    customer_email: (clean(o.billing?.email) ?? '').toLowerCase().trim(),
    billing_country: clean(o.billing?.country) ?? '',
    billing_city: clean(o.billing?.city) ?? '',
    created_via: clean(o.created_via) ?? '',
    coupon_codes: JSON.stringify((o.coupon_lines || []).map(c => clean(c.code))),

    attribution_source_type: clean(mv(o.meta_data, '_wc_order_attribution_source_type')),
    utm_source: clean(mv(o.meta_data, '_wc_order_attribution_utm_source')),
    utm_medium: clean(mv(o.meta_data, '_wc_order_attribution_utm_medium')),
    utm_campaign: clean(mv(o.meta_data, '_wc_order_attribution_utm_campaign')),
    utm_content: clean(mv(o.meta_data, '_wc_order_attribution_utm_content')),

    cogs_total: hasImprint ? Math.round(costs.reduce((s, c) => s + c, 0) * 1e6) / 1e6 : null,
    packaging_cost: null,
    shipping_cost: null,
    gateway_fee: null,
    has_cost_imprint: hasImprint,

    packing_box_id: clean(mv(o.meta_data, '_packing_box_id')),
    carrier: clean((o.shipping_lines || [])[0]?.method_id) ?? '',
    carrier_status_code: clean(mv(o.meta_data, 'tppl_package_status_id')),

    payload_json: payload
  };
}

// ---------------------------------------------------------------------------
// Copied from wf_woocommerce > Transform items (re-reads the cleaned order
// payload, so a line's order_date and client_id can never disagree with its order)
// ---------------------------------------------------------------------------
const r6 = v => (v === null || !Number.isFinite(v)) ? null : Math.round(v * 1e6) / 1e6;   // DEVIATION 3

function transformItems(o) {
  const payload = JSON.parse(o.payload_json);
  return (payload.line_items || []).map(li => {
    const costMeta = (li.meta_data || []).find(m => m.key === '_woo_cost_price');
    const unitCost = costMeta && costMeta.value !== '' ? Number(costMeta.value) : null;
    const qty = Number(li.quantity || 0);
    return {
      client_id: o.client_id,
      ingested_at: o.ingested_at,
      ingest_source: o.ingest_source,
      order_id: o.order_id,
      order_date: o.order_date,
      line_item_id: String(li.id),
      product_id: String(li.product_id ?? ''),
      variation_id: String(li.variation_id ?? ''),
      sku: li.sku ?? '',
      name: li.name ?? '',
      quantity: qty,
      subtotal: li.subtotal === undefined ? null : r6(Number(li.subtotal)),
      subtotal_tax: li.subtotal_tax === undefined ? null : r6(Number(li.subtotal_tax)),
      total: li.total === undefined ? null : r6(Number(li.total)),
      total_tax: li.total_tax === undefined ? null : r6(Number(li.total_tax)),
      unit_cost: unitCost === null ? null : r6(unitCost),
      line_cost: unitCost === null ? null : r6(unitCost * qty),
      payload_json: JSON.stringify(li)
    };
  });
}

// ---------------------------------------------------------------------------
// Fetch loop
// ---------------------------------------------------------------------------
const ordersFile = CLIENT_ID + '_orders.ndjson';
const itemsFile = CLIENT_ID + '_items.ndjson';
writeFileSync(ordersFile, '');
writeFileSync(itemsFile, '');

const seen = new Set();
const statusCounts = {};
let reportedTotal = null, page = 1, orderRows = 0, itemRows = 0, skipped = 0, withImprint = 0;
let minDate = null, maxDate = null;

while (true) {
  const url = BASE + '/wp-json/wc/v3/orders'
    + '?after=' + encodeURIComponent(CREATED_AFTER)
    + '&dates_are_gmt=true&status=any&orderby=id&order=asc'   // DEVIATION 1
    + '&per_page=' + PER_PAGE + '&page=' + page;

  let res = null, attempt = 0;
  while (true) {
    try {
      res = await fetch(url, {
        headers: { Authorization: 'Basic ' + AUTH, Accept: 'application/json' },
        signal: AbortSignal.timeout(90000)
      });
    } catch (e) {
      res = null;
    }
    if (res && res.status !== 429 && res.status < 500) break;
    attempt++;
    if (attempt > MAX_RETRIES) {
      throw new Error('page ' + page + ': gave up after ' + MAX_RETRIES + ' retries (last: '
        + (res ? 'HTTP ' + res.status : 'network error or timeout') + ')');
    }
    await sleep(2000 * Math.pow(2, attempt - 1));
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error('page ' + page + ': HTTP ' + res.status + ' ' + text.slice(0, 300));
  }
  if (reportedTotal === null) reportedTotal = Number(res.headers.get('x-wp-total'));

  const body = await res.json();
  if (!Array.isArray(body)) throw new Error('page ' + page + ': unexpected body ' + JSON.stringify(body).slice(0, 300));

  let oChunk = '', iChunk = '';
  for (const o of body) {
    if (!o || !o.id || seen.has(o.id)) continue;
    seen.add(o.id);
    const row = transformOrder(o);
    if (!row) { skipped++; continue; }
    oChunk += JSON.stringify(row) + '\n';
    orderRows++;
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    if (row.has_cost_imprint) withImprint++;
    if (!minDate || row.order_date < minDate) minDate = row.order_date;
    if (!maxDate || row.order_date > maxDate) maxDate = row.order_date;
    for (const it of transformItems(row)) { iChunk += JSON.stringify(it) + '\n'; itemRows++; }
  }
  appendFileSync(ordersFile, oChunk);
  appendFileSync(itemsFile, iChunk);

  const pages = reportedTotal ? Math.ceil(reportedTotal / PER_PAGE) : '?';
  process.stdout.write('\rpage ' + page + '/' + pages + '   orders ' + seen.size + '/' + reportedTotal + '   ');

  if (body.length < PER_PAGE) break;
  if (LIMIT_PAGES && page >= LIMIT_PAGES) break;
  page++;
  await sleep(PAGE_PAUSE);
}

console.log('\n');
console.log('reported by WooCommerce (x-wp-total): ' + reportedTotal);
console.log('unique orders fetched:                ' + seen.size);
console.log('order rows written:                   ' + orderRows + '  -> ' + ordersFile);
console.log('item rows written:                    ' + itemRows + '  -> ' + itemsFile);
console.log('skipped (dateless, non-revenue):      ' + skipped);
console.log('order_date range:                     ' + minDate + ' .. ' + maxDate);
console.log('orders with cost imprint:             ' + withImprint);
console.log('by status:                            ' + JSON.stringify(statusCounts));
if (LIMIT_PAGES) {
  console.log('\nSmoke test (LIMIT_PAGES=' + LIMIT_PAGES + '): count check skipped.');
} else if (seen.size !== reportedTotal) {
  console.log('\nWARNING: fetched count differs from x-wp-total. Orders created during the run can '
    + 'explain a small positive difference; anything else means pages were missed. Do not load yet.');
  process.exitCode = 2;
}
