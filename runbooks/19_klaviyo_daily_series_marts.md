# Runbook 19 — Klaviyo daily time-series marts (date-picker-driven email dashboard)

**Status:** spec / planned. Target: rebuild the Looker Email page as daily charts driven by a
date-range control, matching Klaviyo's native dashboard (Conversion Summary, Flows Conversion,
Subscriber Growth, Campaign message performance detail).

## Core idea

Everything wired so far uses Klaviyo **values-reports** (`/api/campaign-values-reports/`,
`/api/flow-values-reports/`) → one total per timeframe, no time axis. The daily charts need
**series-reports** (`/api/campaign-series-reports/`, `/api/flow-series-reports/`) with
`interval: "daily"` → one value **per day per entity**.

Why this is the right backbone:
- A Looker date-range control just filters + sums a daily fact table. Daily grain = the control
  "just works".
- **Daily buckets are non-overlapping**, so summing across them is correct. This dissolves the
  flow double-count problem (runbook 15/16 note) that blocked automatic flow sync — no
  calendar-month gymnastics needed.
- Re-pulling a rolling window and keeping the latest snapshot per (entity, day) handles Klaviyo's
  attribution restatement (a day's revenue keeps moving for ~30–60d post-event).

## Series-reports response shape (confirm exact fields at build)

`POST /api/campaign-series-reports/` (and flow equivalent), revision `2024-10-15`:
```json
{ "data": { "type": "campaign-series-report", "attributes": {
  "statistics": ["recipients","delivered","opens_unique","clicks_unique","conversions","conversion_value", ...],
  "timeframe": { "start": "...", "end": "..." },
  "interval": "daily",
  "conversion_metric_id": "Vyfqq8"
}}}
```
Response: `data.attributes.date_times[]` = the day buckets; `data.attributes.results[]` each has
`groupings` (campaign_id / campaign_message_id / send_channel) and `statistics` where **each stat
is an array aligned to `date_times[]`**. Transform = zip `date_times[i]` with each `statistics.<stat>[i]`
→ one row per (entity, day).

> **Verify before building:** (1) daily-interval max timeframe (series endpoints cap the number of
> buckets — likely needs chunking for long backfills; a rolling 30–90d sync is fine). (2) exact
> statistic names for series vs values (values uses `opens_unique`/`clicks_unique`; confirm series
> matches). (3) whether flow-series groups by flow_message_id or flow_id only.

## New raw tables (mirror existing reports-table conventions: PARTITION BY ingested_at, CLUSTER client_id+entity)

- `raw.raw_klaviyo_campaign_series` — cols: client_id, ingested_at, ingest_source,
  metric_date (DATE), campaign_id, campaign_message_id, send_channel, + statistics
  (recipients, delivered, bounced, opens, opens_unique, clicks, clicks_unique, conversions,
  conversion_value, unsubscribes, spam_complaints), payload_json.
- `raw.raw_klaviyo_flow_series` — same with flow_id, flow_message_id.

## stg (latest snapshot per entity-day — NOT summed across windows)

```
stg_klaviyo_campaign_series:
  ROW_NUMBER() OVER (PARTITION BY client_id, campaign_id, campaign_message_id, metric_date
                     ORDER BY ingested_at DESC) = 1
  -- currency: USD for dobias (registry-driven once runbook 18 lands)
stg_klaviyo_flow_series: same with flow grain
```
No SUM across overlapping timeframes → no double count. Re-pull just refreshes each day's latest value.

## marts (daily facts — the date picker drives these)

- `mart_email_daily` — one row per (client_id, metric_date, channel ∈ {campaign, flow}).
  `SUM(conversion_value) AS revenue`, `SUM(recipients) AS emails_sent`, opens_unique, clicks_unique,
  conversions. → **Conversion Summary** (campaign vs flow daily) + emails-sent-per-day.
- `mart_email_flow_daily` — per (client_id, metric_date, flow_id, flow_name). daily revenue /
  conversions / sends / opens / clicks. → **Flows Conversion** with the flow selector.
- `mart_email_campaign_daily` (optional twin of flow_daily for per-campaign daily drill-down).
- `mart_email_campaign_message_perf` — per (campaign_id, campaign_message_id) totals:
  recipients, delivered, unique_opens, unique_clicks, conversions (unique orders), revenue, AOV
  (`average_order_value`), rev/rec (`revenue_per_recipient`). **Buildable now** from existing
  `raw_klaviyo_campaign_reports` — no new endpoint. → **Campaign message performance detail** table.

## Subscriber Growth — VALIDATED 2026-06-21, fully backfillable via segment-series

**Use `/api/segment-series-reports/` (`query_segment_series`).** Validated live: returns daily arrays
of `total_members`, `members_added`, `members_removed`, `net_members_changed` per segment, aligned to
`date_times[]` — i.e. the entire Subscriber Growth chart in ONE endpoint, and `members_removed` is
Klaviyo's own exclusions definition (no metric-soup guessing). Backfillable to **June 1 2023** (data floor).

Response shape = same as campaign/flow series: `data.attributes.results[].{groupings,statistics}` +
`date_times[]`, statistics as date-aligned arrays. **Interval caps: daily ≤ 60 days, weekly ≤ 52 weeks,
monthly ≤ 52 weeks per call** — so daily backfill = ~60-day chunks (~13 calls for 24 months).

### The catch: audience must be a SEGMENT, not a list
The "78,551 email subscribers" audience is the **list** `TuNgAg` ("(NEW) Master List - USA & Canada -
DO NOT DELETE"). `segment-series-report` **rejects list IDs** (returns empty results). Existing segments
don't match: `Ykr8TQ` "MASTER All Newsletter Subscribers (OLD)" = 42,128; `WbyHRH` "master less
suppressed" = 46,993.

**Action required (Klaviyo UI):** create a segment mirroring the master-list audience — definition
`is in list "(NEW) Master List - USA & Canada"` (optionally AND `subscribed to email marketing`). Klaviyo
segment growth reporting is retroactive, so even a new segment backfills history. After creating, verify
`total_members` on an early date ≈ the historical list size.

### Wiring (once segment exists)
- Add `ref.clients.klaviyo_subscriber_segment_id` (per client), read by the workflow (same pattern as
  `klaviyo_conversion_metric_id`).
- n8n branch: `Fetch subscriber series` (segment-series-report, rolling 60-day daily window) → Transform
  (zip date_times) → `raw_klaviyo_subscriber_daily`. Map `total_members→total_subscribers`,
  `members_added→new_subscribers`, `members_removed→exclusions`.
- Backfill runbook: 60-day daily chunks from 2023-06-01 → today.
- `mart_email_subscriber_daily` already built (total_subscribers, new_subscribers, exclusions,
  net_growth) — just needs the raw rows.

**Status:** approach fully validated and backfillable; blocked only on the user creating/identifying the
subscriber **segment** (list won't work). Cross-check: new-subs via this should match metric `QZ8MhV`
(May ≈ 657) and the UI's exclusions (May ≈ 1,031).

## n8n wiring

Add to `wf_klaviyo_to_bigquery`, same per-client loop / secrets / conversion_metric_id pattern as the
campaign-reports branch (2026-06-21). Rolling ~35-day daily window every 6h:
- `Fetch campaign series → Transform campaign series → BQ insert raw_klaviyo_campaign_series`
- `Fetch flow series → Transform flow series → BQ insert raw_klaviyo_flow_series`
- (subscriber metric-aggregates branch in a later phase)
Backfill longer history via Cloud Shell in interval-capped chunks (mirror runbooks 15/16).

## Suggested phasing

1. **Phase 1 (core of the ask):** campaign-series + flow-series → `mart_email_daily` +
   `mart_email_flow_daily`. Delivers Conversion Summary, Flows Conversion, emails-sent/day.
2. **Phase 2 (now-available quick win):** `mart_email_campaign_message_perf` from existing data →
   Campaign message performance detail table.
3. **Phase 3:** Subscriber Growth (metric-aggregates + daily subscriber snapshot).

## Acceptance

Looker Email page with a single date-range control where Conversion Summary, Flows Conversion, and
emails-sent all move together and reconcile to Klaviyo's native dashboard for the same range
(e.g., May 2026: campaigns ≈ $116.6k, flows ≈ $14.7k, total ≈ $131.3k attributed).
