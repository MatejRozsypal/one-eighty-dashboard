# Runbook 20 — Klaviyo daily backfill (flow-series + conversion metric-aggregates)

Backfills the daily Email dashboard: **Conversion Summary** (campaign vs flow revenue/day),
**Flows Conversion** (per-flow daily), and **emails/opens/clicks per day**.

## Why two sources (correction)
There is **no `campaign-series-report` endpoint** in Klaviyo (returns 404) — series exist only for
flows/forms/segments. So:
- **Flows** → `/api/flow-series-reports/` (daily) → `raw_klaviyo_flow_series` (volume + revenue/flow/day).
- **Conversion Summary revenue** → `/api/metric-aggregates/` on the conversion metric `Vyfqq8`,
  grouped `$attributed_channel` and `$attributed_flow` → `raw_klaviyo_conversion_daily`. The mart
  computes `campaign = Σchannel − Σflow` (validated live: May campaign ≈ $116.5k, flow ≈ $14.7k).

## Verified constraints
- **Series daily interval ≤ 60 days per call** (confirmed by API error) → 60-day chunks.
- Throttling: pause ~2s between calls.
- metric-aggregates dates[] / series date_times[] → `.slice(0,10)` already gives the account-tz local date.
- Account timezone = **US/Pacific** (matches the Klaviyo UI).

## Procedure (Cloud Shell)

