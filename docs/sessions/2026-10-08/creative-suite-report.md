# Creative suite, technical side: report (2026-10-08)

Branch `cs1-creative-mapping`, worktree `oe-dash-wt/cs1-creative-mapping`. Nothing deployed. Warehouse candidates proven in `mart_qa.cs1q_*` and `mart_qa.cs1_*`.

## Diagnosis, corrected

| Handoff said | Verified | Correction |
|---|---|---|
| Sync healthy | Yes | none |
| Statuses sync, problem is UI or per list | Yes, UI | Concepts page never read concept status (`getConcepts` did not select it); "Live concepts" counted concepts with delivery; persona status loaded, never shown |
| Ethia 2 % mapped, `name_exact` fails | Partly | Ethia's 3 ads launched since its ClickUp pipeline exists (2026-09-21) are 3 of 3 matched. The other 176 ran before the pipeline and never had a brief. The real Ethia bug: no `concept_rel` row in the field map, so 0 of 3 had a concept although all 24 ad tasks have Concept filled; and every Ethia concept lost its persona because two fields are both named `Persona` |
| Ethia unmapped 176 > assets 174 | Explained | Unmapped is one row per ad with spend in insights (179 ads); assets come from the creative snapshot, which misses 5 ads |
| RawBark: no lists | Lists exist | `RAW: Meta ads pipeline` 1200620000012321, `RAW: Concept list` 1200620000012320, `RAW: Persona Bank` 1200620000012322, about 20 concepts and 16 personas, one ad task `live`. Meta connection still missing |
| Dobias: no lists | Confirmed | No creative-engine lists in ClickUp at all (Maui Content, Assets, Reporting, Flows only) |
| (not in handoff) | New | `raw.raw_meta_adset_insights` has 0 rows ever: its loader `wf_meta_creative_nightly` was never imported into n8n. Velocity shows 0 packs, decisions table hidden, demo and placement breakdowns empty, for every client |
| (not in handoff) | New | Creatives (thumbnails, copy) load only via `infra/creative_assets_job.py` run by hand, last run 2026-10-05; ads launched since have no creative row |

## What the branch changes

**280_creative_mapping.sql** (procedure `ref.sp_rebuild_creative_tags` replaced; new functions; two views replaced; one column added)
- Relationship fields resolved by target list, not name. Curated rows still win.
- Concept persona read through `persona_rel` only.
- Creative ID used only when it is a real ad id; otherwise reported (`creative_id_not_an_ad`).
- Placeholder-named tasks (`PersonaID-NAME | STAGE ...`) excluded and reported (14 Manami, 1 Venev today).
- Match tiers: creative_id, name_exact, name_normalised (dates, ` - Copy`, STATIC/STAT, spacing), name_market_variant (same brief, other market, market read from the ad), name_date_shifted (date moved after the brief, forward only). Each requires a unique task.
- `mart_creative_unmapped` gains `pipeline_start`, `before_pipeline`.

**280b**: registers RawBark's three lists.

**280c**: `mart_creative_adset_perf` derived from ad-level insights where no native ad set row exists. Spend and purchases reconcile exactly with ad level for all four Meta clients; reach and frequency are n/a in derived rows.

**Dashboard**: ClickUp status chip on concept cards and both bank lists, bank sorted by status; "Live concepts" = live in ClickUp; "Top concept share" no longer reports Untagged as a concept; persona capacity counts personas in play only; unmapped queue and pill exclude pre-pipeline ads.

## Effect (mart_qa against live, 2026-10-08)

| client | ads tagged | with concept | concepts with persona | unmapped, since pipeline |
|---|---|---|---|---|
| ethia | 3 -> 3 | 0 -> 3 | 0 -> 30 | 176 -> 0 (all pre-pipeline) |
| manami | 41 real (+5 phantom) -> 52 | 30 -> 32 | 5 -> 5 | 174 -> 76 |
| venev | 14 -> 15 | 1 -> 1 | 0 -> 0 | 5 -> 4 |

No concept key changed, one row per ad held, the only tags dropped are the 5 phantom ids.

## Deploy order (needs the owner's yes)

Away from :45 to :48 UTC.
1. `280_creative_mapping.sql`, then `CALL ref.sp_rebuild_creative_tags()`.
2. `280b_clickup_lists_rawbark.sql` (RawBark appears after the next hourly sync).
3. `280c_creative_adset_perf_from_ads.sql`.
4. Merge branch to main (frontend reads `before_pipeline` and `status`, so 1 must be live first).
5. Refresh `infra/bigquery/live/` for the changed objects.

## Blocked on the owner

- RawBark Meta: System User with `ads_read` on `act_4229772050472158`, secrets `meta-rawbark-access-token`, `meta-rawbark-ad-account-id` (OWNER_TODO section C). Until then RawBark shows concepts and personas but no ad performance.
- Decide whether to import `wf_meta_creative_nightly` into n8n (adds demo and placement breakdowns and true ad set reach/frequency; the VPS load concern is why creatives were kept out of n8n).
- Schedule `creative_assets_job.py` (Cloud Run job proposed in runbook 29) or keep running it by hand.
- Dobias: create creative-engine lists in ClickUp, or accept no tagging layer.

## For the team in ClickUp (data, not code)

- Venev: 33 of 36 ad tasks have no `VEN: Concept`; concepts' `Persona` field points at Manami's Persona Bank, so no Venev concept has a persona. Point it at `VEN: Persona Bank` and fill it.
- Manami: 14 ad tasks (and 1 Venev task) still named `PersonaID-NAME | STAGE | FORMAT | DATE | vN | MKT`; rename to the ad name. Advent tasks hold 16-digit numbers in Creative ID that are not ad ids; paste the ad id.
- Every client: delete the template-copied relationship fields pointing at other clients' lists (they are ignored now, but listed as sync issues each run).
- RawBark concept list: the `Offer` dropdown still has Manami's options.

## Other findings from the page audit (not fixed here)

- "Net-new share" treats an ad with no production type as net-new (`velocity.ts:202`, `production/page.tsx:134`): every client reads red.
- Production ROI prints 0 where it should print n/a when no cost is entered (`production/page.tsx:262`).
- `getTagCoverage` is unused; the Breakdown gate is page-level.
- Venev: 7 purchases on 85,833 spend all time; worth checking its purchase tracking.
- Dobias: most ad rows lack the attribution-window split and fall back to default attribution.
