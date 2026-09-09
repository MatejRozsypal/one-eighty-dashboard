# 29. Creative Engine rollout

> Everything that has to happen outside the repository, in the order it has to
> happen. The code is written and committed; none of it is applied.
>
> Each step says what it unlocks, so a half-finished rollout still produces
> something rather than nothing. The screens are built to degrade honestly:
> before any of this they render an explicit "not ingested yet" rather than
> zeroes.
>
> Prerequisite reading: `CREATIVE_ENGINE_BRIEF.md`, `runbooks/27`, `runbooks/28`.

---

## 0. What is already true

Verified against the live workspace and the repository on 9 Sep 2026:

| | |
|---|---|
| Warehouse objects | none of them exist. Six migration files are written and unapplied |
| GCS bucket | `gs://oneeighty-creatives` does not exist |
| ClickUp token | no `clickup-api-token` secret |
| n8n | two new workflow files, neither imported |
| Dashboard | five screens built, behind the rail's Creative icon, agency and admin only |
| Thresholds | no client has a kill line, so every screen shows delivery and refuses to issue a verdict |

---

## 1. Warehouse — 20 minutes, unlocks everything

Run in order. Each is idempotent.

```bash
cd infra/bigquery
for f in 219_create_raw_meta_creatives.sql \
         220_create_raw_clickup.sql \
         221_create_ref_creative_tags.sql \
         222_stg_creative_views.sql \
         223_mart_creative.sql \
         224_sp_rebuild_creative_tags.sql; do
  echo "== $f"; bq query --use_legacy_sql=false --project_id=oneeighty-warehouse < "$f" || break
done
```

> `219` ends in an `ALTER TABLE` that adds nine columns to
> `raw_meta_ad_insights`. **It has to run before the Meta workflow is patched in
> step 3**, or every insert fails on an unknown field and the hourly load starts
> erroring.

### Authorize the new datasets

`runbooks/22` explains why this is not optional and why forgetting it produces
`Access Denied` on one view while every other view works. Nothing new is needed
— `mart`, `stg`, `ref` and `raw` are already authorized — but re-run the block
in runbook 22 if any of the new views 403.

### Verify

```sql
-- every object exists
SELECT table_name FROM `oneeighty-warehouse.mart.INFORMATION_SCHEMA.TABLES`
WHERE table_name LIKE 'mart_creative%' OR table_name = 'mart_clickup_ad_tasks';
-- expect 9 rows
```

---

## 2. Creative assets — 30 minutes, unlocks the images

**Needs your Google Cloud console.**

```bash
# EU, uniform access, NOT public: these are client creatives and some are
# unreleased. The path is guessable from the client slug and the Meta hash.
gcloud storage buckets create gs://oneeighty-creatives \
  --project=oneeighty-warehouse --location=eu \
  --uniform-bucket-level-access

# The Cloud Run job writes.
gcloud storage buckets add-iam-policy-binding gs://oneeighty-creatives \
  --member="serviceAccount:<the job's SA>" --role=roles/storage.objectAdmin

# The dashboard reads, and signs URLs with its own key.
gcloud storage buckets add-iam-policy-binding gs://oneeighty-creatives \
  --member="serviceAccount:sa-frontend-reader@oneeighty-warehouse.iam.gserviceaccount.com" \
  --role=roles/storage.objectViewer
```

`sa-frontend-reader` also needs `roles/iam.serviceAccountTokenCreator` **on
itself** to sign V4 URLs. Without it the grid renders placeholder tiles saying
"no asset" — which is honest, and not what you want.

Then run the mirror once by hand before scheduling it:

```bash
python3 infra/creative_assets_job.py manami
```

**Video needs the video permission on the Meta system user**
(`runbooks/07_meta_app_and_system_user.md`). Without it the job stores the
poster frame, leaves `asset_uri` null, and retries on every later run — so
granting the permission later needs no backfill.

---

## 3. Meta ingestion — 20 minutes, unlocks retention and breakdowns

### 3a. Patch the hourly workflow. Do NOT import the repo copy.

The committed `wf_meta_ads_to_bigquery.json` is **stale against live**. Live
carries a rolling ~35-day re-fetch window that was never pushed to git; the
committed "Plan execution" node still fetches yesterday only. Importing it
would silently revert that fix, and the hole it closed was 58% of Meta spend
missing from the warehouse with nothing alerting on it.

```bash
# 1. n8n → wf_meta_ads_to_bigquery → ⋯ → Download
# 2. patch the export
python3 infra/n8n/patch_meta_creative_fields.py ~/Downloads/wf_meta_ads.json /tmp/patched.json
# 3. n8n → Import from File → /tmp/patched.json
```

The script touches two nodes, refuses to run if it does not recognise them, and
is idempotent.

### 3b. Import the nightly workflow

