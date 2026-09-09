# 28. Meta creative assets, ad copy and breakdowns

> Adds the visual layer and the ad detail data. Extends
> `infra/n8n/wf_meta_ads_to_bigquery.json` and adds one new job.
> API version stays pinned at **v22.0**, as it is in the existing workflow's `Decode secrets` node.

---

## 1. Extra fields on the existing ad-insights call

The workflow's `Fetch ad insights` node already runs at `level=ad`, `time_increment=1`. Append to its
`fields` list:

```
video_avg_time_watched_actions
video_p25_watched_actions
video_p50_watched_actions
video_p75_watched_actions
video_p95_watched_actions
video_p100_watched_actions
video_30_sec_watched_actions
outbound_clicks
unique_outbound_clicks
```

Add matching columns to `raw.raw_meta_ad_insights` with `ALTER TABLE ADD COLUMN`. They are all
`ARRAY<STRUCT<action_type STRING, value NUMERIC>>` in the API response and flatten to `INT64`
(seconds for the average-time field). Follow the existing flatten transform, which already handles
`omni_purchase ?? purchase`.

**This gives a real retention curve.** Eight points: play, 3s, 25%, 50%, 15s thruplay, 75%, 95%,
100%. No estimation from hook and hold rate is needed, and the ad detail panel draws exactly these.

Backfill is not possible for the video quartiles beyond Meta's ~37-month insights retention wall
(`infra/meta_backfill.py`, `MAX_MONTHS = 37`). Older ads will have nulls. Render the curve only when
`video_play_actions` is present, never a partial curve.

## 2. Creatives and ad copy

New nightly job. One call per ad that is not already stored.

```
GET /v22.0/{ad_id}
  ?fields=creative{id,object_type,object_story_spec,asset_feed_spec,title,body,
                   call_to_action_type,image_hash,image_url,video_id,
                   thumbnail_url,effective_object_story_id}
```

> **Corrected 9 Sep 2026 against the live account.** This section, and
> `CREATIVE_ENGINE_BRIEF.md` section 5b, both specified
> `GET /{ad_id}/adcreative`. That is not a valid edge — every call returns
> `Unknown path components: /adcreative`. The `adcreatives` edge belongs to an
> ad ACCOUNT; on an ad the creative is a nested FIELD. `link_description` is
> also not a field of adcreative and 400s the whole request; the description
> lives at `object_story_spec.link_data.description`.

### What Manami's account actually contains

Sampled across the fourteen highest-spend ads:

| object_type | count | image_hash | video_id | thumbnail_url |
|---|---|---|---|---|
| `SHARE` | 9 | 3 of 9 | none | **all** |
| `VIDEO` | 4 | none | all | **all** |
| `PRIVACY_CHECK_FAIL` | 1 | none | none | **all** |

Most of the account is boosted existing posts, where the creative carries no
`image_hash`, no `video_id` and an empty `object_story_spec` — the media is
listed in `asset_feed_spec` instead, and images there are given as a **hash
with no URL**. Resolve those in one batched call:

```
GET /v22.0/act_{account}/adimages?hashes=["<hash>",…]&fields=hash,url
```

**`thumbnail_url` is the one field every creative has**, whatever its type. Mirror
it first and unconditionally: a wall of real thumbnails is most of the value
here even where the full-size asset cannot be reached.

Copy lives in different places by ad type:

| Ad type | Primary text | Headline | Description |
|---|---|---|---|
| Single image | `object_story_spec.link_data.message` | `.link_data.name` | `.link_data.description` |
| Video | `object_story_spec.video_data.message` | `.video_data.title` | `.video_data.link_description` |
| Advantage+ / dynamic | `asset_feed_spec.bodies[].text` | `asset_feed_spec.titles[].text` | `asset_feed_spec.descriptions[].text` |

The Advantage+ arrays hold **every text variant Meta is rotating**, which is more than Ads Manager
shows in one view. Store the first as the scalar column and the whole array as JSON.

Lands in `raw.raw_meta_ad_creatives` per `CREATIVE_ENGINE_BRIEF.md` section 4.1, plus
`body`, `title`, `link_description`, `call_to_action_type`, `bodies_json`, `titles_json`.

## 3. Asset mirror to GCS

**Meta's `image_url` and `thumbnail_url` are signed and expire within hours.** They cannot be stored
and rendered later. `image_hash` and `video_id` are stable; the URLs are not.

```
bucket: gs://oneeighty-creatives            EU, uniform bucket-level access, not public
path:   {client_id}/{image|video}/{hash_or_video_id}.{ext}
thumb:  {client_id}/thumb/{hash_or_video_id}.webp      400px
```

Per ad, if `(client_id, hash|video_id)` is not already in the bucket:

- **Image**: download `image_url` immediately, in the same run that fetched it.
- **Video**: `GET /v22.0/{video_id}?fields=source,picture,length`. `source` is time-limited and needs
  the video permission on the system user (`runbooks/07_meta_app_and_system_user.md`). If `source`
  is absent, store `picture` as the thumbnail and mark `asset_uri` null rather than failing the run.

  > **Confirmed missing, 9 Sep 2026.** The system user token returns
  > `(#10) Application does not have permission for this action` on every video.
  > Its scopes are `ads_management, ads_read, business_management,
  > pages_show_list, pages_read_engagement, pages_manage_ads, instagram_basic,
  > instagram_manage_insights, instagram_manage_contents, public_profile` —
  > none of which grants video source access. Until that is added, video ads
  > mirror their poster frame and nothing else, and `asset_uri` stays null so
  > the next run retries. No backfill is needed once it is granted.

Write `asset_uri`, `thumb_uri`, `asset_kind` back to `raw_meta_ad_creatives`. Dedupe on the hash, so
a creative reused across ad sets or graduated by post ID stores once.

Serve through signed URLs from the dashboard's service account, or a Cloud CDN backend bucket behind
the app's own auth. **Never make the bucket public**: these are client creatives, some unreleased.

**Sizing.** Manami produces roughly 30 assets a month. Video at ~15 MB and statics at ~0,5 MB is
about 160 MB a month, under 2 GB per client per year. Three clients over five years costs under
$10/month on GCS Standard EU. This is a rounding error; do not over-engineer it.

Run the downloads on Cloud Run rather than in n8n. n8n on the Hostinger VPS should not be pulling
15 MB binaries, and `n8n-instance-health` in memory is a standing reminder that this box falls over.

## 4. Ad set insights

`raw.raw_meta_adset_insights` does not exist. Ad-set grain is where every money verdict is made, and
today it can only be reconstructed by summing ad rows, which loses `adset_name` and any ad set with
delivery but no ad rows. Add a third insights call at `level=adset` with the same field list as
campaign, plus `adset_id`, `adset_name`, `campaign_id`.

## 5. Breakdowns

Two more calls at `level=ad`, `time_increment=1`. Meta will not return arbitrary breakdown
combinations in one request, so these are separate.

```
breakdowns=age,gender                         -> raw.raw_meta_ad_breakdown_demo
breakdowns=publisher_platform,platform_position -> raw.raw_meta_ad_breakdown_placement
```

Row multiplier is roughly 12x and 8x. On Manami's volume that is a few thousand rows a day.
Partition by `date_start`, cluster by `client_id, ad_id`, `require_partition_filter = TRUE`.

**Constraint to enforce in the UI, not just in the docs.** Purchase counts inside a breakdown are a
fraction of an already small number: one ad split six ways by age has single-digit purchases per
bucket. The panels therefore show **impression and spend distribution by default**, which is
reliable, and gate any purchase-based figure behind the same confidence rules as the rest of the
product. Placement and demographics answer "where is Meta putting this and is that where the buyer
is", not "which age group has better ROAS". The monthly Fastest Horse breakdowns in
`agency/_processes/meta-creative-engine/07-analyzing.md` run at account level for exactly this reason.

## 6. Schedule and cost

Append to the existing hourly `:15` workflow for the extra insight fields. Creatives, assets and
breakdowns run once nightly; they change slowly and the asset mirror is the only expensive step.

Log to `ops.pipeline_log` so `runbooks/26_pipeline_freshness_monitoring.md` covers them.

## 7. Verification

```sql
-- retention data is arriving for video ads
SELECT COUNT(*) AS video_ads,
       COUNTIF(video_p50_watched_actions IS NOT NULL) AS with_quartiles
FROM `oneeighty-warehouse.stg.stg_meta_ad_insights`
WHERE client_id='manami' AND date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  AND video_play_actions > 0;

-- every live ad has an asset and copy
SELECT COUNTIF(asset_uri IS NULL) AS no_asset, COUNTIF(body IS NULL) AS no_copy, COUNT(*) AS total
FROM `oneeighty-warehouse.raw.raw_meta_ad_creatives`
WHERE client_id='manami' AND snapshot_date = CURRENT_DATE();

-- breakdown rows reconcile to the base table within rounding
SELECT b.date_start, SUM(b.impressions) AS brk, MAX(a.impressions) AS base
FROM `oneeighty-warehouse.raw.raw_meta_ad_breakdown_placement` b
JOIN `oneeighty-warehouse.stg.stg_meta_ad_insights` a USING (client_id, ad_id, date_start)
WHERE b.client_id='manami' AND b.date_start = DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
GROUP BY 1;
```

The third query is the one that matters. Breakdown sums that do not reconcile to the base table mean
either a wrong attribution setting on one of the calls or double-counted rows from a re-run.
