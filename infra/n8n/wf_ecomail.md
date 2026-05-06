# wf_ecomail — Ecomail → BigQuery

**Source:** Ecomail (Czech email platform)
**Active for clients:** `manami` (only client with `has_ecomail=TRUE` initially)
**Cadence:** Every 6 hours (`0 */6 * * *` Europe/Prague) — campaigns; daily 02:30 — flows snapshot
**Destination:** `raw.raw_ecomail_campaigns`, `raw.raw_ecomail_automations`, `raw.raw_ecomail_subscribers`

---

## API reference
- Docs: https://ecomail.cz/api
- Auth: simple `key: <api-key>` HTTP header
- Base URL: `https://api2.ecomailapp.cz`
- Endpoints we use:
  - `GET /campaigns` — list campaigns
  - `GET /campaigns/all-stats` — aggregated stats per campaign
  - `GET /pipelines` — list automations / flows
  - `GET /pipelines/{id}/all-stats` — flow stats (cumulative)
  - `GET /lists` — subscriber lists with counts
- Rate limit: ~120 req/min

---

## Node-by-node spec

This is split into **two workflows** because campaigns refresh hourly while flows are daily snapshots:

- `wf_ecomail_campaigns` — runs every 6 hours
- `wf_ecomail_flows` — runs daily at 02:30

Common nodes are shared via the universal pattern (Runbook 04).

---

## wf_ecomail_campaigns

### Node 1 — Schedule Trigger
- **Cron:** `0 */6 * * *`
- **Timezone:** `Europe/Prague`

### Node 2 — Read clients
```sql
SELECT client_id, slug FROM `oneeighty-warehouse.ref.clients`
WHERE status='active' AND has_ecomail=TRUE
```

### Node 3 — Split In Batches (1)

### Node 4 — Get API key
- **Secret name:** `=ecomail-{{ $json.slug }}-api-key`

### Node 5 — Get region
- **Secret name:** `=ecomail-{{ $json.slug }}-region`
- (We use this in case Ecomail ever splits regions; today everyone is `eu`/`api2.ecomailapp.cz`)

### Node 6 — Pull campaigns list
- **Type:** HTTP Request
- **Method:** GET
- **URL:** `https://api2.ecomailapp.cz/campaigns`
- **Headers:** `key: {{ $node['Get API key'].json.value }}`

### Node 7 — Pull all-stats
- **Type:** HTTP Request
- **Method:** GET
- **URL:** `https://api2.ecomailapp.cz/campaigns/all-stats`
- **Headers:** `key: {{ $node['Get API key'].json.value }}`

### Node 8 — Merge campaigns + stats
- **Type:** Merge (mode: Combine, by `id`)
- Joins the campaign metadata with its stats

### Node 9 — Normalize campaigns
- **Type:** Function
- **Code:**
  ```javascript
  const clientId = $('Loop over clients').item.json.client_id;
  const ingestedAt = new Date().toISOString();
  return items.map(item => ({
    json: {
      client_id: clientId,
      ingested_at: ingestedAt,
      campaign_id: String(item.json.id),
      campaign_name: item.json.title,
      campaign_type: item.json.type,
      language: item.json.language ?? null,
      status: item.json.status,
      sent_at: item.json.sent_at ?? item.json.send_date,
      list_id: String(item.json.list_id ?? ''),
      list_name: item.json.list_name ?? null,
      recipients: parseInt(item.json.recipients_count ?? 0),
      delivered: parseInt(item.json.delivered ?? 0),
      bounces: parseInt(item.json.bounces ?? 0),
      hard_bounces: parseInt(item.json.hard_bounces ?? 0),
      soft_bounces: parseInt(item.json.soft_bounces ?? 0),
      opens: parseInt(item.json.opens ?? 0),
      unique_opens: parseInt(item.json.unique_opens ?? 0),
      open_rate: parseFloat(item.json.open_rate ?? 0),
      clicks: parseInt(item.json.clicks ?? 0),
      unique_clicks: parseInt(item.json.unique_clicks ?? 0),
      click_rate: parseFloat(item.json.click_rate ?? 0),
      unsubscribes: parseInt(item.json.unsubscribed ?? 0),
      spam_complaints: parseInt(item.json.complaints ?? 0),
      conversions: parseInt(item.json.conversions ?? 0),
      revenue: parseFloat(item.json.revenue ?? 0),
      currency: item.json.currency ?? 'CZK',
      payload_json: JSON.stringify(item.json),
    }
  }));
  ```

