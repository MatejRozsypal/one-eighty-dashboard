#!/usr/bin/env python3
"""
creative_assets_job.py — mirror Meta ad creatives into BigQuery and GCS.

    python3 creative_assets_job.py [client_id ...] [--all]

`--all` reprocesses every delivering ad instead of only the ones with no
mirrored asset, and rebuilds thumbnails even where one already exists. Use it
after changing how thumbnails are generated; without it the existing objects
short-circuit the work.

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
# 640, not 400. The grid renders tiles at a 228px minimum, which is ~456
# device pixels on a retina display, so a 400px source was being upscaled and
# looked soft next to the full-resolution image in the detail panel. A 640px
# WebP is around 60-90 KB, so forty tiles is a few megabytes.
THUMB_PX = 640
TIMEOUT = 90

# ── The creative is a FIELD on the ad, not an edge ────────────────────────
# `GET /{ad_id}/adcreative` — which is what CREATIVE_ENGINE_BRIEF.md section 5b
# and runbook 28 both specify — returns
#   "Unknown path components: /adcreative"
# on every ad. The edge exists on an ad ACCOUNT (/act_X/adcreatives), not on an
# ad. Reading it as a nested field works, and `link_description` has to go: it
# is not a field of adcreative at all (it lives inside
# object_story_spec.link_data.description) and asking for it 400s the request.
CREATIVE_FIELDS = (
    "creative{id,object_type,object_story_spec,asset_feed_spec,title,body,"
    "call_to_action_type,image_hash,image_url,video_id,thumbnail_url,"
    "effective_object_story_id}"
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


def get_json(url: str, params: dict | None = None) -> dict:
    # No params means the URL is already complete — a `paging.next` from Graph
    # carries its own query string, and appending a bare "?" to it broke
    # pagination silently: the video catalogue stopped at exactly the page
    # limit and every video past the first hundred looked sourceless.
    full = f"{url}?{urllib.parse.urlencode(params)}" if params else url
    with urllib.request.urlopen(full, timeout=TIMEOUT) as r:
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


def fetch_ad_videos(account: str, token: str) -> dict[str, dict]:
    """
    Every video on the ad account, keyed by id.

    ── Why not GET /{video_id} ───────────────────────────────────────────────
    Because it is refused. A system user with View Performance on the ad
    account gets `(#10) Application does not have permission for this action`
    on the video node — for `source`, and for `picture` too, so even the poster
    frame is unreachable that way. The same fields come back without complaint
    from `/act_X/advideos`, which is the account's own edge and inside what
    View Performance already grants.

    That is worth stating plainly because the obvious conclusion from the error
    is "add a permission in Meta", and there is nothing to add. One call
    replaces one-per-video, so this is also faster.

    `thumbnails` carries up to fifteen sizes; the largest is usually 1024px and
    is what the grid tile should be built from.
    """
    out: dict[str, dict] = {}
    url = f"https://graph.facebook.com/{API_VERSION}/{account}/advideos"
    params = {"fields": "id,source,picture,length,thumbnails", "limit": "100",
              "access_token": token}
    while True:
        try:
            payload = get_json(url, params)
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            print(f"    ! advideos lookup failed: {e}", file=sys.stderr)
            break
        for v in payload.get("data") or []:
            thumbs = (v.get("thumbnails") or {}).get("data") or []
            best = max(thumbs, key=lambda t: t.get("width") or 0, default=None)
            out[str(v["id"])] = {
                "source": v.get("source"),
                "picture": v.get("picture"),
                "length": v.get("length"),
                "poster": (best or {}).get("uri") or v.get("picture"),
            }
        nxt = ((payload.get("paging") or {}).get("next"))
        if not nxt:
            break
        url, params = nxt, None
    return out


def resolve_image_hashes(account: str, token: str, hashes: list[str]) -> dict[str, str]:
    """
    Turn image hashes into download URLs.

    `asset_feed_spec.images[]` carries a `hash` and no URL — an Advantage+ ad
    lists its images by hash and expects you to look them up on the ad account.
    Batched because a creative can list eight of them and this is one call for
    all of them.
    """
    out: dict[str, str] = {}
    for i in range(0, len(hashes), 40):
        chunk = hashes[i : i + 40]
        try:
            payload = get_json(
                f"https://graph.facebook.com/{API_VERSION}/{account}/adimages",
                {"hashes": json.dumps(chunk), "fields": "hash,url", "access_token": token},
            )
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            print(f"    ! adimages lookup failed: {e}", file=sys.stderr)
            continue
        for row in payload.get("data") or []:
            if row.get("hash") and row.get("url"):
                out[row["hash"]] = row["url"]
    return out


# Placements that mean "the ad as people normally see it". The feed image is
# what a human means by "what does this ad look like", so it is what the grid
# tile and the detail panel show.
FEED_POSITIONS = {"feed", "instagram_profile_feed", "instagram_explore_home", "profile_feed"}


def _label_map(assets: list[dict], key: str) -> dict[str, str]:
    """adlabel name -> hash/video_id, for resolving customization rules."""
    out: dict[str, str] = {}
    for a in assets or []:
        for label in a.get("adlabels") or []:
            if label.get("name") and a.get(key):
                out[label["name"]] = str(a[key])
    return out


def _by_placement(afs: dict, assets: list[dict], key: str, rule_key: str) -> str | None:
    """
    The asset a feed placement would actually serve.

    ── Why not just take the first one ───────────────────────────────────────
    A placement-customised ad lists one asset per placement and an unordered
    catch-all, and `images[0]` is frequently the catch-all. On Manami's
    highest-spend ad that meant the dashboard showed `1 (4).png` — a different
    product, with a different offer — while the ad running in feed was
    `Nezna_static_feed.jpg`. The figures were right and the picture beside them
    was of something else, which is worse than showing no picture at all.

    `asset_customization_rules` says which asset belongs to which placement, so
    the feed rule is followed and the catch-all is the fallback rather than the
    default.
    """
    labels = _label_map(assets, key)
    rules = afs.get("asset_customization_rules") or []
    feed = catch_all = None
    for r in rules:
        spec = r.get("customization_spec") or {}
        positions = set((spec.get("facebook_positions") or [])
                        + (spec.get("instagram_positions") or []))
        hit = labels.get((r.get(rule_key) or {}).get("name") or "")
        if not hit:
            continue
        if positions & FEED_POSITIONS and feed is None:
            feed = hit
        if not positions and catch_all is None:
            catch_all = hit
    if feed:
        return feed
    if catch_all:
        return catch_all
    # No usable rules: the asset referenced most often is the closest thing to
    # a default this structure offers.
    counts: dict[str, int] = {}
    for a in assets or []:
        if a.get(key):
            counts[str(a[key])] = counts.get(str(a[key]), 0) + 1
    return max(counts, key=lambda k: counts[k]) if counts else None


def pick_asset(c: dict) -> tuple[str | None, str | None, str | None]:
    """
    Decide what the asset for this creative is.

    Manami's account turned out to be mostly `object_type: SHARE` — boosted
    existing posts — where the creative carries no image_hash, no video_id and
    an empty object_story_spec. The media is listed in `asset_feed_spec`
    instead. The order below is what actually finds something:

        video_id on the creative        a plain video ad
        asset_feed_spec videos          by placement rule, feed first
        image_hash / image_url          a plain image ad
        asset_feed_spec images          by placement rule, feed first
        nothing                         thumbnail only

    Returns (kind, video_id, image_hash_or_url).
    """
    afs = c.get("asset_feed_spec") or {}
    spec = c.get("object_story_spec") or {}

    vid = c.get("video_id") or (spec.get("video_data") or {}).get("video_id")
    if not vid:
        vid = _by_placement(afs, afs.get("videos") or [], "video_id", "video_label")
    if vid:
        return "video", str(vid), None

    img = c.get("image_hash") or (spec.get("link_data") or {}).get("image_hash")
    if not img:
        img = _by_placement(afs, afs.get("images") or [], "hash", "image_label")
    if img:
        return "image", None, str(img)

    if c.get("image_url"):
        return "image", None, c["image_url"]

    return (None, None, None)


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


def ads_needing_creatives(bq, client_id: str, force: bool = False) -> list[dict]:
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
    """ + ("" if force else "WHERE h.ad_id IS NULL OR h.asset_uri IS NULL")
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


