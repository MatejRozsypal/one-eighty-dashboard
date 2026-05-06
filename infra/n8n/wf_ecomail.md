# wf_ecomail — Ecomail → BigQuery (Manami)

**Source:** Ecomail (Czech email platform)
**Active for clients:** `manami` only (Dr. Dobias uses Klaviyo)
**Cadence:** Every 6 hours (`0 */6 * * *` Europe/Prague) — single workflow handles all three branches
**Destination:** `raw.raw_ecomail_campaigns`, `raw.raw_ecomail_automations`, `raw.raw_ecomail_lists`

This spec is derived from your existing **Ecomail → Google Sheets** n8n workflow. The structure
below is what to build/clone for the BigQuery version. Field names match Ecomail's actual API
responses (which differ from typical "marketing-friendly" names — see the Real-API quirks section).

---

## Architecture

Single workflow, one cron trigger, three parallel branches:

```
                    ┌──► GET /campaigns/all-stats  ──► Transform campaigns ──► BQ Insert (raw_ecomail_campaigns)
                    │
Every 6 hours ──────┼──► GET /pipelines  ──► Extract pipeline IDs ──► (loop) GET /pipelines/{id}/stats
                    │                                                        ──► Transform stats
                    │                                                        ──► Merge w/ pipeline meta
                    │                                                        ──► Filter (drop empty pipeline_id)
                    │                                                        ──► BQ Insert (raw_ecomail_automations)
                    │
                    └──► GET /lists  ──► Extract list IDs ──► (loop) GET /lists/{id} ──► Transform snapshots
                                                                                       ──► BQ Insert (raw_ecomail_lists)
```

This mirrors the Sheets workflow with two fixes:
1. The lists branch is wired to the cron (was orphaned in the Sheets version).
2. Each transform now injects `client_id`, `ingested_at`, `payload_json` so rows land in BQ-ready shape.

---

## API reference

- Docs: https://ecomail.cz/api
- Auth: `key: <api-key>` HTTP header (your existing `Ecomail` credential in n8n is correct)
- Base URL: `https://api2.ecomailapp.cz`
- Endpoints used (all GET):
  - `/campaigns/all-stats/` — returns `{ stats: { <campaign_id>: { ... } } }` (object keyed by ID — NOT array)
  - `/pipelines` — array of pipelines `{ id, list_id, name, created_at, updated_at, ... }`
  - `/pipelines/{id}/stats` — single object with cumulative stats (NOT `/all-stats` — that 404s)
  - `/lists` — array `{ id, name, active_subscribers, settings: {currency, locale}, created, ... }`
  - `/lists/{id}` — `{ list: {...}, subscribers: { subscribed, unsubscribed, hard_bounced, complained, unconfirmed, unknown } }`
- Rate limit: ~120 req/min — generous

---

## Real-API quirks (don't forget these)

1. **`sent_at` is a 14-digit string `YYYYMMDDHHMMSS`** — not ISO. Parse with the helper below.
2. **`/campaigns/all-stats/` returns an OBJECT** keyed by campaign_id, not an array. The transform uses `Object.entries(stats)`.
3. **`/pipelines/{id}/stats`** returns the stats either at top level OR nested under `.stats` depending on plan/account. The Sheets transform handles both: `const s = item.json.stats ?? item.json;` — keep this.
4. Some pipeline rows have empty `pipeline_id` after the merge. The Sheets workflow filters them with a Filter node — keep that.
5. **Currency** is per-list, not per-campaign. We store currency on `raw_ecomail_lists` and the mart layer joins back to campaigns by list_id when it needs CZK.
6. Both campaigns and pipelines stats are **CUMULATIVE all-time** numbers. Append-only into raw, with `metric_type='cumulative'` tagged on automations rows. Period stats are derived in stg/mart by diffing snapshots.

---

## Build sequence (clone-from-Sheets approach)

1. In n8n, **duplicate** "Ecomail → Google Sheets (Automations)" → rename to `wf_ecomail_to_bigquery`.
2. **Delete** these dead/orphaned nodes from the duplicate:
   - `Transform lists` (terminates in `[]`)
   - `GET lists1` (orphaned; was a single-list dev artifact)
3. **Wire** `Every 6 hours` → `GET lists` (in addition to its existing wires to `GET campaigns/all-stats` and `GET pipelines`).
4. **Wire** `GET lists` → `Extract list IDs` (existing node, currently fed by `GET lists2` — replace that wiring).
5. **Delete** `GET lists2` (now redundant — `GET lists` feeds the chain directly).
6. Replace each of the **three Sheets nodes** with a **BigQuery → Insert** node (details below).
7. Replace each of the **three transform nodes** with the updated transform code below (adds `client_id`, `ingested_at`, `payload_json`).
8. Save, do a **manual Execute Workflow** for backfill, verify in BQ, then **Activate**.

---

## Transform code (drop-in replacements)

### Transform campaigns
Replaces the existing `Transform campaigns` node body. Same parsing logic + injects BQ audit fields.