`infra/n8n/wf_meta_creative_nightly.json` — ad-set insights plus the age/gender
and placement breakdowns. Runs at 02:30. Needs the same Google credential the
Meta workflow uses. Activate it after one successful manual run.

### Verify

```sql
-- quartiles arriving on video ads
SELECT COUNTIF(video_p50_watched IS NOT NULL) AS with_quartiles, COUNT(*) AS video_ads
FROM `oneeighty-warehouse.stg.stg_meta_ad_insights`
WHERE client_id='manami' AND date_start >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  AND video_play_actions > 0;

-- breakdown rows reconcile to the base table. THE ONE THAT MATTERS: sums that
-- do not reconcile mean a wrong attribution setting on one of the calls, or
-- double-counted rows from a re-run.
SELECT b.date_start, SUM(b.impressions) AS brk, MAX(a.impressions) AS base
FROM `oneeighty-warehouse.raw.raw_meta_ad_breakdown_placement` b
JOIN `oneeighty-warehouse.stg.stg_meta_ad_insights` a USING (client_id, ad_id, date_start)
WHERE b.client_id='manami' AND b.date_start = DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY)
GROUP BY 1;
```

---

## 4. ClickUp — the phase everything else depends on

### 4a. Fields to create — YOUR DECISION, and one correction to the brief

Read against the live workspace on 9 Sep 2026. The brief's section 3 list is
mostly right; three items are not.

**On `<Client>: Ad pipeline`, create at SPACE level so they stay shared:**

| Field | Type | Values |
|---|---|---|
| `Production method` | dropdown | Internal studio, AI generated, UGC, Influencer, Agency |
| `Creator` | dropdown | the named creators |
| `Creator type` | dropdown | Agency, Brand employee, UGC creator, Influencer |
| `Body` | short text | `b1`, `b2` |
| `Hook` | short text | `h1` … `h10` |
| `Production cost` | number | in the client's currency |
| `Brief` | url | link to the brief doc |
| **`Funnel stage`** | dropdown | **TOF, MOF, BOF** |

**`Funnel stage` is the correction.** The brief assumed `Content Purpose` held
it. It does not — its options are `Net-new`, `Offer-Promo`, `Winner Variant`,
which is production type. Until a real stage field exists the sync parses
TOF/MOF/BOF out of the ad name and leaves it null where the name lacks it, so
the Breakdown screen's "Funnel stage" dimension will be thin.

`Content Purpose` turns out to be worth more than the field it was mistaken
for: `Net-new` against `Winner Variant` is exactly the 80/20 split, stated by
whoever briefed the ad. **Keep filling it in.**

**Do NOT add `Offer` to the ad pipeline.** It already exists on the *concept*
list, which is where it belongs — an ad inherits its offer from its concept.
What it needs is its options renamed:

| `Offer` on `<Client>: Concept list` | now | should be |
|---|---|---|
| options | `Option 1`, `Option 2` | Testovací sada, Plná velikost, Promo, Kvíz, Dárek (GWP) |

**`Persona` already exists** on the concept list as a relationship to the
Persona Bank (`9d4d2f1f-5872-4d82-99bb-bde397ffe5c5`). One fewer change than
the brief expected. Set it and `Angle` to single-select.

### 4b. Delete the stale Venev field — confirmed live, do this first

Venev's ad pipeline carries **two** Concept relationships:

| Field | id | points at |
|---|---|---|
| `Concept` | `05c15839-5c8c-4e43-98d5-39f5e4c4e994` | `901523916078` **Manami's concept list. WRONG** |
| `VEN: Concept` | `bcf4d0be-3b8c-46b6-975c-c3958fb5c77c` | `901524795828` correct |

The sync ignores the stale one — it resolves relationships only through
`ref.clickup_field_map`, which pins the correct id — and logs it as
`unmapped_relationship_field` on every run until it is gone. **Delete it
anyway.** A field that attaches one brand's ads to another brand's concepts is
one careless edit away from doing so.

### 4c. Status hygiene — one pass

65 tasks, almost all at `live`, including ads killed in March. This does not
corrupt any number — delivery is read from Meta — but it makes the pipeline
view useless.

### 4d. The token

```bash
gcloud secrets create clickup-api-token --replication-policy=automatic \
  --project=oneeighty-warehouse
printf '%s' 'pk_XXXXXXXX' | gcloud secrets versions add clickup-api-token --data-file=-
```

Grant the n8n service account `roles/secretmanager.secretAccessor` on it, the
same way the Meta secrets are granted. Header is `Authorization: pk_...` with
**no `Bearer` prefix** — adding one returns `OAUTH_019`, which reads like a
scope problem and sends you looking in the wrong place.

The dashboard needs the same token as `CLICKUP_API_TOKEN` in the Vercel
project, for write-back. **Server-side only. Never `NEXT_PUBLIC_`.**

