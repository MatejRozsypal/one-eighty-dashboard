# 33. Creative assets mirror on a schedule

> Replaces the "Cloud Run job" that runbook 29 step 2 proposed and that was
> never created. `infra/creative_assets_job.py` now runs from GitHub Actions
> every 2 hours (`.github/workflows/creative-assets.yml`). Everything below is
> owner work in the Google Cloud console / Cloud Shell and in GitHub settings;
> the repository side is done.

## 0. Why GitHub Actions and not Cloud Run

Nothing for Cloud Run exists yet: no job, no image, no Artifact Registry repo,
no Cloud Scheduler. A Cloud Run job would need all four plus a Dockerfile and a
deploy step on every change to the script. The Actions workflow runs the file
straight from `main`, so a merged change is live on the next run, and the run
log sits next to the code. Cost: one run is a few minutes; 12 runs a day is
roughly 400 to 800 Actions minutes a month, inside the 2,000 free minutes of a
private repository on the Free plan (unlimited on a public one).

The n8n VPS stays out of it for the reason the script's docstring gives: it
pulls 15 MB binaries.

## 1. What the schedule does

| | |
|---|---|
| When | `40 */2 * * *` UTC, clear of the hourly `:15` Meta insights load |
| What | every active client with `has_meta = TRUE` in `ref.clients` (today dobias, ethia, manami, venev) |
| Which ads | delivering ads (spend > 0, last 18 months) with no creative row or no `asset_uri` |
| Failure | one client failing does not stop the others; the run ends red so GitHub emails the owner |
| Manual run | Actions, "Creative assets mirror", Run workflow, optional `args` (`--reshape`, `--all`, `manami`) |

## 2. Service account and IAM (Cloud Shell, about 10 minutes)

A dedicated service account, so the mirror's rights are exactly the mirror's.
Run in Cloud Shell (gcloud is not installed on the Mac).

```bash
PROJECT=oneeighty-warehouse
SA=sa-creative-mirror@$PROJECT.iam.gserviceaccount.com

gcloud iam service-accounts create sa-creative-mirror \
  --project=$PROJECT --display-name="Creative assets mirror (GitHub Actions)"

# BigQuery: run query and load jobs in the project
gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA" --role=roles/bigquery.jobUser

# BigQuery: append to raw.raw_meta_ad_creatives (and read the raw tables the
# stg views select from)
bq add-iam-policy-binding --member="serviceAccount:$SA" \
  --role=roles/bigquery.dataEditor $PROJECT:raw

# BigQuery: read stg.stg_meta_ad_insights, stg.stg_meta_ad_creatives, ref.clients
bq add-iam-policy-binding --member="serviceAccount:$SA" \
  --role=roles/bigquery.dataViewer $PROJECT:stg
bq add-iam-policy-binding --member="serviceAccount:$SA" \
  --role=roles/bigquery.dataViewer $PROJECT:ref

# GCS: list, read, write and overwrite objects in the creatives bucket
gcloud storage buckets add-iam-policy-binding gs://oneeighty-creatives \
  --member="serviceAccount:$SA" --role=roles/storage.objectAdmin

# Secret Manager: the two Meta secrets per client, nothing else
for slug in dobias ethia manami venev; do
  for s in meta-$slug-access-token meta-$slug-ad-account-id; do
    gcloud secrets add-iam-policy-binding $s --project=$PROJECT \
      --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
  done
done
```

A client added later needs its two `meta-<slug>-*` secrets granted the same
way, or its run fails with `PermissionDenied` (the other clients still run).

## 3. Give GitHub the identity. Pick ONE.

### 3a. Workload Identity Federation (preferred, no key exists anywhere)

```bash
PROJECT=oneeighty-warehouse
PROJECT_NUMBER=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
SA=sa-creative-mirror@$PROJECT.iam.gserviceaccount.com
REPO=MatejRozsypal/one-eighty-dashboard

gcloud iam workload-identity-pools create github \
  --project=$PROJECT --location=global --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc one-eighty-dashboard \
  --project=$PROJECT --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == '$REPO'"

gcloud iam service-accounts add-iam-policy-binding $SA --project=$PROJECT \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

# The value for the GitHub secret below:
echo "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/one-eighty-dashboard"
```

GitHub, repository Settings, Secrets and variables, Actions, New repository secret:

| Secret | Value |
|---|---|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | the `projects/<number>/locations/global/workloadIdentityPools/github/providers/one-eighty-dashboard` line printed above |
| `GCP_SERVICE_ACCOUNT` | `sa-creative-mirror@oneeighty-warehouse.iam.gserviceaccount.com` |

### 3b. JSON key (if the organisation policy blocks Workload Identity)

Service Accounts, `sa-creative-mirror`, Keys, Add key, JSON. Paste the whole
file into one repository secret and delete the download:

| Secret | Value |
|---|---|
| `GCP_SA_KEY` | the full JSON key file |

