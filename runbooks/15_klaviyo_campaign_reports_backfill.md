# Runbook 15 — Klaviyo Campaign Reports Backfill

One-time pull of Klaviyo campaign performance metrics (delivered, opens, clicks, conversions, revenue) for 24 months of history. The default `/api/campaigns/` endpoint returns metadata only — performance stats live behind a separate `/api/campaign-values-reports/` endpoint that requires explicit calls per timeframe and conversion metric.

This runbook does the historical backfill. The n8n workflow change for ongoing daily sync is a separate task (see PROJECT_LOG amendment 11 follow-up).

## Prerequisites

- Cloud Shell access in GCP project `oneeighty-warehouse`
- Secret `klaviyo-dobias-api-key` populated in Secret Manager
- BQ table `raw.raw_klaviyo_campaign_reports` exists (created via 007b DDL, or inline)
- Klaviyo's Shopify-integration "Placed Order" metric ID:
  - Dobias: `Vyfqq8`
  - Find for new clients: GET `/api/metrics/?filter=equals(name,"Placed Order")` and pick the one with `integration.name == "Shopify"`

## Key API constraints

- Klaviyo caps a single report to **1 year max timeframe**. For 24 months: split into 2 calls.
- Valid statistics use Klaviyo's naming (e.g., `bounced` not `bounces`). Full list per API docs.
- Response shape: `{data: {attributes: {results: [{groupings, statistics}, ...]}}}`. Single object, not array.
- The `results` array includes ALL send channels (email + SMS + push). Filter to `send_channel='email'` downstream in stg/mart if needed.

## Procedure

Run all of this as one block in Cloud Shell. Variables are re-pulled inside the block (Cloud Shell session volatility — see runbook 12 §6.7).

```bash
KLAVIYO_KEY=$(gcloud secrets versions access latest --secret=klaviyo-dobias-api-key --project=oneeighty-warehouse)
mkdir -p /tmp/klaviyo-backfill && cd /tmp/klaviyo-backfill

# Two 12-month windows for 24 months total
for i in 0 1; do
  if [ $i -eq 0 ]; then
    START="2024-05-23T00:00:00+00:00"; END="2025-05-22T23:59:59+00:00"
  else
    START="2025-05-23T00:00:00+00:00"; END="2026-05-23T00:00:00+00:00"
  fi
  echo "Period $i: $START → $END"
  curl -s -X POST "https://a.klaviyo.com/api/campaign-values-reports/" \
    -H "Authorization: Klaviyo-API-Key ${KLAVIYO_KEY}" \
    -H "revision: 2024-10-15" \
    -H "accept: application/vnd.api+json" \
    -H "content-type: application/vnd.api+json" \
    -d "{
      \"data\": {
        \"type\": \"campaign-values-report\",
        \"attributes\": {
          \"statistics\": [\"recipients\",\"delivered\",\"bounced\",\"opens\",\"opens_unique\",\"clicks\",\"clicks_unique\",\"conversions\",\"conversion_value\",\"unsubscribes\",\"spam_complaints\",\"delivery_rate\",\"open_rate\",\"click_rate\",\"conversion_rate\",\"revenue_per_recipient\",\"average_order_value\"],
          \"timeframe\": {\"start\":\"${START}\",\"end\":\"${END}\"},
          \"conversion_metric_id\": \"Vyfqq8\"
        }
      }
    }" > period_${i}.json
  echo "  → $(jq '.data.attributes.results | length' period_${i}.json) campaigns"
done

# Transform JSON → NDJSON for bq load
cat > transform.py << 'PYEOF'
import json, sys
from datetime import datetime, timezone

now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
client_id, start_date, end_date, ingest_source, input_file = sys.argv[1:6]

with open(input_file) as f:
    data = json.load(f)

for r in data.get('data', {}).get('attributes', {}).get('results', []):
    g = r.get('groupings') or {}
    s = r.get('statistics') or {}
    if not g.get('campaign_id'):
        continue
    print(json.dumps({
        'client_id': client_id,
        'ingested_at': now,
        'ingest_source': ingest_source,
        'report_timeframe_start': start_date[:10],
        'report_timeframe_end': end_date[:10],
        'campaign_id': g.get('campaign_id'),
        'campaign_message_id': g.get('campaign_message_id'),
        'send_channel': g.get('send_channel'),
        'recipients': s.get('recipients'),
        'delivered': s.get('delivered'),
        'bounced': s.get('bounced'),
        'opens': s.get('opens'),
        'opens_unique': s.get('opens_unique'),
        'clicks': s.get('clicks'),
        'clicks_unique': s.get('clicks_unique'),
        'delivery_rate': s.get('delivery_rate'),
        'open_rate': s.get('open_rate'),
        'click_rate': s.get('click_rate'),
        'conversion_rate': s.get('conversion_rate'),
        'unsubscribes': s.get('unsubscribes'),
        'spam_complaints': s.get('spam_complaints'),
        'conversions': s.get('conversions'),
        'conversion_value': s.get('conversion_value'),
        'revenue_per_recipient': s.get('revenue_per_recipient'),
        'average_order_value': s.get('average_order_value'),
        'payload_json': json.dumps(r),
    }))
PYEOF

python3 transform.py dobias "2024-05-23" "2025-05-22" "backfill_$(date -u +%F)" period_0.json > period_0.ndjson
python3 transform.py dobias "2025-05-23" "2026-05-23" "backfill_$(date -u +%F)" period_1.json > period_1.ndjson
cat period_*.ndjson > all.ndjson
echo "Total NDJSON rows: $(wc -l < all.ndjson)"

# Load into BQ
bq load \
  --source_format=NEWLINE_DELIMITED_JSON \
  --project_id=oneeighty-warehouse \
  raw.raw_klaviyo_campaign_reports \
  all.ndjson

# Verify
bq query --use_legacy_sql=false --project_id=oneeighty-warehouse "
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT campaign_id) AS unique_campaigns,
  COUNTIF(send_channel='email') AS email_rows,
  COUNTIF(send_channel='sms') AS sms_rows,
  MIN(report_timeframe_start) AS earliest,
  MAX(report_timeframe_end) AS latest
FROM raw.raw_klaviyo_campaign_reports
WHERE DATE(ingested_at) = CURRENT_DATE()
"
```