```bash
KLAVIYO_KEY=$(gcloud secrets versions access latest --secret=klaviyo-dobias-api-key --project=oneeighty-warehouse)
mkdir -p /tmp/klaviyo-daily && cd /tmp/klaviyo-daily

python3 - "$KLAVIYO_KEY" << 'PYEOF'
import sys, json, subprocess, time, re, datetime as dt
key=sys.argv[1]; CM='Vyfqq8'; TZ='US/Pacific'; CLIENT='dobias'
now=dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')
start=dt.date(2024,6,1); today=dt.date.today()
def rnd(v):  # NUMERIC max scale = 9; raw API floats have ~16. Round currency to 4 dp.
    return (round(float(v),4) if v is not None else None)
def kfetch(url, body, headers, label, max_retries=8):
    # honors Klaviyo throttling: parses "available in N seconds" and retries.
    for _ in range(max_retries):
        out=subprocess.run(["curl","-s","-X","POST",url,"-H",f"Authorization: Klaviyo-API-Key {key}","-H","revision: 2024-10-15"]
                           +[x for h in headers for x in ("-H",h)]+["-d",json.dumps(body)],capture_output=True,text=True).stdout
        try: d=json.loads(out)
        except Exception: d={}
        errs=d.get('errors')
        if errs:
            detail=errs[0].get('detail',''); m=re.search(r'available in (\d+) second', detail)
            if m: w=int(m.group(1))+3; print(f"  throttled {label}; sleep {w}s"); time.sleep(w); continue
            print(f"  ERR {label}: {detail}"); return d
        return d
    print(f"  gave up {label}"); return {}
flow_rows=[]; conv_rows=[]; cur=start
while cur < today:
    end=min(cur+dt.timedelta(days=60), today); s=cur.isoformat(); e=end.isoformat()
    fb={"data":{"type":"flow-series-report","attributes":{
        "statistics":["recipients","delivered","bounced","opens","opens_unique","clicks","clicks_unique","conversions","conversion_value","unsubscribes","spam_complaints"],
        "timeframe":{"start":s+"T00:00:00+00:00","end":e+"T00:00:00+00:00"},"interval":"daily","conversion_metric_id":CM}}}
    fr=kfetch("https://a.klaviyo.com/api/flow-series-reports/",fb,["accept: application/vnd.api+json","content-type: application/vnd.api+json"],"flow "+s)
    attr=(fr.get('data') or {}).get('attributes') or {}; dts=[str(x)[:10] for x in (attr.get('date_times') or [])]
    for r in (attr.get('results') or []):
        g=r.get('groupings') or {}; st=r.get('statistics') or {}
        if not g.get('flow_id'): continue
        at=lambda n,i:(st.get(n)[i] if isinstance(st.get(n),list) and i<len(st.get(n)) else None)
        for i,d in enumerate(dts):
            flow_rows.append({"client_id":CLIENT,"ingested_at":now,"ingest_source":"backfill_flowseries_"+now[:10],
                "metric_date":d,"flow_id":g.get('flow_id'),"flow_message_id":g.get('flow_message_id'),"send_channel":g.get('send_channel'),
                "recipients":at('recipients',i),"delivered":at('delivered',i),"bounced":at('bounced',i),"opens":at('opens',i),
                "opens_unique":at('opens_unique',i),"clicks":at('clicks',i),"clicks_unique":at('clicks_unique',i),
                "conversions":at('conversions',i),"conversion_value":rnd(at('conversion_value',i)),
                "unsubscribes":at('unsubscribes',i),"spam_complaints":at('spam_complaints',i),"payload_json":json.dumps({"g":g,"d":d})})
    time.sleep(3)
    for dim in ['$attributed_channel','$attributed_flow']:
        mb={"data":{"type":"metric-aggregate","attributes":{"metric_id":CM,"measurements":["sum_value","count"],
            "interval":"day","timezone":TZ,"by":[dim],"filter":[f"greater-or-equal(datetime,{s}T00:00:00)",f"less-than(datetime,{e}T00:00:00)"]}}}
        mr=kfetch("https://a.klaviyo.com/api/metric-aggregates/",mb,["accept: application/json","content-type: application/json"],"conv "+dim+" "+s)
        a=(mr.get('data') or {}).get('attributes') or {}; dates=[str(x)[:10] for x in (a.get('dates') or [])]
        dtype='channel' if dim=='$attributed_channel' else 'flow'
        for row in (a.get('data') or []):
            dv=(row.get('dimensions') or [''])[0] or ''; sv=(row.get('measurements') or {}).get('sum_value') or []; ct=(row.get('measurements') or {}).get('count') or []
            for i,d in enumerate(dates):
                conv_rows.append({"client_id":CLIENT,"ingested_at":now,"ingest_source":"backfill_conv_"+now[:10],
                    "metric_date":d,"dim_type":dtype,"dim_value":dv,
                    "conversion_value":rnd(sv[i] if i<len(sv) else None),"conversions":int(ct[i]) if i<len(ct) and ct[i] is not None else None,
                    "payload_json":json.dumps({"dim":dv,"d":d})})
        time.sleep(3)
    print(f"{cur}..{end}: flow={len(flow_rows)} conv={len(conv_rows)}"); cur=end
open("flow_series.ndjson","w").write("\n".join(json.dumps(r) for r in flow_rows))
open("conv_daily.ndjson","w").write("\n".join(json.dumps(r) for r in conv_rows))
print("TOTAL flow",len(flow_rows),"conv",len(conv_rows))
PYEOF

bq load --source_format=NEWLINE_DELIMITED_JSON --project_id=oneeighty-warehouse raw.raw_klaviyo_flow_series   flow_series.ndjson
bq load --source_format=NEWLINE_DELIMITED_JSON --project_id=oneeighty-warehouse raw.raw_klaviyo_conversion_daily conv_daily.ndjson

# verify vs live cross-check (May): flow ≈ $14,710, campaign ≈ $116,570
bq query --use_legacy_sql=false --project_id=oneeighty-warehouse "
SELECT channel, ROUND(SUM(revenue),0) AS rev_may, SUM(emails_sent) AS sent_may
FROM \`oneeighty-warehouse.mart.mart_email_daily\`
WHERE client_id='dobias' AND metric_date BETWEEN '2026-05-01' AND '2026-05-31' GROUP BY channel"
```

## Re-running
Append-only; `stg_klaviyo_flow_series` and `stg_klaviyo_conversion_daily` take latest snapshot per key. Safe.

## Notes
- `raw_klaviyo_campaign_series` (from 205) is unused — campaign series doesn't exist. Left in place (empty), harmless.
- Campaign emails-sent/day comes from `mart_email_campaign_message_perf` (send-date) inside `mart_email_daily`.