```javascript
const stats = $input.first().json.stats;
const CLIENT_ID = 'manami';
const INGESTED_AT = new Date().toISOString();

function parseEcomailDate(raw) {
  if (!raw) return null;
  const s = String(raw);
  if (s.length === 14) {
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}Z`;
  }
  return s;
}

const num = v => (v === null || v === undefined || v === '' ? 0 : Number(v));

return Object.entries(stats || {}).map(([campaignId, data]) => {
  const row = {
    campaign_id:       String(campaignId),
    title:             data.title ?? '',
    sent_at:           parseEcomailDate(data.sent_at),
    inject:            num(data.inject),
    delivery:          num(data.delivery),
    delivery_rate:     num(data.delivery_rate),
    open:              num(data.open),
    total_open:        num(data.total_open),
    open_rate:         num(data.open_rate),
    click:             num(data.click),
    total_click:       num(data.total_click),
    click_rate:        num(data.click_rate),
    bounce:            num(data.bounce),
    bounce_rate:       num(data.bounce_rate),
    spam:              num(data.spam),
    spam_rate:         num(data.spam_rate),
    unsub:             num(data.unsub),
    unsub_rate:        num(data.unsub_rate),
    conversions:       num(data.conversions),
    conversions_value: num(data.conversions_value),
    currency:          'CZK',  // Manami's only Ecomail list is CZK; revisit when multi-list
  };
  return {
    json: {
      client_id:    CLIENT_ID,
      ingested_at:  INGESTED_AT,
      payload_json: JSON.stringify(data),
      ...row,
    }
  };
});
```

### Transform pipeline stats
Replaces `Transform pipeline stats`. The merge with pipeline metadata happens downstream
in `Merge pipeline info + stats` — keep that node, but update its code (next block).

```javascript
const items = $input.all();
const num = v => (v === null || v === undefined || v === '' ? 0 : Number(v));

return items.map(item => {
  const s = item.json.stats ?? item.json;
  return {
    json: {
      pipeline_id:         String(s.pipeline_id ?? ''),
      triggered:           num(s.triggered),
      active:              num(s.active),
      ended:               num(s.ended),
      send:                num(s.send),
      inject:              num(s.inject),
      open:                num(s.open),
      total_open:          num(s.total_open),
      open_rate:           num(s.open_rate),
      click:               num(s.click),
      total_click:         num(s.total_click),
      click_rate:          num(s.click_rate),
      ctr:                 num(s.ctr),
      bounce:              num(s.bounce),
      bounce_rate:         num(s.bounce_rate),
      soft_bounce:         num(s.soft_bounce),
      hard_bounce:         num(s.hard_bounce),
      spam:                num(s.spam),
      unsub:               num(s.unsub),
      delivery_rate:       num(s.delivery_rate),
      conversions:         num(s.conversions),
      conversions_value:   num(s.conversions_value),
      conversions_average: num(s.conversions_average),
      conversionrate:      num(s.conversionrate),
    }
  };
});
```

### Merge pipeline info + stats
Replaces the existing merge node (`runOnceForEachItem`). Adds `client_id`, `ingested_at`,
`snapshot_date`, `metric_type`, `payload_json`.

```javascript
// runOnceForEachItem
const CLIENT_ID = 'manami';
const INGESTED_AT = new Date().toISOString();
const SNAPSHOT_DATE = INGESTED_AT.slice(0, 10);

const statsItem = $input.item.json;
const pipelineId = String(statsItem.pipeline_id ?? '');

const allPipelineItems = $('Extract pipeline IDs').all();
const pipelineInfo = allPipelineItems.find(
  i => String(i.json.pipeline_id) === pipelineId
)?.json ?? {};

const merged = {
  pipeline_id:         pipelineId,
  list_id:             pipelineInfo.list_id ?? '',
  name:                pipelineInfo.name ?? '',
  created_at:          pipelineInfo.created_at || null,
  updated_at:          pipelineInfo.updated_at || null,
  metric_type:         'cumulative',
  triggered:           statsItem.triggered ?? 0,
  active:              statsItem.active ?? 0,
  ended:               statsItem.ended ?? 0,
  send:                statsItem.send ?? 0,
  inject:              statsItem.inject ?? 0,
  open:                statsItem.open ?? 0,
  total_open:          statsItem.total_open ?? 0,
  open_rate:           statsItem.open_rate ?? 0,
  click:               statsItem.click ?? 0,
  total_click:         statsItem.total_click ?? 0,
  click_rate:          statsItem.click_rate ?? 0,
  ctr:                 statsItem.ctr ?? 0,
  bounce:              statsItem.bounce ?? 0,
  bounce_rate:         statsItem.bounce_rate ?? 0,
  soft_bounce:         statsItem.soft_bounce ?? 0,
  hard_bounce:         statsItem.hard_bounce ?? 0,
  spam:                statsItem.spam ?? 0,
  unsub:               statsItem.unsub ?? 0,
  delivery_rate:       statsItem.delivery_rate ?? 0,
  conversions:         statsItem.conversions ?? 0,
  conversions_value:   statsItem.conversions_value ?? 0,
  conversions_average: statsItem.conversions_average ?? 0,
  conversionrate:      statsItem.conversionrate ?? 0,
};