def run_client(bq, storage, client_id: str, slug: str, force: bool = False) -> int:
    token = secret(f"meta-{slug}-access-token")
    account = secret(f"meta-{slug}-ad-account-id")
    todo = ads_needing_creatives(bq, client_id, force)
    if not todo:
        print(f"  {client_id}: nothing to fetch")
        return 0

    print(f"  {client_id}: {len(todo)} ads to fetch")
    # With --all the point is to rebuild derivatives, so the "already in the
    # bucket" short-circuit is skipped for thumbnails; full assets are still
    # reused because those are the originals and do not change.
    have = existing_objects(storage, client_id)
    if force:
        have = {k for k in have if "/thumb/" not in k}
    now = datetime.now(timezone.utc).isoformat()
    today = date.today().isoformat()

    # ── Pass one: read every creative, note which image hashes need URLs ────
    creatives: dict[str, dict] = {}
    wanted_hashes: set[str] = set()
    for entry in todo:
        ad_id = entry["ad_id"]
        try:
            payload = get_json(
                f"https://graph.facebook.com/{API_VERSION}/{ad_id}",
                {"fields": CREATIVE_FIELDS, "access_token": token},
            )
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            # A deleted ad still has insight rows. Skipping keeps the run going.
            print(f"    ! {ad_id}: creative read failed ({e})", file=sys.stderr)
            continue
        c = payload.get("creative")
        if not c:
            continue
        creatives[ad_id] = c
        kind, _vid, img = pick_asset(c)
        if kind == "image" and img and not img.startswith("http"):
            wanted_hashes.add(img)

    urls = resolve_image_hashes(account, token, sorted(wanted_hashes)) if wanted_hashes else {}
    videos = fetch_ad_videos(account, token)
    print(f"  {client_id}: {len(creatives)} creatives read, "
          f"{len(urls)} image hashes resolved, {len(videos)} videos catalogued")

    # ── Pass two: mirror ────────────────────────────────────────────────────
    rows: list[dict] = []
    for ad_id, c in creatives.items():
        kind, video_id, image_ref = pick_asset(c)
        asset_uri = thumb_uri = None
        asset_bytes = video_len = None
        image_hash = image_ref if (image_ref and not image_ref.startswith("http")) else None
        # Dedupe key. The video id or image hash is stable across ads, so a
        # creative reused in several ad sets — or graduated by post ID into a
        # second ad_id — is stored once and pointed at twice.
        ident = video_id or image_hash or f"ad{ad_id}"

        # ── The full-size asset first, because the thumbnail is made FROM it ──
        # The first version built the tile image from `creative.thumbnail_url`,
        # which is a ~160px CDN crop. Downscaling that to 640 upscales it, so
        # the grid looked soft while the detail panel — which loads the real
        # asset — was sharp. Whatever the highest-resolution source is, that is
        # what the tile is rendered from.
        best_source: str | None = None
        meta: dict = {}

        if kind == "video" and video_id:
            meta = videos.get(video_id, {})
            video_len = meta.get("length")
            key = f"{client_id}/video/{video_id}.mp4"
            if key in have:
                asset_uri = f"gs://{BUCKET}/{key}"
            elif meta.get("source"):
                blob = get_bytes(meta["source"])
                if blob:
                    asset_uri = upload(storage, key, blob, "video/mp4")
                    asset_bytes = len(blob)
                    have.add(key)
            else:
                print(f"    · {ad_id}: no source for video {video_id}")
            # Up to 1024px from the video's own thumbnail set, rather than the
            # creative's small crop.
            best_source = meta.get("poster") or c.get("thumbnail_url")

        elif kind == "image" and image_ref:
            key = f"{client_id}/image/{ident}.jpg"
            src = image_ref if image_ref.startswith("http") else urls.get(image_ref)
            if key in have:
                asset_uri = f"gs://{BUCKET}/{key}"
            elif src:
                blob = get_bytes(src)
                if blob:
                    asset_uri = upload(storage, key, blob, "image/jpeg")
                    asset_bytes = len(blob)
                    have.add(key)
            best_source = src or c.get("thumbnail_url")

        else:
            # No resolvable asset — a SHARE whose media lives only on the post.
            # The creative's own thumbnail is all there is, and it is still
            # better than an empty tile.
            best_source = c.get("thumbnail_url")

        thumb_key = f"{client_id}/thumb/{ident}.webp"
        if thumb_key in have:
            thumb_uri = f"gs://{BUCKET}/{thumb_key}"
        elif best_source:
            blob = get_bytes(best_source)
            if blob:
                small, ext = thumbnail(blob)
                thumb_key = f"{client_id}/thumb/{ident}.{ext}"
                thumb_uri = upload(
                    storage, thumb_key, small,
                    "image/webp" if ext == "webp" else "image/jpeg")
                have.add(thumb_key)

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
            "asset_kind": kind,
            "thumb_uri": thumb_uri,
            # INT64: never emit 12345.0. BigQuery rejects a decimal point in an
            # INT64 load and reports it after "Upload complete" is printed, so
            # the failure reads as success. Same trap as meta_backfill.py.
            "asset_bytes": int(asset_bytes) if asset_bytes else None,
            "video_length_sec": float(video_len) if video_len else None,
            "payload_json": json.dumps(c, ensure_ascii=False),
            **extract_copy(c),
        })

    if rows:
        load(bq, rows)
    mirrored = sum(1 for r in rows if r["asset_uri"])
    thumbed = sum(1 for r in rows if r["thumb_uri"])
    print(f"  {client_id}: {len(rows)} rows, {thumbed} thumbnails, {mirrored} full assets")
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

    args = sys.argv[1:]
    force = "--all" in args
    wanted = {a for a in args if not a.startswith("--")}
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
        total += run_client(bq, storage, c["client_id"], c["slug"], force)
    print(f"done: {total} rows")


if __name__ == "__main__":
    main()