### Node 10 — Insert into raw_ecomail_campaigns
- **Mode:** Append (batch — free)
- **Note:** This is append-only, so you'll see multiple rows per campaign as stats refresh. The mart layer takes the latest row per `campaign_id`.

### Node 11 — Log success
- Same as `wf_shoptet` Node 18, with `workflow='wf_ecomail_campaigns'` and `source='ecomail'`

---

## wf_ecomail_flows

### Node 1 — Schedule Trigger
- **Cron:** `30 2 * * *` (daily 02:30)
- **Timezone:** `Europe/Prague`

### Node 2-5 — Same as campaigns (clients, secrets)

### Node 6 — Pull pipelines list
- **URL:** `https://api2.ecomailapp.cz/pipelines`

### Node 7 — Loop pipelines, pull all-stats per
- For each pipeline_id, GET `/pipelines/{id}/all-stats`

### Node 8 — Normalize flows
- **Code:**
  ```javascript
  const clientId = $('Loop over clients').item.json.client_id;
  const ingestedAt = new Date().toISOString();
  const snapshotDate = new Date().toISOString().split('T')[0];
  return items.map(item => ({
    json: {
      client_id: clientId,
      ingested_at: ingestedAt,
      snapshot_date: snapshotDate,
      automation_id: String(item.json.id),
      automation_name: item.json.name,
      status: item.json.status,
      metric_type: 'cumulative',  // CRITICAL: Ecomail flow stats are all-time
      emails_sent: parseInt(item.json.sent ?? 0),
      delivered: parseInt(item.json.delivered ?? 0),
      opens: parseInt(item.json.opens ?? 0),
      unique_opens: parseInt(item.json.unique_opens ?? 0),
      open_rate: parseFloat(item.json.open_rate ?? 0),
      clicks: parseInt(item.json.clicks ?? 0),
      unique_clicks: parseInt(item.json.unique_clicks ?? 0),
      click_rate: parseFloat(item.json.click_rate ?? 0),
      conversions: parseInt(item.json.conversions ?? 0),
      revenue: parseFloat(item.json.revenue ?? 0),
      currency: 'CZK',
      payload_json: JSON.stringify(item.json),
    }
  }));
  ```

### Node 9 — Insert into raw_ecomail_automations
- **Mode:** Append

### Node 10 — Pull subscriber lists
- **URL:** `https://api2.ecomailapp.cz/lists`

### Node 11 — Normalize subscribers
- Map to `raw_ecomail_subscribers` schema, set `snapshot_date` to today

### Node 12 — Insert into raw_ecomail_subscribers
- **Mode:** Append

### Node 13 — Log success
- Same pattern, `workflow='wf_ecomail_flows'`

---

## First-run backfill (campaigns only)

Ecomail's `/campaigns/all-stats` returns ALL campaigns ever sent, with cumulative stats. So a "backfill" is just one execution of `wf_ecomail_campaigns` — it pulls everything.

For flows: `wf_ecomail_flows` only ever holds **daily snapshots**, so backfill is N/A. Today is the first snapshot. Tomorrow you have two days of data. After 30 days, you can derive period stats by diffing two snapshots.

## Important — flow stats are CUMULATIVE

When the mart layer reports "Flow revenue last 30 days," it must:
- For dates **before** the first flow snapshot: use cumulative stats only (warn user that period filter doesn't apply)
- For dates **after** the first snapshot: diff the latest snapshot in the period vs the earliest

This is the gotcha called out in the master brief. The `metric_type='cumulative'` column makes it explicit.
