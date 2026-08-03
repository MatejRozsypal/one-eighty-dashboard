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

## RESOLVED 2026-08-03 — what the cause actually was

The live workflow had **18 nodes; the repo export had 29.** Four whole branches
had never been deployed to n8n:

| branch | writes to | feeds |
|---|---|---|
| flow series | `raw_klaviyo_flow_series` | flow **volumes** |
| conv flow | `raw_klaviyo_conversion_daily` (`dim_type='flow'`) | flow **revenue** |
| conv channel | `raw_klaviyo_conversion_daily` (`dim_type='channel'`) | channel revenue |
| subscriber series | `raw_klaviyo_subscriber_daily` | subscriber growth |

So the node was never "erroring" — it was never there. The runbook-20 backfill
ran by hand, filled history to 2026-06-20, and the ongoing branch was never
added. The repo being *ahead* of production is precisely why nothing reported
it.

**Fixed via the n8n API:** flow series and both conv branches were spliced into
the existing serial chain, after `BQ: insert campaign reports` and back to
`Loop over clients`. 27 nodes now, all reachable, workflow still active. The
repo export has been overwritten with the live definition so the two cannot
drift apart again.

Two things that had to be corrected mid-fix, worth knowing:

- **Adding flow series alone would not have fixed revenue.**
  `mart_email_flow_daily` reads *revenue* from `stg_klaviyo_conversion_daily`,
  not from the flow series — the series only carries sends, opens and clicks.
  Both conv branches were needed.
- The BQ node from the export omits `authentication`, so it defaults to OAuth2
  and n8n refuses to publish. Every BigQuery node here must carry
  `authentication: "serviceAccount"` plus the `BQ Service Account` credential.

**Subscriber series was deliberately left out.** It is blocked on a Klaviyo
segment mirroring the master list that does not exist (runbook 21), so adding
it would only add a failing node.

### Double-counting: checked, not a risk

The rolling 35-day window re-fetches days already stored, and the BigQuery nodes
`insert` rather than upsert. That is safe here only because both staging views
deduplicate:

```sql
ROW_NUMBER() OVER (PARTITION BY client_id, flow_id, flow_message_id, metric_date
                   ORDER BY ingested_at DESC) = 1
```

If a future view reads `raw_klaviyo_*_series` or `raw_klaviyo_conversion_daily`
directly and simply sums, it will double-count. Read the stg views.

### Remaining gap: 2026-06-21 to 2026-06-28

The window reaches back 35 days, so the first run covers from **2026-06-29**.
Stored data ends **2026-06-20**. Seven days in late June will still be missing
and any range spanning them will understate.

The window was left at 35 days rather than widened: each run already re-inserts
roughly 7,000 rows, and widening multiplies that four times a day forever to fix
one week once. To close it, run the workflow manually from the n8n UI with the
`Decode secrets` window temporarily set to 60 days, then set it back.

## Original diagnosis — root cause in the pipeline

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
