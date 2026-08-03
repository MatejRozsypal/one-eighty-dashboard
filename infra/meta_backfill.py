#!/usr/bin/env python3
"""
meta_backfill.py — pull Meta campaign insights history into
raw.raw_meta_campaign_insights for one client.

Usage (Google Cloud Shell):
    python3 meta_backfill.py <client_id> <slug> [months_back] > out.jsonl
    bq load --source_format=NEWLINE_DELIMITED_JSON \\
      oneeighty-warehouse:raw.raw_meta_campaign_insights out.jsonl

WHY THIS EXISTS RATHER THAN A WORKFLOW CHANGE
---------------------------------------------
`wf_meta_ads_to_bigquery` already backfills — but only 12 months, and only for a
client that has no data at all. After that it emits one incremental chunk per
run (yesterday). Reaching further back would mean editing a workflow that two
other clients depend on every hour, for a one-off load. This does the same job
out-of-band, exactly as runbook 12 does for Shopify.

Overlapping an existing load is harmless: `stg_meta_campaign_insights` dedupes on
(client_id, campaign_id, date_start) keeping the newest `ingested_at`, so a
re-run replaces rather than doubles.

THE 37-MONTH WALL
-----------------
Meta's Insights API serves roughly 37 months. Older data does not exist to be
fetched — no chunking, retrying or permission changes reach it. `months_back`
therefore defaults to 37 and is clamped there.

The transform mirrors the workflow's `Transform campaign insights` node field for
field, including the `omni_purchase ?? purchase` fallback. A backfill that
extracted conversions even slightly differently would leave a client's history
inconsistent with its own ongoing data, and the seam would sit at whatever date
the backfill happened to stop.
"""
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

PROJECT = "oneeighty-warehouse"
API_VERSION = "v22.0"          # matches the workflow's hardcoded version
CHUNK_DAYS = 30                # workflow uses 31-day windows; 30 is safely inside
MAX_MONTHS = 37                # Meta's retention wall

FIELDS = ("campaign_id,campaign_name,spend,impressions,reach,frequency,"
          "clicks,ctr,cpc,actions,action_values,purchase_roas")


def secret(name):
    return subprocess.run(
        ["gcloud", "secrets", "versions", "access", "latest",
         f"--secret={name}", f"--project={PROJECT}"],
        capture_output=True, text=True, check=True).stdout.strip()


def num(v):
    return None if v in (None, "") else float(v)


def pick(arr, action_type):
    """Value of one action_type out of Meta's actions/action_values array."""
    if not isinstance(arr, list):
        return None
    for row in arr:
        if row.get("action_type") == action_type:
            return float(row["value"])
    return None


def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.loads(r.read().decode())


def build_row(r, client_id, ad_account, ingested_at):
    return {
        "client_id":         client_id,
        "ingested_at":       ingested_at,
        "ingest_source":     "backfill",
        "ad_account_id":     ad_account,
        "campaign_id":       str(r.get("campaign_id", "")),
        "campaign_name":     r.get("campaign_name") or "",
        "date_start":        r.get("date_start"),
        "date_stop":         r.get("date_stop"),
        "spend":             num(r.get("spend")),
        "impressions":       num(r.get("impressions")),
        "reach":             num(r.get("reach")),
        "frequency":         num(r.get("frequency")),
        "clicks":            num(r.get("clicks")),
        "ctr":               num(r.get("ctr")),
        "cpc":               num(r.get("cpc")),
        "purchases":         pick(r.get("actions"), "omni_purchase")
                             if pick(r.get("actions"), "omni_purchase") is not None
                             else pick(r.get("actions"), "purchase"),
        "purchase_value":    pick(r.get("action_values"), "omni_purchase")
                             if pick(r.get("action_values"), "omni_purchase") is not None
                             else pick(r.get("action_values"), "purchase"),
        "add_to_cart":       pick(r.get("actions"), "add_to_cart"),
        "initiate_checkout": pick(r.get("actions"), "initiate_checkout"),
        "landing_page_views": pick(r.get("actions"), "landing_page_view"),
        "link_clicks":       pick(r.get("actions"), "link_click"),
        "video_views":       pick(r.get("actions"), "video_view"),
        "purchase_roas":     pick(r.get("purchase_roas"), "omni_purchase"),
        "actions":           json.dumps(r.get("actions") or []),
        "action_values":     json.dumps(r.get("action_values") or []),
        "payload_json":      json.dumps(r),
    }


def main():
    if len(sys.argv) not in (3, 4):
        sys.exit("usage: python3 meta_backfill.py <client_id> <slug> [months_back]")
    client_id, slug = sys.argv[1], sys.argv[2]
    months = min(int(sys.argv[3]) if len(sys.argv) == 4 else MAX_MONTHS, MAX_MONTHS)

    token = secret(f"meta-{slug}-access-token")
    account = secret(f"meta-{slug}-ad-account-id")
    if not account.startswith("act_"):
        account = "act_" + account

    ingested_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    floor = date.today() - timedelta(days=int(months * 30.44))
    until = date.today()
    total = 0
    empty_streak = 0

    while until > floor:
        since = max(until - timedelta(days=CHUNK_DAYS), floor)
        params = {
            "level": "campaign",
            "time_increment": "1",
            "time_range": json.dumps({"since": since.isoformat(),
                                      "until": until.isoformat()}),
            "fields": FIELDS,
            "limit": "500",
            "access_token": token,
        }
        url = (f"https://graph.facebook.com/{API_VERSION}/{account}/insights?"
               + urllib.parse.urlencode(params))

        chunk_rows = 0
        while url:
            try:
                payload = fetch(url)
            except Exception as exc:                      # noqa: BLE001
                print(f"# {since}..{until} FAILED: {exc}", file=sys.stderr)
                break
            for r in payload.get("data", []):
                print(json.dumps(build_row(r, client_id, account, ingested_at),
                                 ensure_ascii=False))
                chunk_rows += 1
            url = payload.get("paging", {}).get("next")

        total += chunk_rows
        print(f"# {since}..{until}  {chunk_rows} rows", file=sys.stderr)

        # Meta returns empty windows both for "account did not exist yet" and for
        # "nothing ran that month". Six empty chunks in a row -- half a year --
        # is taken as the former, so a long-dormant account is not walked all the
        # way to the wall for nothing.
        empty_streak = empty_streak + 1 if chunk_rows == 0 else 0
        if empty_streak >= 6:
            print(f"# stopping: 6 empty chunks, assuming account predates {until}",
                  file=sys.stderr)
            break

        until = since - timedelta(days=1)
        time.sleep(1)                                     # be kind to the API

    print(f"# TOTAL {total} rows for {client_id}", file=sys.stderr)


if __name__ == "__main__":
    main()
