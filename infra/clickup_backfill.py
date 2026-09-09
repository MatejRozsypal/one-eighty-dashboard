#!/usr/bin/env python3
"""
clickup_backfill.py — load the ClickUp lists into BigQuery once, by hand.

    python3 clickup_backfill.py [client_id ...]

Does exactly what `wf_clickup_to_bigquery.json` does, in one file you can read:
fetch the field definitions and the tasks for every list in ref.clickup_lists,
land them in raw.raw_clickup_fields / raw.raw_clickup_tasks, then call
ref.sp_rebuild_creative_tags() to rebuild the ref layer.

WHY THIS EXISTS ALONGSIDE THE WORKFLOW
--------------------------------------
The workflow is the ongoing sync and this is not a replacement for it. It is
for the first load and for proving the spine works before anyone spends time
importing JSON into n8n — if the transform is wrong, finding out here costs a
minute instead of a debugging session inside a workflow editor.

It is also the only path that works before n8n has the secret, which is the
state every client starts in.

THE TOKEN
---------
Read from Secret Manager, never passed on the command line, never printed.
`Authorization: pk_...` with NO `Bearer` prefix — adding one returns OAUTH_019,
which reads like a scope problem and sends you looking in the wrong place.
"""

from __future__ import annotations

import io
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

PROJECT = "oneeighty-warehouse"
API = "https://api.clickup.com/api/v2"
TIMEOUT = 60
# 100 requests/minute per token on Business. A full run is ~20 calls, but the
# backoff is here so a growing workspace fails loudly rather than silently.
RATE_PAUSE = 0.7


