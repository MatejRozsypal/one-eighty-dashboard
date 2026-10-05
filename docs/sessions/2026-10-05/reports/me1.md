# ME1 report: rpt_ad_launch v2 (migration 255) and C8 investigation

Branch `me1-warehouse`, one commit `1765ed6`, not pushed. Prod deploy of 255 done (approved) after the mart_qa regression passed.

## Files
- `infra/bigquery/255_rpt_ad_launch_v2.sql` (header, procedure, CALL)
- `infra/bigquery/qa/255_regression.sql` (queries and results)
- `infra/bigquery/live/mart.sp_refresh_rpt_ad_launch.sql` (procedure, equals deployed), `live/mart.rpt_ad_launch.sql` (31 column DDL, equals deployed), `live/README.md` (two rows added, deployed)

## What changed in the procedure
- `is_video` = `video_plays / impressions >= 0.30` OR non-empty `video_id` in mart_creative_asset (replaces `video_plays > 0`).
- New columns appended after `refreshed_at`: `video_start_share` FLOAT64, `adset_first_date` DATE (min first_date of the ad set's ads), `is_new_adset` BOOL (first_date <= adset_first_date + 2 days, never NULL).
- All 28 existing columns, order, types, ASSERTs, swap, name and schedule unchanged. Table now 31 columns.

## Verification (mart_qa prefix me1_, then prod; identical)
| Check | Result |
|---|---|
| All other columns vs old logic rebuilt on the same source, EXCEPT DISTINCT both ways | 0 and 0, 459 rows (mart_qa and prod) |
| vs the table deployed that morning | 16 ads differ by cents in spend/impressions and prior_roas in the 5th to 7th digit: Meta restated 2026-10-04 between builds. Not logic. Hence the same-hour rebuild as baseline |
| is_video changes | 60 ads old true to new false, 0 the other way. Dobias 4, Ethia 17, Manami 35, Venev 4. Leaving ads average start share 0.016 to 0.039 (carousel/banner auto plays) |
| Reclassified in the 12 month cohort (not pre-existing, not relaunch) | Ethia 15, Manami 25 (26 with first_date >= 2025-10-01), Dobias 0, Venev 4. Audit said about 14 and 24. Video asset rule keeps 4 Manami ads video; it cannot help Ethia (0 asset rows) |
| Launch context, cohort first_date > 2025-10-01 | Dobias 31 new / 4 existing, Ethia 64 / 92, Manami 65 / 55, Venev 9 / 0: exactly audit 2.6. Pack level (new ad sets): Dobias 15, Ethia 14, Manami 31: exactly audit 3.4 |
| Note on Manami 67 vs 65 | first_date >= 2025-10-01 adds 2 Manami ads dated 2025-10-01 (design table 122 launched); the audit window excluded them (120) |
| Sanity on prod | 31 columns, 0 dups, no `__next` left, 0 NULL flags, adset_first_date <= first_date everywhere |
| Prod objects equal files | table DDL md5 `e9c4f508574e04396d1826f062066db5`; procedure body (BEGIN..END;) md5 `65a043b8969cfe1af39e3bfa13ae12df` |
| CALL cost | 299 MB processed, 310 MB billed, inside the 90 s sync window (both mart_qa and prod) |
Not re-tested: the ASSERT failure path (code unchanged, tested in 254, qa/254 section 5). The mart_qa candidate procedure had comments and descriptions stripped; prod used the exact file text.

## Deployed to prod
1. CREATE OR REPLACE PROCEDURE mart.sp_refresh_rpt_ad_launch (file text)
2. CALL mart.sp_refresh_rpt_ad_launch (459 rows, 31 columns)
Nothing else touched. The owner's scheduled query keeps working unchanged (calls by name).

mart_qa objects (delete when done): me1_sp_refresh_rpt_ad_launch, me1_rpt_ad_launch, me1_rpt_ad_launch_before and me1_rpt_ad_launch_oldlogic (both expire in 14 days).

## C8: why mart_creative_asset has 0 rows for Ethia (investigation only, nothing changed)
Facts:
- Registry is fine: `ref.clients` ethia has status active, has_meta TRUE (also has_instagram FALSE, which does not gate the job). No registry flag change is needed.
- Ethia's Meta ad insights ARE flowing (n8n `wf_meta_ads_to_bigquery`, active, hourly, backfill of 20 chunks added 2026-09-21; 161 ad-day rows since 2026-09-01), so the secrets `meta-ethia-access-token` and `meta-ethia-ad-account-id` exist.
- `raw.raw_meta_ad_creatives` has 0 Ethia rows at any date. Its only snapshots are one run on 2026-09-09: Dobias 63 ads, Manami 195, Venev 11. Ethia was onboarded 2026-09-20, after that run.
- Cause: creatives are NOT loaded by n8n. The n8n MCP search for "creative" returns no workflow, and the repo `infra/n8n/wf_meta_creative_nightly.json` (not imported anyway) only loads ad set insights and breakdowns, not creatives. The only loader is `infra/creative_assets_job.py`, a local script run by hand (PROJECT_LOG: "Nothing is scheduled"; runbook 29 proposes a Cloud Run job that was never created). It reads `ref.clients` (active, has_meta) so Ethia is already in scope; it was simply never run since onboarding.
- Same staleness for the others: ads without an asset row, all first delivered after 2026-09-09: Manami 5, Venev 5, Dobias 0 new (1 older).
Exact fix, for the orchestrator/owner (needs the owner's gcloud credentials, writes raw + GCS, so I did not run it):
1. Registry: none.
2. Backfill now: `python3 infra/creative_assets_job.py ethia` (then `manami venev dobias` for the post 09-09 ads). Incremental by design: it fetches only ads delivering in the last 18 months with spend > 0 and no asset row. Ethia: 174 ads (about 77 are video by share), 5 older ads from Feb to Mar 2025 fall outside the 18 month window (irrelevant for the 12 month cohort). Needs Python deps google-cloud-bigquery, google-cloud-storage, optionally Pillow, and `gcloud` auth with Secret Manager and bucket access (`gs://oneeighty-creatives`). Expect a few hundred MB of video in GCS.
3. Branch/schedule: a workflow branch in n8n is the wrong place (the script says so: binaries must not go through the n8n VPS). Create the Cloud Run job from runbook 29 section 2 (or a nightly local cron) running `creative_assets_job.py` for all active Meta clients, after the 02:30 window, so new ads get rows within a day. Without it the video_id rule and relaunch detection go stale for every client again.
4. After the backfill: run `CALL mart.sp_refresh_rpt_ad_launch()` (or wait for the scheduled query). Verify: `SELECT client_id, COUNTIF(asset_key IS NULL) FROM mart.rpt_ad_launch GROUP BY 1` should be near 0 for Ethia (today 179 of 179).
Expected effect on the hit rate (tell ME3/owner): Ethia gets relaunch detection, so some of its 156 launched ads will become `is_relaunch` and leave the cohort (Manami lost 39 of 161 that way), and the video_id rule may flip a few Ethia ads from non-video to video. Ethia counts (64/92, 0 of 64 vs 7 of 92) must be re-read after the backfill.

## Requests to orchestrator
- Owner action for C8 step 2 and 3 above.
- ME3 can rely on the 3 new columns now (prod).