## Expected results (Dobias as of 2026-05-23)

- ~470 total rows (196 from period 0 + 272 from period 1)
- ~410 email + ~60 SMS + 0 push
- Coverage May 2023 → May 2026 (24 months)

## Re-running

The table is append-only — re-running creates new snapshots. `stg_klaviyo_campaigns` always picks the latest snapshot per campaign via ROW_NUMBER over `ingested_at DESC`. Safe to re-run for refresh.

## Refresh 2026-06-21 (close the post-backfill stale gap)

The original 24-month backfill ended at the `2026-05-23` window. Because the ongoing
n8n sync was never wired (see PROJECT_LOG follow-up), every campaign sent after
`2026-05-22` came back with NULL performance metrics — 41 Dobias email campaigns
(`2026-04-16 → 2026-06-20`) with NULL `delivered`/`opens`/`recipients`. On a "last 30
days" Looker window this empties the Email page (open-rate scorecard blank, table all
null).

Fix = re-run the same procedure with the window shifted to end **today**. Identical
block as above, only the two timeframe windows change (paste in Cloud Shell):

```bash
# Period 0:  2024-06-22T00:00:00+00:00 → 2025-06-21T23:59:59+00:00
# Period 1:  2025-06-22T00:00:00+00:00 → 2026-06-22T00:00:00+00:00
```

and update the two `transform.py` date args to match:

```bash
python3 transform.py dobias "2024-06-22" "2025-06-21" "refresh_$(date -u +%F)" period_0.json > period_0.ndjson
python3 transform.py dobias "2025-06-22" "2026-06-22" "refresh_$(date -u +%F)" period_1.json > period_1.ndjson
```

Everything else (statistics list, conversion_metric_id `Vyfqq8`, `bq load`, verify) is
unchanged. Append-only + latest-snapshot semantics mean the 41 stale campaigns get
real values and older campaigns refresh their still-evolving (~30d post-send) conversion
stats. Verify after load:

```sql
SELECT COUNTIF(delivered IS NULL) AS still_null, MAX(send_date) AS latest_with_data
FROM `oneeighty-warehouse.mart.mart_email_campaign_perf`
WHERE client_id='dobias' AND DATE(send_date) >= '2026-05-01';
-- expect still_null → 0 (or only genuine zero-recipient drafts), latest_with_data → ~today
```

**Durable fix — DONE 2026-06-21.** `wf_klaviyo_to_bigquery` now has a `Fetch campaign
reports → Transform campaign reports → BQ: insert campaign reports` branch that POSTs
`/api/campaign-values-reports/` for a rolling 35-day window every 6h, per active Klaviyo
client. `stg_klaviyo_campaigns` already takes the latest snapshot per campaign, so the
rolling re-fetch refreshes recent campaigns (incl. the ~30-day conversion tail) without
double-counting. The manual backfill above is now only needed for first-time history or
to re-pull a window older than 35 days.

Prereq for the branch: `ref.clients.klaviyo_conversion_metric_id` must be set per client
(`Vyfqq8` for Dobias) — the workflow reads it and passes it as `conversion_metric_id`.

> **Flows are NOT yet on ongoing sync.** `stg_klaviyo_flows` SUMs across non-overlapping
> timeframe windows, so a naive rolling pull would overlap the 12-month backfill chunks
> and re-inflate flow revenue (the phantom-revenue bug from 2026-05-24). Wiring flow
> ongoing sync requires switching both the backfill and stg to a stable calendar-month
> period key first. Tracked as a follow-up.

## For a new client

Replace 3 values:
1. `klaviyo-<client>-api-key` in the secret pull
2. `client_id` argument in the python transform calls (`dobias` → new client)
3. `conversion_metric_id` (find via `/api/metrics/` filter as above)
