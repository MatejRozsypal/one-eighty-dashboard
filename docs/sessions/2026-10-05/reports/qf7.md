# QF7 Paid fixes (branch qf7-paid)

Commit: see `git log` on `oe-dash-wt/qf7-paid` (one commit, "QF7 Paid fixes ...").

## Findings covered
- B-08 ad set names: `getMetaAdsets` fallback now left-joins `mart.mart_creative_asset` (latest `adset_name` per ad set). MCP: all Dobias ad sets of campaign 52545975900212 and 10 of 12 Manami ad sets in campaign 120246928041830098 (Sep 2026) resolve. Two Manami ad sets (spend 5,278 and 574 CZK) have no row in the asset mart and fall back to the ID (data gap, not code).
- B-09 hook numerator and classification: `getMetaVideoRates` and `getMetaAds` use `video_views`; an ad is a video ad when `SUM(video_play_actions) > 0` over the period (per ad, whole period); all its impressions are the denominator. MCP, Sep 2026, same definition: dobias 17.3%, ethia 25.9%, manami 11.2%, venev 18.8% (old 52/80/33/55%). QF1 Reports should give the same values, since it uses the same definition.
- B-09 funnel: shares above 100% render "n/a" (`funnelShare` in `lib/paid/math.ts`, `nonSequential` prop on `Funnel`). Fixture: Dobias-shaped 129 payment info then 345 purchases shows no "267.4%".
- B-03 (Paid side): `creativeHref` field is now `campaignId`; campaign rows link `focus=campaignId&is=<campaign_id>`. Needs QF8 (accepts `focus=campaignId`); merge after QF8.
- B-10: Meta tab line "Ad account currency: CZK" when the ad account currency differs from the client currency.
- B-11: Overview total row is "Shop total"; its ROAS and CPA cells carry "MER" and "CAC" tags; header info explains both.
- B-18: landing pages query excludes `/orders`, `/checkouts`, `/cart` (optional locale prefix). MCP: Dobias top landing pages for 30d no longer include them (34 path rows / 42 sessions removed for Dobias and Manami). Meta share and Google share columns only appear for connected platforms.
- B-19: `app/(app)/paid/loading.tsx` draws its own frame (header and control strip inside `page-frame`) with 8 KPI tiles, chart, table.
- B-20 (Paid part): lock emoji segments removed (Meta Audience, Google PMax terms), stray "Creatives" link removed from the Meta tab. Diagnosis text duplicate is Creative (QF8).
- B-04: not touched. Per plan it is fixed in AppLink/navigate (QF4); no Paid call site needed a change.

## Verification
- `npm run type-check`, `npm run build`: clean.
- `npm run check:paid` 203/203 (new: funnelShare, Funnel render with n/a, hook rate sums, campaignId link), `check:loading` 203/203, `check:capabilities` 329/329.
- MCP read-only SQL runs listed above. No BigQuery writes.
- Not run in a browser (no login).

## Requests to orchestrator
1. Deviation: I edited `components/dashboard/Funnel.tsx` (not owned by any package). Change is additive: optional `nonSequential` prop, default behaviour unchanged, plus a step whose previous value is 0 now shows "n/a of previous" instead of "top of funnel". GA4 funnel unaffected otherwise. Revert-safe if it conflicts.
2. `lib/metrics.ts` "Hook rate" definition still says "Video plays / impressions". Should read "3-second video plays / impressions" (QF8 or whoever owns it).
3. `components/ui/Skeleton.tsx`: `SkeletonHeader` and `SkeletonControls` do not wrap content in `page-frame`, which is the shared cause of the layout shift on all pages; I worked around it only in the Paid loading file.
4. `lib/demo/paidMeta.ts` still builds `VideoSums.plays` and `MetaAdRow.videoPlays`; those fields now mean 3-second plays (names kept to avoid touching the demo file). `MetaAdRow.isVideo` is optional for the same reason.
5. `SegmentedControl` still renders the lock emoji for disabled segments (shared file); Paid no longer uses disabled segments.
6. `check:paid` runs `scripts/check-paid-math.ts` (there is no `scripts/check-paid.ts`).
