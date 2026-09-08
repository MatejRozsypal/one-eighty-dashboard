#!/usr/bin/env python3
"""Add the Creative Engine's insight fields to a LIVE export of wf_meta_ads_to_bigquery.

    python3 patch_meta_creative_fields.py live_export.json patched.json

── Why this is a patch script and not a new workflow file ────────────────────
The copy of `wf_meta_ads_to_bigquery.json` committed in this directory is STALE
against the live instance. Live carries a rolling ~35-day re-fetch window that
was never pushed to git; the committed "Plan execution" node still fetches
yesterday only. Importing the repo file would silently revert that fix, and the
symptom it fixed was a 58% undercount of Meta spend that nothing alerted on.

So: export the live workflow from n8n, run this over the export, import the
result. The script only touches two nodes and refuses to run if it does not
recognise them.

It is idempotent. Running it twice adds nothing the second time.
"""

from __future__ import annotations

import json
import sys

# Extra `fields` on the ad-insights call. All of them are additional entries on
# a request the workflow already makes every hour, so the marginal cost is one
# longer query string. Together with the video_play_actions (3s) and
# video_thruplay_watched_actions (15s) the workflow already asks for, these give
# eight real points across a video's duration and a real retention curve.
NEW_FIELDS = [
    "video_avg_time_watched_actions",
    "video_p25_watched_actions",
    "video_p50_watched_actions",
    "video_p75_watched_actions",
    "video_p95_watched_actions",
    "video_p100_watched_actions",
    "video_30_sec_watched_actions",
    "outbound_clicks",
    "unique_outbound_clicks",
]

# Inserted into the Transform node's returned object. `pick()` already exists in
# that node and pulls one action_type out of an array; every new field arrives
# in the same ARRAY<STRUCT<action_type, value>> shape.
TRANSFORM_ADDITION = """  video_p25_watched:  pick(r.video_p25_watched_actions, 'video_view'),
  video_p50_watched:  pick(r.video_p50_watched_actions, 'video_view'),
  video_p75_watched:  pick(r.video_p75_watched_actions, 'video_view'),
  video_p95_watched:  pick(r.video_p95_watched_actions, 'video_view'),
  video_p100_watched: pick(r.video_p100_watched_actions, 'video_view'),
  video_30s_watched:  pick(r.video_30_sec_watched_actions, 'video_view'),
  video_avg_time_watched_sec: pick(r.video_avg_time_watched_actions, 'video_view'),
  outbound_clicks:        pick(r.outbound_clicks, 'outbound_click'),
  unique_outbound_clicks: pick(r.unique_outbound_clicks, 'outbound_click'),
  video_quartile_raw: JSON.stringify({
    p25: r.video_p25_watched_actions ?? [], p50: r.video_p50_watched_actions ?? [],
    p75: r.video_p75_watched_actions ?? [], p95: r.video_p95_watched_actions ?? [],
    p100: r.video_p100_watched_actions ?? [], s30: r.video_30_sec_watched_actions ?? [],
    avg: r.video_avg_time_watched_actions ?? []
  }),
"""

MARKER = "video_p25_watched:"          # idempotency probe for the transform
ANCHOR = "  payload_json: JSON.stringify(r)"


def patch_fetch(node: dict) -> bool:
    """Append the new field names to the `fields` query parameter."""
    params = node.get("parameters", {}).get("queryParameters", {}).get("parameters", [])
    for p in params:
        if p.get("name") != "fields":
            continue
        have = [f for f in p["value"].split(",") if f]
        added = [f for f in NEW_FIELDS if f not in have]
        if not added:
            return False
        p["value"] = ",".join(have + added)
        return True
    raise SystemExit("! 'Fetch ad insights' has no `fields` query parameter — not the expected node.")


def patch_transform(node: dict) -> bool:
    """Insert the new column mappings just above payload_json."""
    code = node["parameters"]["jsCode"]
    if MARKER in code:
        return False
    if ANCHOR not in code:
        raise SystemExit(
            "! 'Transform ad insights' does not end with the expected "
            "`payload_json: JSON.stringify(r)` line. Patch it by hand — see "
            "runbooks/29_creative_engine_rollout.md."
        )
    node["parameters"]["jsCode"] = code.replace(ANCHOR, TRANSFORM_ADDITION + ANCHOR, 1)
    return True


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)

    with open(sys.argv[1], encoding="utf-8") as fh:
        wf = json.load(fh)

    nodes = {n["name"]: n for n in wf["nodes"]}
    for required in ("Fetch ad insights", "Transform ad insights"):
        if required not in nodes:
            raise SystemExit(f"! No node named {required!r}. Is this the Meta workflow export?")

    changed = [
        patch_fetch(nodes["Fetch ad insights"]),
        patch_transform(nodes["Transform ad insights"]),
    ]

    with open(sys.argv[2], "w", encoding="utf-8") as fh:
        json.dump(wf, fh, ensure_ascii=False, indent=2)

    if any(changed):
        print(f"patched  fetch={changed[0]}  transform={changed[1]}  ->  {sys.argv[2]}")
    else:
        print("already patched; wrote an identical copy")

    # The columns have to exist before the first patched run, or every insert
    # fails on an unknown field and the hourly workflow starts erroring.
    print("\nBefore importing: run infra/bigquery/219_create_raw_meta_creatives.sql")
    print("(the ALTER TABLE at the bottom adds the nine columns these fields land in).")


if __name__ == "__main__":
    main()