If both are configured, the workflow uses Workload Identity.

## 4. Turn it on

1. Merge the branch that adds `.github/workflows/creative-assets.yml` to
   `main`. Scheduled workflows only run from the default branch.
2. Actions tab, "Creative assets mirror", **Run workflow** with empty `args`.
   This is the backfill: it mirrors every ad that has delivered since the last
   by-hand run (on 2026-10-08: 30 ads first seen since 2026-10-05 with no row
   at all, 101 delivering ads missing a row or an asset in total).
3. Run it once more with `args` = `--reshape`. This re-fetches the video ads
   whose stored file is not vertical although the creative lists more than one
   video (26 ads on 2026-10-08), so the new 9:16 preference applies to them.
   Ads that really only have a square cut resolve to the object already in the
   bucket and download nothing. One run is enough; the schedule never needs it.
4. Verify (section 6). From then on it runs by itself every 2 hours.

## 5. Which video the job picks (2026-10-08)

For a video ad the job mirrors the **9:16 Stories / Reels cut** wherever the
creative has one, so the whole frame is visible in the player:

1. a customization rule whose positions are Stories / Reels only;
2. failing that, the shape: the candidate whose width / height is closest to
   0.5625, read from the ad account video catalogue's thumbnails, our own
   mirrored copy, or the small frame `asset_feed_spec` lists per video;
3. failing that, the catch-all rule of a placement-customised ad. Ads Manager
   writes those ads as "rule 1 = feed positions, rule 2 = everything else",
   and everything else is Stories and Reels;
4. a single-video creative keeps its one video.

Images keep the feed asset (unchanged). The thumbnail is built from the chosen
video's own poster, so tile and player agree.

One limit: a video promoted from Instagram and absent from the ad account
catalogue can only be downloaded through the Instagram post, which is one
file. On a multi-cut ad that file is stored under the post's id
(`<client>/video/ig<media_id>.mp4`) rather than the picked video's id, so a
square file can never sit behind a vertical id.

## 6. Verify

```sql
-- every ad that started delivering since the last run now has a row
WITH first_seen AS (
  SELECT client_id, ad_id, MIN(date_start) AS first_day
  FROM `oneeighty-warehouse.stg.stg_meta_ad_insights`
  WHERE date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 18 MONTH) AND spend > 0
  GROUP BY 1, 2
)
SELECT f.client_id, COUNT(*) AS new_ads,
       COUNTIF(c.ad_id IS NOT NULL) AS with_row,
       COUNTIF(c.asset_uri IS NOT NULL) AS with_asset,
       COUNTIF(c.thumb_uri IS NOT NULL) AS with_thumb,
       COUNTIF(c.body IS NOT NULL) AS with_copy
FROM first_seen f
LEFT JOIN `oneeighty-warehouse.stg.stg_meta_ad_creatives` c USING (client_id, ad_id)
WHERE f.first_day >= '2026-10-05'
GROUP BY 1 ORDER BY 1;

-- video shapes: vertical should dominate, squares should be the 1:1-only uploads
SELECT client_id,
       COUNTIF(SAFE_DIVIDE(asset_width, asset_height) < 0.7)            AS vertical,
       COUNTIF(SAFE_DIVIDE(asset_width, asset_height) BETWEEN 0.7 AND 0.9) AS four_five,
       COUNTIF(SAFE_DIVIDE(asset_width, asset_height) BETWEEN 0.9 AND 1.1) AS square,
       COUNTIF(asset_width IS NULL)                                      AS unknown
FROM `oneeighty-warehouse.stg.stg_meta_ad_creatives`
WHERE asset_kind = 'video'
GROUP BY 1 ORDER BY 1;
```

Baseline before the change (2026-10-08, latest row per ad):

| client | video ads | 9:16 | 1:1 | no shape |
|---|---|---|---|---|
| dobias | 12 | 6 | 6 | 0 |
| ethia | 56 | 51 | 2 | 3 |
| manami | 70 | 56 | 10 | 4 |
| venev | 3 | 1 | 2 | 0 |

Of the 20 squares, 10 are placement-customised ads whose catch-all cut is the
vertical one (dobias 6, manami 4): those are what `--reshape` should flip. The
other 10 are Advantage+ ads whose two ids (`creative.video_id` and
`video_data.video_id`) are the same upload. On Ethia both are 1:1 uploads
(`lars_founderad_01_1x1_captions.mp4`, `cropped_1X1_...mov`, checked in the Ads
API); Manami's six and Venev's two have not been checked file by file. Where
the original is 1:1 they stay square, because no vertical file exists.

## 7. Running it by hand

Still works, now with either the Secret Manager Python client or the gcloud CLI:

```bash
pip install -r infra/requirements-creative-assets.txt
gcloud auth application-default login            # once per machine
python3 infra/creative_assets_job.py [client_id ...] [--all | --reshape]
```
