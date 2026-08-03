# Runbook 25 — The Klaviyo flow series stopped, and flow revenue was 13× wrong

## What was wrong

The Email page reported **$253k of flow revenue for 4 Jul – 2 Aug 2026** beside
$76k of campaign revenue. Checked against Klaviyo's own flow-values report for
those exact dates, the true figure is **$19.2k**. The dashboard was over by 13×
and had the ranking backwards — it implied flows earn 3× what campaigns do,
when they earn about a quarter.

Three faults compounded:

1. **Wrong grain.** `getFlows()` took no date range and read
   `mart_email_flow_perf`, which holds each flow's totals *since it was switched
   on*. A two-year lifetime total sat in a card next to a 30-day campaign
   figure.
2. **Mixed as-of dates.** Rows carried snapshot dates of both 2026-06-12 and
   2026-08-03. Summing totals captured at different moments is not a total of
   anything.
3. **Dead flows counted.** The two largest rows were `manual` and `draft`
   status, snapshotted 2026-06-12 — about **$101k of the $253k came from flows
   that are not running.**

The page even carried a note claiming "Klaviyo reports a flow's totals since it
was switched on, so there is no period to filter to". That is untrue.
`flow-series-reports` and `flow-values-reports` are both timeframe-scoped, and
`mart_email_flow_daily` already exists to hold the former.

## Root cause in the pipeline

`wf_klaviyo_to_bigquery` has two flow branches. Freshness for `dobias`:

| raw table | grain | last data | still writing |
|---|---|---|---|
| `raw_klaviyo_flows` | lifetime snapshot | 2026-08-03 | **yes** |
| `raw_klaviyo_flow_series` | daily | **2026-06-21** | **no** |
| `raw_klaviyo_flow_reports` | timeframe | 2026-05-22 | no |
| `raw_klaviyo_campaign_series` | daily | — | **never wrote a row** |

The `Fetch flow series` node is *enabled* in the repo export, yet has produced
nothing since 21 June while the snapshot node next to it runs every six hours.
So either the live workflow differs from the export, or the node errors and the
run continues past it.

**Diagnosis, in n8n:** open `wf_klaviyo_to_bigquery` → Executions → find a run
after 21 June → inspect `Fetch flow series`. Likely candidates, in order:

1. The node is disabled in the live workflow but not in the export.
2. Klaviyo returns 400 for the requested timeframe — `flow-series-reports`
   rejects windows longer than a year and requires an interval matching the
   window.
3. The API revision pinned in the header (`2024-10-15`) no longer accepts the
   request shape for this endpoint.

The fix belongs in the workflow, not the marts: the mart is correct, it is
simply not being fed.

## Also broken, same family

`raw_klaviyo_campaign_series` has **never** received a row. Campaign figures
currently come from `mart_email_campaign_message_perf`, which is per-send and
therefore range-filterable, so nothing on screen is wrong today — but the daily
campaign series is dead code until that node is fixed too.

## What the dashboard does now

`getFlows(clientId, currency, range)` reads `mart_email_flow_daily` for the
selected range. When the series does not reach the range, it returns **no
figures** and the page says so, naming the last day it holds.

That is deliberate. Falling back to the lifetime snapshot is the original bug;
showing zero would claim the flows earned nothing. "We cannot answer that yet"
is the only honest third option.

## Verification

Once the node is fixed, reconcile against Klaviyo before trusting the page. For
a window the series already covers, this reconciled to 3%:

```sql
SELECT ROUND(SUM(revenue)) AS revenue, SUM(conversions) AS conversions
FROM `oneeighty-warehouse.mart.mart_email_flow_daily`
WHERE client_id='dobias' AND currency='USD'
  AND metric_date BETWEEN '2026-05-01' AND '2026-05-31';
-- warehouse 15,159 · Klaviyo flow-values report 14,711 · +3.0%
```

The residual few percent is Klaviyo's conversion-attribution tail still settling
on recent days. Treat anything beyond ~5% as a real discrepancy.

## Backfill

After the node works, the gap from 2026-06-21 to today has to be filled —
`flow-series-reports` accepts an explicit timeframe, so a manual run per month
of the gap is enough. Runbook 20 documents the original backfill shape.
