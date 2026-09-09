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
# ── The ad's own fields, beside the creative's ────────────────────────────
# `raw_meta_ad_creatives` has carried `adset_id`, `adset_name`, `campaign_id`,
# `campaign_name` and `effective_status` since it was created, and this job has
# never written any of them — NULL on all 195 Manami rows. Nothing errored;
# `mart_creative_adset_perf` simply had no name to show and fell back to the id,
# and the detail panel had no status to print.
#
# They cost nothing: this is the same request, one field list longer.
AD_FIELDS = "adset{id,name},campaign{id,name},effective_status"

CREATIVE_FIELDS = (
    "creative{id,object_type,object_story_spec,asset_feed_spec,title,body,"
    "call_to_action_type,image_hash,image_url,video_id,thumbnail_url,"
    "effective_object_story_id,effective_instagram_media_id,"
    "source_instagram_media_id,instagram_permalink_url}"
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


def ig_media(media_id: str, token: str) -> dict | None:
    """
    A video's mp4 by way of the Instagram post it was published as.

    ── Why this exists ───────────────────────────────────────────────────────
    `/act_X/advideos` lists what was uploaded *to the ad account*. On Manami it
    lists 124 videos and **not one of the 46 the ads actually run**: the videos
    were published to Instagram first and promoted from there, so they live on
    the IG media object and are merely referenced by the ad. The account edge
    cannot see them, `/{video_id}` answers `(#10)`, and the page post behind
    `effective_object_story_id` needs `pages_read_engagement` at Advanced
    Access — which this app, in Development mode, does not have.

    `effective_instagram_media_id` is the way through. `media_url` on an IG
    media object is the full mp4 and comes back for the same system-user token
    that was refused everywhere else, because `instagram_basic` already covers
    the business account's own media. Sixty-one of Manami's sixty-nine video
    ads resolve this way, and the mp4 is the real thing — not a preview, not a
    poster frame.

    The eight that remain are Facebook page posts with no Instagram twin. They
    keep their poster and say so; there is no permission to add that fixes them
    short of Advanced Access review.
    """
    url = f"https://graph.facebook.com/{API_VERSION}/{media_id}"
    try:
        d = get_json(url, {"fields": "id,media_type,media_url,thumbnail_url",
                           "access_token": token})
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print(f"    ! instagram media {media_id} unreadable: {e}", file=sys.stderr)
        return None
    if not d.get("media_url"):
        return None
    return {"source": d["media_url"], "poster": d.get("thumbnail_url")}


def _mp4_boxes(buf: bytes, start: int, end: int):
    """Yield (kind, offset, size) for each box between two offsets."""
    i = start
    while i + 8 <= end:
        size = int.from_bytes(buf[i:i + 4], "big")
        kind = buf[i + 4:i + 8]
        if size == 1:                                   # 64-bit extended size
            size = int.from_bytes(buf[i + 8:i + 16], "big")
        if size < 8:
            return
        yield kind, i, size
        i += size


def mp4_dimensions(blob: bytes) -> tuple[int, int] | None:
    """
    Pixel width and height, from the first video track's `tkhd` box.

    ── Why this is stored rather than measured in the browser ────────────────
    The detail panel sizes its player to the creative's real shape. Waiting for
    the browser to report it means the box has no height until the metadata
    loads, and the panel visibly reflows under the reader — on a `preload=none`
    video, not until they press play. Two integers in the row remove that
    entirely.

    `tkhd` carries width and height as 16.16 fixed-point, after a header whose
    length depends on the box version. A rotated portrait video records its
    dimensions landscape and puts the rotation in the transform matrix, so the
    matrix is read too — otherwise every vertical creative would be described as
    horizontal, which is exactly the shape this whole change is about.
    """
    try:
        for kind, off, size in _mp4_boxes(blob, 0, len(blob)):
            if kind != b"moov":
                continue
            for k2, o2, s2 in _mp4_boxes(blob, off + 8, off + size):
                if k2 != b"trak":
                    continue
                for k3, o3, _ in _mp4_boxes(blob, o2 + 8, o2 + s2):
                    if k3 != b"tkhd":
                        continue
                    version = blob[o3 + 8]
                    after_times = o3 + 12 + (32 if version == 1 else 20)
                    matrix = after_times + 16
                    # a and d of the 3x3 matrix; a 90 degree rotation zeroes
                    # both and puts the scale in b and c instead.
                    a = int.from_bytes(blob[matrix:matrix + 4], "big")
                    d = int.from_bytes(blob[matrix + 20:matrix + 24], "big")
                    dims = matrix + 36
                    w = int.from_bytes(blob[dims:dims + 4], "big") / 65536
                    h = int.from_bytes(blob[dims + 4:dims + 8], "big") / 65536
                    if not (w and h):
                        continue
                    if a == 0 and d == 0:               # rotated a quarter turn
                        w, h = h, w
                    return int(round(w)), int(round(h))
    except (IndexError, ValueError):
        return None
    return None


def image_dimensions(blob: bytes) -> tuple[int, int] | None:
    """
    Pixel size of an image. Pillow only reads the header for this.

    Returns None for a 64x64, because that is not an image size — it is Meta's
    `thumbnail_url`, which is a fixed SQUARE CROP of whatever the creative is
    (`stp=...p64x64...` in the URL). Reading a shape off it describes every
    vertical video as 1:1, which is the exact defect this column exists to fix,
    restated with more confidence. No creative is deliberately 64 pixels.
    """
    try:
        from PIL import Image  # noqa: PLC0415 — optional dependency by design
        size = Image.open(io.BytesIO(blob)).size
        return None if size == (64, 64) else size
    except Exception:
        return None


def dimensions_of_stored(storage, name: str) -> tuple[int, int] | None:
    """
    The shape of an object already in our bucket, without fetching all of it.

    A re-run skips downloading an asset it has already mirrored, which is right
    — and it left those rows with no shape, or with one read off the 64px square
    poster. The header is enough to answer, and it is a range request: 256 KB
    covers an mp4's `ftyp`+`moov` (the mirrored files are faststart, moov first)
    and any image's header several times over.
    """
    try:
        blob = storage.bucket(BUCKET).blob(name)
        head = blob.download_as_bytes(start=0, end=256 * 1024 - 1)
    except Exception as e:                              # noqa: BLE001
        print(f"    ! could not read {name} for its size: {e}", file=sys.stderr)
        return None
    return mp4_dimensions(head) if name.endswith(".mp4") else image_dimensions(head)


def mp4_duration(blob: bytes) -> float | None:
    """
    Seconds, read out of the file's own `mvhd` box.

    The ad account's video catalogue carries `length`; an Instagram media
    object does not, and the retention curve and the scrub bar both need it —
    without a length the panel silently drops the one chart that says whether
    people watched. The header is enough to find it: walk the top-level boxes
    to `moov`, then its first child `mvhd`, and divide duration by timescale.
    No decoding, no dependency.
    """
    def walk(buf: bytes, start: int, end: int, want: bytes) -> int | None:
        for kind, off, _ in _mp4_boxes(buf, start, end):
            if kind == want:
                return off
        return None

    try:
        moov = walk(blob, 0, len(blob), b"moov")
        if moov is None:
            return None
        head = moov + 8
        mvhd = walk(blob, head, len(blob), b"mvhd")
        if mvhd is None:
            return None
        version = blob[mvhd + 8]
        off = mvhd + 12 + (16 if version == 1 else 8)
        if version == 1:
            timescale = int.from_bytes(blob[off:off + 4], "big")
            duration = int.from_bytes(blob[off + 4:off + 12], "big")
        else:
            timescale = int.from_bytes(blob[off:off + 4], "big")
            duration = int.from_bytes(blob[off + 4:off + 8], "big")
        return round(duration / timescale, 2) if timescale else None
    except (IndexError, ValueError, ZeroDivisionError):
        return None


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
                {"fields": f"{AD_FIELDS},{CREATIVE_FIELDS}", "access_token": token},
            )
        except (urllib.error.HTTPError, urllib.error.URLError) as e:
            # A deleted ad still has insight rows. Skipping keeps the run going.
            print(f"    ! {ad_id}: creative read failed ({e})", file=sys.stderr)
            continue
        c = payload.get("creative")
        if not c:
            continue
        # Carried on the creative dict so pass two has one thing to read. They
        # are the ad's fields, not the creative's, hence the underscore prefix.
        c["_adset"] = payload.get("adset") or {}
        c["_campaign"] = payload.get("campaign") or {}
        c["_effective_status"] = payload.get("effective_status")
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
    # One video often backs several ads. Remember its length so the second ad
    # to reference it is not left without a retention curve just because the
    # first one already put the file in the bucket.
    lengths: dict[str, float] = {}
    for ad_id, c in creatives.items():
        kind, video_id, image_ref = pick_asset(c)
        asset_uri = thumb_uri = None
        asset_bytes = video_len = None
        # The creative's true shape. Read from the asset itself wherever one is
        # downloaded, and from the poster otherwise — a poster always shares the
        # creative's aspect, so even the videos whose source is unreachable
        # still describe themselves correctly.
        dims: tuple[int, int] | None = None
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
            video_len = meta.get("length") or lengths.get(video_id)
            key = f"{client_id}/video/{video_id}.mp4"
            source = meta.get("source")
            # Not on the ad account: promoted from Instagram, so ask Instagram.
            # See ig_media() — this is the path that makes most video ads
            # playable at all.
            if not source:
                ig_id = (c.get("effective_instagram_media_id")
                         or c.get("source_instagram_media_id"))
                if ig_id:
                    found = ig_media(str(ig_id), token)
                    if found:
                        source = found["source"]
                        meta = {**meta, "poster": meta.get("poster") or found["poster"]}
            if key in have:
                asset_uri = f"gs://{BUCKET}/{key}"
                dims = dims or dimensions_of_stored(storage, key)
            elif source:
                blob = get_bytes(source)
                if blob:
                    asset_uri = upload(storage, key, blob, "video/mp4")
                    asset_bytes = len(blob)
                    dims = dims or mp4_dimensions(blob)
                    video_len = video_len or mp4_duration(blob)
                    if video_len:
                        lengths[video_id] = float(video_len)
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
                dims = dims or dimensions_of_stored(storage, key)
            elif src:
                blob = get_bytes(src)
                if blob:
                    asset_uri = upload(storage, key, blob, "image/jpeg")
                    asset_bytes = len(blob)
                    dims = dims or image_dimensions(blob)
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
                dims = dims or image_dimensions(blob)
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
            "adset_id": (c.get("_adset") or {}).get("id"),
            "adset_name": (c.get("_adset") or {}).get("name"),
            "campaign_id": (c.get("_campaign") or {}).get("id"),
            "campaign_name": (c.get("_campaign") or {}).get("name"),
            "effective_status": c.get("_effective_status"),
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
            "asset_width": int(dims[0]) if dims else None,
            "asset_height": int(dims[1]) if dims else None,
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