### 4e. Import the sync

`infra/n8n/wf_clickup_to_bigquery.json`. Hourly at `:45`, offset from the Meta
workflow's `:15` so tags land after the delivery data they describe.

### Verify

```sql
-- the placeholder is not being ingested as data
SELECT COUNT(*) AS tagged, COUNTIF(concept_id IS NULL) AS no_concept,
       COUNTIF(ad_id = 'Creative ID') AS placeholder_leak
FROM `oneeighty-warehouse.ref.creative_tags` WHERE client_id = 'manami';

-- cross-client leakage: MUST return zero rows
SELECT * FROM `oneeighty-warehouse.ops.clickup_sync_issues`
WHERE severity = 'error' AND DATE(synced_at) = CURRENT_DATE();

-- the number that gates the Breakdown screen
SELECT * FROM `oneeighty-warehouse.mart.mart_creative_tag_coverage`;
```

---

## 5. Postgres — automatic

`creative_settings`, `production_rates`, `creator_rates`, `decisions` and
`creative_mappings` are created on first use, behind their own guard, so a
mistake in that DDL cannot stop anyone signing in. Nothing to run.

One thing to know: **a kill without a learning note is rejected by a CHECK
constraint**, not by the form. If you ever need to record one without a note,
that is a migration, which is the correct amount of friction.

---

## 6. Thresholds — 5 minutes, and nothing works without it

Settings → pick the client → Creative Engine. Until **kill ROAS, target ROAS
and target CPA** are all set, every creative screen shows delivery and refuses
to issue a verdict.

Manami's figures from `_clients/manami/learnings/meta-ads.md`:

| | |
|---|---|
| Kill ROAS | **1.80** (working line; break-even is 1.46 — Meta over-reports against Shoptet) |
| Target ROAS | 2.50 — **see the open question below** |
| Target CPA | 527 Kč |
| Gross margin | 68.4% |
| Pack budget / day | 860 Kč |
| Per-ad floor / day | 215 Kč |
| No-touch | 14 days |

---

## 7. Deploy

The app is the only thing here that deploys. The migrations, the bucket, the
ClickUp fields and the n8n workflows are all *applied* somewhere else, and none
of them go through Vercel.

```bash
# The Vercel project is linked from dashboard/, not the repo root.
cd dashboard
npx vercel --prod
```

Two things worth repeating from `runbooks/22`: **a `git push` does not deploy** —
production only moves on this command — and the authorized-datasets step is what
stops every page 500ing with `Access Denied` on a table the service account was
never meant to read directly.

Add one environment variable before write-back works:

```bash
npx vercel env add CLICKUP_API_TOKEN production   # the same pk_... as the secret
```

### Order matters

Deploying before step 1 is safe but pointless: every creative screen renders an
honest "not ingested yet" and nothing else. The shortest path to a working
product is **step 1 (migrations) → deploy → step 6 (thresholds)**, because
thresholds are set *in* the deployed app. Assets, Meta fields and ClickUp can
follow at any pace after that; each one lights up more of the same screens.

---

## 8. Decisions only you can take

Listed here rather than assumed, because each changes what the tool says.

1. **Target ROAS of 2.50 may be too high.** Three independent signals say so:
   the account's best ad set posts a CPA 14% better than target while its ROAS
   lands in the iterate zone; no ad clears 2.50 at Read confidence; the blended
   lifetime figure is 2.04. Left at 2.50, the engine will issue ITERATE on
   things that are working. Review before the first Monday review that uses it.

2. **215 Kč or 264 Kč per-ad floor.** The learnings file states a 527 Kč median
   CPA and a 215 Kč floor described as 0.5 × CPA, which implies 430. The build
   uses the stated 215 and 860, because they match what PACK6 actually launched
   with — but the two statements cannot both be right.

3. **One test pack at a time?** The velocity maths assumes it. If two can run
   concurrently, ads per pack halves.

4. **`max_ci_halfwidth`, defaulted to 25%.** It decides how often the tool says
   "not separable" instead of answering. Set once per client and do not move it
   to get the answer you wanted.

5. **UGC rates.** The pay-model enum is built and the derivation is implemented;
   the actual numbers are not entered. Until they are, Production ROI prices
   from the per-method rates and says what share of each row was estimated.

6. **Creator pay terms live in Postgres, not `ref.creators`.** The one place
   this build deviates from the brief. They are a manually entered input like
   every other cost assumption here, and the frontend service account is
   read-only on the warehouse, so it could never write them there.

---

## 9. What is deliberately not built

- Facebook Ad Library competitor swipe, Google Ads banners, TikTok — out of
  scope for v1 per the brief.
- Any write to Meta. The tool reads delivery and records decisions; budgets are
  changed in Ads Manager by a person, as the SOP requires.
- A funnel-stage field. See 4a.
