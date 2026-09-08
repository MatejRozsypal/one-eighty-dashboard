#!/usr/bin/env python3
"""
creative_assets_job.py — mirror Meta ad creatives into BigQuery and GCS.

    python3 creative_assets_job.py [client_id ...]      # default: every Meta client

Owns `raw.raw_meta_ad_creatives` end to end: it fetches the creative, extracts
the copy, downloads the asset, writes the thumbnail, and loads the row. One job
owning the whole table is deliberate — splitting the fetch into n8n and the
download into here would mean two systems writing the same row and disagreeing
about which of them last saw the truth.

WHY THE ASSET IS MIRRORED RATHER THAN LINKED
--------------------------------------------
Meta's `image_url` and `thumbnail_url` are signed and expire within hours. Store
one and render it tomorrow and the grid fills with broken images — the failure
arrives a day after the code that caused it, on a screen nobody is watching.
`image_hash` and `video_id` are stable, so those are the identity and our own
bucket is the serving copy.

Sizing, before anyone worries about it: Manami produces roughly 30 assets a
month. Video at ~15 MB and statics at ~0.5 MB is about 160 MB a month, under
2 GB per client per year, which is a few cents. Motion's storage bill is large
because they scrape the whole public Ad Library; mirroring your own account is a
rounding error. Do not over-engineer this.

WHY IT RUNS HERE AND NOT IN n8n
-------------------------------
The n8n box is a Hostinger VPS that falls over under load, and pulling 15 MB
binaries through a workflow engine is how that happens. n8n keeps the JSON-sized
jobs; this one takes the bytes.

DEPENDENCIES
------------
google-cloud-bigquery, google-cloud-storage, and optionally Pillow. Without
Pillow the original image is stored as its own thumbnail and a warning is
printed — the job still completes, the grid is just heavier.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

PROJECT = "oneeighty-warehouse"
API_VERSION = "v22.0"                       # matches wf_meta_ads_to_bigquery
BUCKET = os.environ.get("CREATIVE_BUCKET", "oneeighty-creatives")
TABLE = f"{PROJECT}.raw.raw_meta_ad_creatives"
THUMB_PX = 400
TIMEOUT = 90

CREATIVE_FIELDS = (
    "id,object_story_spec,asset_feed_spec,title,body,link_description,"
    "call_to_action_type,image_hash,image_url,video_id,thumbnail_url,"
    "effective_object_story_id,object_type"
)

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def secret(name: str) -> str:
    """Read a Secret Manager value. Same access path the workflows use."""
    return subprocess.run(
        ["gcloud", "secrets", "versions", "access", "latest",
         f"--secret={name}", f"--project={PROJECT}"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def get_json(url: str, params: dict) -> dict:
    q = urllib.parse.urlencode(params)
    with urllib.request.urlopen(f"{url}?{q}", timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def get_bytes(url: str) -> bytes | None:
    """Fetch a binary. A dead signed URL is expected, not exceptional."""
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
            return r.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        print(f"    ! download failed: {e}", file=sys.stderr)
        return None


def first_text(seq) -> str | None:
    """asset_feed_spec arrays hold {'text': ...} objects."""
    if not isinstance(seq, list) or not seq:
        return None
    head = seq[0]
    return head.get("text") if isinstance(head, dict) else str(head)


def extract_copy(c: dict) -> dict:
    """
    Pull the ad copy out of whichever shape this ad type uses.

    Single image  -> object_story_spec.link_data
    Video         -> object_story_spec.video_data
    Advantage+    -> asset_feed_spec.bodies[] / .titles[] / .descriptions[],
                     which hold EVERY text variant Meta is rotating — more than
                     Ads Manager shows in one view. The first becomes the scalar
                     column; the whole array is kept as JSON.
    """
    spec = c.get("object_story_spec") or {}
    data = spec.get("link_data") or spec.get("video_data") or {}
    feed = c.get("asset_feed_spec") or {}

    cta = data.get("call_to_action") or {}
    return {
        "body": data.get("message") or first_text(feed.get("bodies")) or c.get("body"),
        "title": data.get("name") or data.get("title") or first_text(feed.get("titles")) or c.get("title"),
        "link_description": (
            data.get("description")
            or first_text(feed.get("descriptions"))
            or c.get("link_description")
        ),
        "call_to_action_type": cta.get("type") or c.get("call_to_action_type"),
        "link_url": data.get("link") or (data.get("call_to_action", {}).get("value", {}) or {}).get("link"),
        "bodies_json": json.dumps(feed.get("bodies") or [], ensure_ascii=False),
        "titles_json": json.dumps(feed.get("titles") or [], ensure_ascii=False),
        "descriptions_json": json.dumps(feed.get("descriptions") or [], ensure_ascii=False),
    }


def thumbnail(raw: bytes) -> tuple[bytes, str]:
    """Downscale to THUMB_PX on the long edge. Falls back to the original."""
    try:
        from PIL import Image  # noqa: PLC0415 — optional dependency by design
    except ImportError:
        print("    ! Pillow not installed; storing the original as its own thumbnail",
              file=sys.stderr)
        return raw, "jpg"

    img = Image.open(io.BytesIO(raw))
    img.thumbnail((THUMB_PX, THUMB_PX))
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=80)
    return out.getvalue(), "webp"


# ---------------------------------------------------------------------------
# The job
# ---------------------------------------------------------------------------


def ads_needing_creatives(bq, client_id: str) -> list[dict]:
    """
    Ads with delivery whose creative row is missing or has no asset yet.

    Re-checks rows with a NULL `asset_uri` on every run rather than treating the
    row's existence as done: a video whose `source` was refused for want of the
    video permission comes back the moment that permission is granted, with no
    manual re-run to remember.
    """
    sql = f"""
    WITH delivering AS (
      SELECT DISTINCT ad_id
      FROM `{PROJECT}.stg.stg_meta_ad_insights`
      WHERE client_id = @client_id
        AND date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 18 MONTH)
        AND spend > 0
    ),
    have AS (
      SELECT ad_id, asset_uri
      FROM `{PROJECT}.stg.stg_meta_ad_creatives`
      WHERE client_id = @client_id
    )
    SELECT d.ad_id
    FROM delivering d
    LEFT JOIN have h USING (ad_id)
    WHERE h.ad_id IS NULL OR h.asset_uri IS NULL
    """
    from google.cloud.bigquery import QueryJobConfig, ScalarQueryParameter

    job = bq.query(sql, job_config=QueryJobConfig(
        query_parameters=[ScalarQueryParameter("client_id", "STRING", client_id)]))
    return [dict(r) for r in job.result()]


def existing_objects(storage, client_id: str) -> set[str]:
    """
    Object names already in the bucket for this client.

    Dedupe is on the hash, so a creative reused across ad sets — or graduated by
    post ID into a second ad_id — is stored once and pointed at twice.
    """
    bucket = storage.bucket(BUCKET)
    return {b.name for b in bucket.list_blobs(prefix=f"{client_id}/")}


def upload(storage, name: str, data: bytes, content_type: str) -> str:
    blob = storage.bucket(BUCKET).blob(name)
    blob.upload_from_string(data, content_type=content_type)
    return f"gs://{BUCKET}/{name}"


def run_client(bq, storage, client_id: str, slug: str) -> int:
    token = secret(f"meta-{slug}-access-token")
    todo = ads_needing_creatives(bq, client_id)
    if not todo:
        print(f"  {client_id}: nothing to fetch")
        return 0

    print(f"  {client_id}: {len(todo)} ads to fetch")
    have = existing_objects(storage, client_id)
    now = datetime.now(timezone.utc).isoformat()
    today = date.today().isoformat()
    rows: list[dict] = []

    for entry in todo:
        ad_id = entry["ad_id"]
        try:
            payload = get_json(
                f"https://graph.facebook.com/{API_VERSION}/{ad_id}/adcreative",
                {"fields": CREATIVE_FIELDS, "access_token": token, "limit": 1},
            )
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            # A deleted ad still has insight rows. Skipping keeps the run going;
            # the ad simply has no creative, which the UI already handles.
            print(f"    ! {ad_id}: adcreative failed ({e})", file=sys.stderr)
            continue

        creatives = payload.get("data") or []
        if not creatives:
            continue
        c = creatives[0]

        image_hash = c.get("image_hash")
        video_id = c.get("video_id")
        spec = c.get("object_story_spec") or {}
        if not video_id:
            video_id = (spec.get("video_data") or {}).get("video_id")
        if not image_hash:
            image_hash = (spec.get("link_data") or {}).get("image_hash")

        asset_uri = thumb_uri = asset_kind = None
        asset_bytes = video_len = None

        if video_id:
            asset_kind = "video"
            key = f"{client_id}/video/{video_id}.mp4"
            thumb_key = f"{client_id}/thumb/{video_id}.jpg"
            try:
                meta = get_json(
                    f"https://graph.facebook.com/{API_VERSION}/{video_id}",
                    {"fields": "source,picture,length", "access_token": token},
                )
            except (urllib.error.HTTPError, urllib.error.URLError) as e:
                print(f"    ! {ad_id}: video meta failed ({e})", file=sys.stderr)
                meta = {}

            video_len = meta.get("length")

            if key in have:
                asset_uri = f"gs://{BUCKET}/{key}"
            elif meta.get("source"):
                blob = get_bytes(meta["source"])
                if blob:
                    asset_uri = upload(storage, key, blob, "video/mp4")
                    asset_bytes = len(blob)
                    have.add(key)
            else:
                # `source` needs the video permission on the system user
                # (runbooks/07). Absent it, keep the poster frame and leave
                # asset_uri NULL so the next run retries rather than failing now.
                print(f"    · {ad_id}: no video source (permission?), thumbnail only")

            if thumb_key in have:
                thumb_uri = f"gs://{BUCKET}/{thumb_key}"
            elif meta.get("picture"):
                blob = get_bytes(meta["picture"])
                if blob:
                    thumb_uri = upload(storage, thumb_key, blob, "image/jpeg")
                    have.add(thumb_key)

        elif image_hash or c.get("image_url"):
            asset_kind = "image"
            ident = image_hash or f"ad{ad_id}"
            key = f"{client_id}/image/{ident}.jpg"
            if key in have:
                asset_uri = f"gs://{BUCKET}/{key}"
                thumb_uri = f"gs://{BUCKET}/{client_id}/thumb/{ident}.webp"
            elif c.get("image_url"):
                blob = get_bytes(c["image_url"])
                if blob:
                    asset_uri = upload(storage, key, blob, "image/jpeg")
                    asset_bytes = len(blob)
                    have.add(key)
                    thumb, ext = thumbnail(blob)
                    thumb_uri = upload(
                        storage, f"{client_id}/thumb/{ident}.{ext}", thumb,
                        "image/webp" if ext == "webp" else "image/jpeg")

        rows.append({
            "client_id": client_id,
            "ingested_at": now,
            "snapshot_date": today,
            "ad_id": str(ad_id),
            "creative_id": c.get("id"),
            "object_type": c.get("object_type"),
            "image_hash": image_hash,
            "video_id": video_id,
            "effective_object_story_id": c.get("effective_object_story_id"),
            "asset_uri": asset_uri,
            "asset_kind": asset_kind,
            "thumb_uri": thumb_uri,
            # INT64: never emit 12345.0. BigQuery rejects a decimal point in an
            # INT64 load, and the job fails AFTER "Upload complete" is printed,
            # so the failure reads as success. Same trap as meta_backfill.py.
            "asset_bytes": int(asset_bytes) if asset_bytes else None,
            "video_length_sec": float(video_len) if video_len else None,
            "payload_json": json.dumps(c, ensure_ascii=False),
            **extract_copy(c),
        })

    if rows:
        load(bq, rows)
    print(f"  {client_id}: wrote {len(rows)} creative rows")
    return len(rows)


def load(bq, rows: list[dict]) -> None:
    from google.cloud.bigquery import LoadJobConfig, SourceFormat

    buf = io.BytesIO("\n".join(json.dumps(r, ensure_ascii=False) for r in rows).encode())
    job = bq.load_table_from_file(
        buf, TABLE,
        job_config=LoadJobConfig(
            source_format=SourceFormat.NEWLINE_DELIMITED_JSON,
            write_disposition="WRITE_APPEND",
        ),
    )
    job.result()


def main() -> None:
    from google.cloud import bigquery, storage as gcs

    bq = bigquery.Client(project=PROJECT)
    storage = gcs.Client(project=PROJECT)

    wanted = set(sys.argv[1:])
    clients = [
        dict(r) for r in bq.query(
            f"SELECT client_id, slug FROM `{PROJECT}.ref.clients` "
            "WHERE status = 'active' AND has_meta = TRUE ORDER BY client_id"
        ).result()
    ]
    if wanted:
        clients = [c for c in clients if c["client_id"] in wanted]

    total = 0
    for c in clients:
        total += run_client(bq, storage, c["client_id"], c["slug"])
    print(f"done: {total} rows")


if __name__ == "__main__":
    main()