return {
  client_id:     CLIENT_ID,
  ingested_at:   INGESTED_AT,
  snapshot_date: SNAPSHOT_DATE,
  ...merged,
  payload_json:  JSON.stringify({ pipeline: pipelineInfo, stats: statsItem }),
};
```

The `Filter` node downstream stays — drops items with empty `pipeline_id`.

### Transform snapshots (lists)
Replaces the existing `Transform snapshots` body. Maps `/lists/{id}` response to BQ row.

```javascript
const CLIENT_ID = 'manami';
const INGESTED_AT = new Date().toISOString();
const SNAPSHOT_DATE = INGESTED_AT.slice(0, 10);

return $input.all().map(item => {
  const d    = item.json.list ?? {};
  const subs = item.json.subscribers ?? {};

  const row = {
    list_id:            String(d.id ?? ''),
    list_name:          d.name ?? '',
    active_subscribers: Number(d.active_subscribers ?? 0),
    subscribed:         Number(subs.subscribed ?? 0),
    unsubscribed:       Number(subs.unsubscribed ?? 0),
    hard_bounced:       Number(subs.hard_bounced ?? 0),
    soft_bounced:       Number(subs.soft_bounced ?? 0),
    complained:         Number(subs.complained ?? 0),
    unconfirmed:        Number(subs.unconfirmed ?? 0),
    unknown:            Number(subs.unknown ?? 0),
    currency:           d.settings?.currency ?? '',
    locale:             d.settings?.locale ?? '',
    created:            d.created || null,
  };

  return {
    json: {
      client_id:     CLIENT_ID,
      ingested_at:   INGESTED_AT,
      snapshot_date: SNAPSHOT_DATE,
      ...row,
      payload_json:  JSON.stringify(item.json),
    }
  };
});
```

---

## BigQuery Insert nodes (3 of them)

Each replaces the corresponding `Sheets: upsert ...` node. Same pattern for all three:

- **Type:** Google BigQuery → Insert (NOT Stream — use load jobs, free tier)
- **Credential:** `BQ Service Account` (must be wired to `sa-n8n-writer-key`)
- **Project:** `oneeighty-warehouse`
- **Dataset:** `raw`
- **Table:** the matching one (`raw_ecomail_campaigns`, `raw_ecomail_automations`, `raw_ecomail_lists`)
- **Mode:** **Map Automatically** ← critical, manual mapping was the Shoptet bug
- **Append**, batch load

---

## First run (backfill)

- [ ] Schema reset: in BigQuery Console, run `infra/bigquery/005a_drop_raw_ecomail.sql` then `infra/bigquery/005_create_raw_ecomail.sql`. **Verify the empty-tables check inside `005a_` first.**
- [ ] Build/clone the workflow per "Build sequence" above. Leave it **inactive**.
- [ ] Click **Execute Workflow** manually. Each branch fires once:
  - Campaigns: 1 API call → N rows (one per historical campaign)
  - Pipelines: 1 list call + N detail calls → N rows
  - Lists: 1 list call + N detail calls → N rows
- [ ] Verify (mind the partition filter):
  ```sql
  SELECT 'campaigns' AS t, COUNT(*) AS rows, COUNT(DISTINCT campaign_id) AS distinct_ids
  FROM `oneeighty-warehouse.raw.raw_ecomail_campaigns`
  WHERE DATE(sent_at) BETWEEN '2023-01-01' AND CURRENT_DATE()
  UNION ALL
  SELECT 'automations', COUNT(*), COUNT(DISTINCT pipeline_id)
  FROM `oneeighty-warehouse.raw.raw_ecomail_automations`
  WHERE snapshot_date = CURRENT_DATE()
  UNION ALL
  SELECT 'lists', COUNT(*), COUNT(DISTINCT list_id)
  FROM `oneeighty-warehouse.raw.raw_ecomail_lists`
  WHERE snapshot_date = CURRENT_DATE();
  ```
- [ ] **Activate** the workflow.

---

## Validation against Ecomail UI

Pick a recent campaign you can find in the Ecomail UI; grab its `campaign_id` from the URL.

```sql
SELECT
  campaign_name := title,
  sent_at,
  inject AS sent,
  delivery,
  open AS unique_opens,
  total_open AS total_opens,
  click AS unique_clicks,
  total_click AS total_clicks,
  conversions,
  conversions_value AS revenue
FROM `oneeighty-warehouse.raw.raw_ecomail_campaigns`
WHERE client_id='manami'
  AND DATE(sent_at) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND CURRENT_DATE()
  AND campaign_id='<ID_FROM_URL>'
ORDER BY ingested_at DESC
LIMIT 1;
```

Acceptable variance: **0** for sent / delivery / opens / clicks; small variance possible on revenue if Ecomail's attribution window changed between runs (rare, but flag if you see it).