def secret(name: str) -> str:
    return subprocess.run(
        ["gcloud", "secrets", "versions", "access", "latest",
         f"--secret={name}", f"--project={PROJECT}"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def call(token: str, path: str, params: dict | None = None) -> dict:
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": token})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 4:
                wait = 2 ** attempt
                print(f"    · rate limited, waiting {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            raise
    raise RuntimeError("unreachable")


def ts(value) -> str | None:
    return datetime.fromtimestamp(int(value) / 1000, timezone.utc).isoformat() if value else None


def resolve(field: dict, defs: dict[str, dict]) -> dict:
    """
    One custom field, with its value made legible.

    ClickUp returns a dropdown's value as the option's ORDERINDEX INTEGER, not
    its label. Storing the 1 is storing nothing: reorder the options and every
    historical row silently changes meaning. Resolved here against the
    definitions fetched moments ago.
    """
    d = defs.get(field["id"], {})
    cfg = d.get("type_config") or field.get("type_config") or {}
    options = cfg.get("options") or []
    v = field.get("value")
    ftype = field.get("type")
    text = num = None
    ids: list[str] = []

    if v is None or v == "":
        pass
    elif ftype == "drop_down":
        hit = next((o for o in options if str(o.get("orderindex")) == str(v)), None) \
            or next((o for o in options if str(o.get("id")) == str(v)), None)
        text = hit.get("name") if hit else None
    elif ftype in ("list_relationship", "tasks"):
        if isinstance(v, list):
            ids = [str(x.get("id", x)) for x in v]
            names = [x.get("name") for x in v if isinstance(x, dict) and x.get("name")]
            text = ", ".join(names) or None
    elif ftype in ("number", "currency"):
        num = float(v)
    elif ftype == "date":
        text = datetime.fromtimestamp(int(v) / 1000, timezone.utc).date().isoformat()
    elif ftype == "labels" and isinstance(v, list):
        by_id = {o.get("id"): o.get("label") or o.get("name") for o in options}
        text = ", ".join(filter(None, (by_id.get(x) for x in v))) or None
    else:
        text = str(v)

    # A value identical to its own field's name is a placeholder somebody typed
    # over, not data. `Creative ID` holds the literal string "Creative ID" on
    # every Manami task; letting it through would invent an ad id that joins to
    # nothing and shows up in every breakdown as an untraceable untagged row.
    if text is not None and text.strip() == (field.get("name") or "").strip():
        text = None

    return {"field_id": field["id"], "name": field.get("name"), "type": ftype,
            "value_text": text, "value_num": num, "value_ids": ids}


def load(bq, table: str, rows: list[dict]) -> None:
    from google.cloud.bigquery import LoadJobConfig, SourceFormat
    if not rows:
        return
    buf = io.BytesIO("\n".join(json.dumps(r, ensure_ascii=False) for r in rows).encode())
    bq.load_table_from_file(
        buf, f"{PROJECT}.raw.{table}",
        job_config=LoadJobConfig(source_format=SourceFormat.NEWLINE_DELIMITED_JSON,
                                 write_disposition="WRITE_APPEND"),
    ).result()


def main() -> None:
    from google.cloud import bigquery

    token = secret("clickup-api-token")
    bq = bigquery.Client(project=PROJECT)
    wanted = set(sys.argv[1:])

    lists = [dict(r) for r in bq.query(
        f"SELECT client_id, list_kind, list_id FROM `{PROJECT}.ref.clickup_lists` "
        "WHERE active ORDER BY client_id, list_kind").result()]
    if wanted:
        lists = [l for l in lists if l["client_id"] in wanted]

    now = datetime.now(timezone.utc).isoformat()
    today = date.today().isoformat()
    field_rows: list[dict] = []
    task_rows: list[dict] = []

    for entry in lists:
        cid, kind, lid = entry["client_id"], entry["list_kind"], entry["list_id"]
        try:
            fields = (call(token, f"/list/{lid}/field") or {}).get("fields") or []
        except urllib.error.HTTPError as e:
            print(f"  ! {cid}/{kind}: field read failed ({e})", file=sys.stderr)
            continue
        time.sleep(RATE_PAUSE)

        defs = {f["id"]: f for f in fields}
        for f in fields:
            cfg = f.get("type_config") or {}
            field_rows.append({
                "client_id": cid, "ingested_at": now, "snapshot_date": today,
                "list_kind": kind, "list_id": str(lid), "field_id": f["id"],
                "name": f.get("name"), "type": f.get("type"),
                # Present only on list_relationship fields. This is the column
                # that shows Venev's `Concept` field aiming at Manami's list.
                "target_list_id": str(cfg["subcategory_id"]) if cfg.get("subcategory_id") else None,
                "options_json": json.dumps(cfg.get("options") or [], ensure_ascii=False),
                "payload_json": json.dumps(f, ensure_ascii=False),
            })

        page, seen = 0, 0
        while True:
            data = call(token, f"/list/{lid}/task",
                        {"include_closed": "true", "subtasks": "false", "page": page})
            tasks = data.get("tasks") or []
            for t in tasks:
                task_rows.append({
                    "client_id": cid, "ingested_at": now, "snapshot_date": today,
                    "list_kind": kind, "list_id": str(lid), "task_id": str(t["id"]),
                    "task_name": t.get("name") or "", "task_url": t.get("url"),
                    "status": (t.get("status") or {}).get("status"),
                    "status_type": (t.get("status") or {}).get("type"),
                    "date_created": ts(t.get("date_created")),
                    "date_updated": ts(t.get("date_updated")),
                    "date_closed": ts(t.get("date_closed")),
                    "assignees": [a.get("username") or a.get("email")
                                  for a in (t.get("assignees") or [])
                                  if a.get("username") or a.get("email")],
                    "custom_fields": [resolve(f, defs) for f in (t.get("custom_fields") or [])],
                    "payload_json": json.dumps(t, ensure_ascii=False),
                })
            seen += len(tasks)
            if data.get("last_page") or not tasks:
                break
            page += 1
            time.sleep(RATE_PAUSE)

        print(f"  {cid:<8} {kind:<12} {len(fields):>2} fields, {seen:>3} tasks")
        time.sleep(RATE_PAUSE)

    load(bq, "raw_clickup_fields", field_rows)
    load(bq, "raw_clickup_tasks", task_rows)
    print(f"\nloaded {len(field_rows)} field rows, {len(task_rows)} task rows")

    print("rebuilding the ref layer …")
    bq.query(f"CALL `{PROJECT}.ref.sp_rebuild_creative_tags`()").result()

    for t in ("personas", "concepts", "creators", "creative_tags"):
        n = list(bq.query(f"SELECT COUNT(*) c FROM `{PROJECT}.ref.{t}`").result())[0].c
        print(f"  ref.{t:<15} {n}")

    issues = list(bq.query(
        f"SELECT severity, kind, COUNT(*) n FROM `{PROJECT}.ops.clickup_sync_issues` "
        "WHERE DATE(synced_at) = CURRENT_DATE() GROUP BY 1,2 ORDER BY 1,2").result())
    if issues:
        print("\nsync issues (nothing was guessed at):")
        for i in issues:
            print(f"  {i.severity:<6} {i.kind:<28} {i.n}")


if __name__ == "__main__":
    main()
