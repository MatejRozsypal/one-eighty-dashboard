# Runbook 21 — Klaviyo Subscriber Growth backfill (segment-series)

Backfills `raw.raw_klaviyo_subscriber_daily` from `/api/segment-series-reports/` — the daily
`total_members` / `members_added` / `members_removed` that power the Subscriber Growth chart
(total subscribers line, new subscribers, exclusions). `members_removed` is Klaviyo's own
exclusions definition (validated: do NOT reconstruct from unsub+bounce+spam).

## Prerequisite — a SEGMENT (not a list)
`segment-series-report` only accepts segment IDs. The "(NEW) Master List - USA & Canada" audience
is a **list** (`TuNgAg`) and returns empty. Create a segment mirroring it:

> **Klaviyo → Audience → Segments → Create:** definition = **"If someone is in list
> '(NEW) Master List - USA & Canada - DO NOT DELETE'"**. Name e.g. `Master List members (reporting)`.
> Save, let it build, copy the segment ID from the URL (`klaviyo.com/lists/<SEGMENT_ID>`).

Then register it:
```sql
UPDATE `oneeighty-warehouse.ref.clients`
  SET klaviyo_subscriber_segment_id = '<SEGMENT_ID>' WHERE client_id = 'dobias';
```

**Dobias (done 2026-06-21):** segment `YjD5JB` = "Data pipeline list growth segment", definition
`is_member of list TuNgAg` (the master list). Registered. Current `profile_count` = 45,601.

> **Wait for Klaviyo to populate segment-growth analytics before backfilling.** A freshly-created
> segment returns all-zero `total_members`/`members_added`/`members_removed` from segment-series until
> Klaviyo finishes its async growth backfill (`is_processing` flips to false on *membership* first; the
> growth series lags — typically a few hours, up to ~24–48h). **Check readiness** before running:
> ```
> query_segment_series(YjD5JB, last_7_days, daily) → total_members should be ~45,601, not 0.
> ```
> Only run the backfill once total_members is non-zero. If it never populates, segment growth isn't
> retroactive for new segments and we fall back to list add/removed metrics + forward snapshot.

> **Size note:** 45,601 ≠ the 78,551 in the Subscriber Growth screenshot — that screenshot was a
> different/account-wide audience. This segment tracks the master list. Confirm that's intended.

## Constraints (verified)
- **daily interval ≤ 60 days per call** → walk 60-day windows.
- Data floor: **2023-06-01** (nothing earlier).
- Response: `data.attributes.date_times[]` + `results[].statistics.{total_members,...}` arrays.

## Procedure (Cloud Shell) — after the segment exists

```bash
KLAVIYO_KEY=$(gcloud secrets versions access latest --secret=klaviyo-dobias-api-key --project=oneeighty-warehouse)
SEG=$(bq query --use_legacy_sql=false --format=csv --project_id=oneeighty-warehouse \
  "SELECT klaviyo_subscriber_segment_id FROM \`oneeighty-warehouse.ref.clients\` WHERE client_id='dobias'" | tail -1)
echo "segment: $SEG"
mkdir -p /tmp/klaviyo-subs && cd /tmp/klaviyo-subs

# Walk 60-day windows from 2023-06-01 to today
python3 - "$KLAVIYO_KEY" "$SEG" << 'PYEOF'
import sys, json, subprocess, datetime as dt
key, seg = sys.argv[1], sys.argv[2]
start = dt.date(2023,6,1); today = dt.date.today(); now = dt.datetime.utcnow().isoformat()+'Z'
rows = []
cur = start
while cur < today:
    end = min(cur + dt.timedelta(days=60), today)
    body = {"data":{"type":"segment-series-report","attributes":{
        "statistics":["total_members","members_added","members_removed","net_members_changed"],
        "timeframe":{"start":cur.isoformat()+"T00:00:00+00:00","end":end.isoformat()+"T00:00:00+00:00"},
        "interval":"daily","filter":f'equals(segment_id,"{seg}")'}}}
    out = subprocess.run(["curl","-s","-X","POST","https://a.klaviyo.com/api/segment-series-reports/",
        "-H",f"Authorization: Klaviyo-API-Key {key}","-H","revision: 2024-10-15",
        "-H","accept: application/vnd.api+json","-H","content-type: application/vnd.api+json",
        "-d",json.dumps(body)], capture_output=True, text=True).stdout
    d = json.loads(out); attr = (d.get('data') or {}).get('attributes') or {}
    dts = [str(x)[:10] for x in (attr.get('date_times') or [])]
    for r in (attr.get('results') or []):
        s = r.get('statistics') or {}
        def at(n,i):
            a=s.get(n); return (a[i] if isinstance(a,list) and i<len(a) else None)
        for i,day in enumerate(dts):
            rows.append({"client_id":"dobias","ingested_at":now,"ingest_source":"backfill_subs_"+now[:10],
                "metric_date":day,"channel":"email","total_subscribers":at('total_members',i),
                "new_subscribers":at('members_added',i),"exclusions":at('members_removed',i),
                "payload_json":json.dumps({"segment_id":seg,"metric_date":day})})
    print(f"{cur}..{end}: {len(dts)} days, err={d.get('errors',[{}])[0].get('detail') if d.get('errors') else 'OK'}")
    cur = end
open("subs.ndjson","w").write("\n".join(json.dumps(r) for r in rows))
print("total rows:", len(rows))
PYEOF

bq load --source_format=NEWLINE_DELIMITED_JSON --project_id=oneeighty-warehouse raw.raw_klaviyo_subscriber_daily subs.ndjson

# verify: latest total ~ matches the master-list size; May new/exclusions vs UI (647 / 1,031)
bq query --use_legacy_sql=false --project_id=oneeighty-warehouse "
SELECT MAX(metric_date) AS latest, ANY_VALUE(total_subscribers) AS latest_total,
  SUM(IF(metric_date BETWEEN '2026-05-01' AND '2026-05-30', new_subscribers, 0)) AS may_new,
  SUM(IF(metric_date BETWEEN '2026-05-01' AND '2026-05-30', exclusions, 0)) AS may_excl
FROM \`oneeighty-warehouse.mart.mart_email_subscriber_daily\` WHERE client_id='dobias'"
```

Ongoing sync is already wired in `wf_klaviyo_to_bigquery` (Fetch subscriber series, rolling 35-day
window) — it activates automatically once `klaviyo_subscriber_segment_id` is set.

## Re-running
Append-only; `mart_email_subscriber_daily` takes latest snapshot per (client, channel, metric_date). Safe.
