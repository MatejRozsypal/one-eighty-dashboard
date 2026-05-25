# Runbook 16 — Klaviyo Flow Reports Backfill

Mirror of runbook 15 but for flows. Pulls Klaviyo flow-level performance metrics from `/api/flow-values-reports/` and loads into BigQuery via `bq load`. 24 months in two 12-month chunks.

The default `/api/flows/` endpoint returns metadata only — performance stats live behind `/api/flow-values-reports/`.

## Prerequisites

- Cloud Shell in `oneeighty-warehouse`
- Secret `klaviyo-<client>-api-key` populated
- BQ table `raw.raw_klaviyo_flow_reports` exists (one-off DDL below)
- Same conversion metric ID as campaigns (Shopify "Placed Order" — `Vyfqq8` for Dobias)

## Key constraints

- **1-year max timeframe per call** — same as campaigns endpoint. Period 1 + Period 2 backfill pattern.
- **Endpoint returns flow-message granularity** — one row per (flow_id, flow_message_id, period). Welcome sequences with N messages = N rows per period. stg aggregates back up to flow level.
- **Keep periods non-overlapping**, otherwise stg SUM double-counts.
- Same response shape as campaign-values-reports: `.data.attributes.results[]`

## Procedure

```bash
KLAVIYO_KEY=$(gcloud secrets versions access latest --secret=klaviyo-dobias-api-key --project=oneeighty-warehouse)
mkdir -p /tmp/klaviyo-flow-backfill && cd /tmp/klaviyo-flow-backfill

# Two non-overlapping 12-month periods (leaves a ~3-day gap from end-of-period-2 to today;
# that gap fills in when ongoing sync is wired)
for i in 0 1; do
  if [ $i -eq 0 ]; then
    START="2024-05-23T00:00:00+00:00"; END="2025-05-22T23:59:59+00:00"
  else
    START="2025-05-23T00:00:00+00:00"; END="2026-05-22T23:59:59+00:00"
  fi
  echo "Period $i: $START → $END"
  curl -s -X POST "https://a.klaviyo.com/api/flow-values-reports/" \
    -H "Authorization: Klaviyo-API-Key ${KLAVIYO_KEY}" \
    -H "revision: 2024-10-15" \
    -H "accept: application/vnd.api+json" \
    -H "content-type: application/vnd.api+json" \
    -d "{
      \"data\": {
        \"type\": \"flow-values-report\",
        \"attributes\": {
          \"statistics\": [\"recipients\",\"delivered\",\"bounced\",\"opens\",\"opens_unique\",\"clicks\",\"clicks_unique\",\"conversions\",\"conversion_value\",\"unsubscribes\",\"spam_complaints\",\"delivery_rate\",\"open_rate\",\"click_rate\",\"conversion_rate\",\"revenue_per_recipient\",\"average_order_value\"],
          \"timeframe\": {\"start\":\"${START}\",\"end\":\"${END}\"},
          \"conversion_metric_id\": \"Vyfqq8\"
        }
      }
    }" > flow_period_${i}.json
  # IMPORTANT: check for errors block, not just result length
  ERR=$(jq -r '.errors[0].detail // "OK"' flow_period_${i}.json)
  echo "  → status: ${ERR}; flow-messages: $(jq '.data.attributes.results // [] | length' flow_period_${i}.json)"
done

# Transform script
cat > transform_flows.py << 'PYEOF'
import json, sys
from datetime import datetime, timezone

now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
client_id, start_date, end_date, ingest_source, input_file = sys.argv[1:6]

with open(input_file) as f:
    data = json.load(f)

for r in data.get('data', {}).get('attributes', {}).get('results', []):
    g = r.get('groupings') or {}
    s = r.get('statistics') or {}
    if not g.get('flow_id'):
        continue
    print(json.dumps({
        'client_id': client_id,
        'ingested_at': now,
        'ingest_source': ingest_source,
        'report_timeframe_start': start_date[:10],
        'report_timeframe_end': end_date[:10],
        'flow_id': g.get('flow_id'),
        'flow_message_id': g.get('flow_message_id'),
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

python3 transform_flows.py dobias "2024-05-23" "2025-05-22" "backfill_$(date -u +%F)" flow_period_0.json > flow_period_0.ndjson
python3 transform_flows.py dobias "2025-05-23" "2026-05-22" "backfill_$(date -u +%F)" flow_period_1.json > flow_period_1.ndjson
cat flow_period_*.ndjson > flows_all.ndjson
echo "Total NDJSON rows: $(wc -l < flows_all.ndjson)"

bq load \
  --source_format=NEWLINE_DELIMITED_JSON \
  --project_id=oneeighty-warehouse \
  raw.raw_klaviyo_flow_reports \
  flows_all.ndjson

# Verify
bq query --use_legacy_sql=false --project_id=oneeighty-warehouse "
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT flow_id) AS unique_flows,
  COUNT(DISTINCT CONCAT(flow_id, '|', flow_message_id)) AS unique_flow_messages,
  COUNTIF(send_channel='email') AS email_rows,
  ROUND(SUM(conversion_value), 0) AS sum_revenue_24mo,
  ROUND(SUM(conversions), 0) AS sum_conversions_24mo
FROM raw.raw_klaviyo_flow_reports
WHERE DATE(ingested_at) = CURRENT_DATE()
"
```

## Expected (Dobias, 2026-05-25)

- ~137 rows (66 from period 0 + 71 from period 1)
- ~23 unique flows / ~75 unique flow-messages
- 135 email + 2 SMS
- $255k 24-month revenue / ~1,840 conversions

## Common errors

- **`Passed in timeframe is greater than 1 year`** — Klaviyo caps strictly at 365 days INCLUSIVE. Period end must be ≤ 364 days after start. Use end=22:59:59 on day-365 to be safe.
- **`Cannot iterate over null`** — `.data` is an OBJECT (single report), not array. Use `.data.attributes.results[]` to iterate.
- **0 results returned without error** — check for an `errors` block; old verify scripts silently swallowed errors.

## For a new client

Same as runbook 15: replace api key secret + client_id + conversion_metric_id.
