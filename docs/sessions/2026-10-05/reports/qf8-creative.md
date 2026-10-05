# QF8 Creative fixes

Branch `qf8-creative` (worktree oe-dash-wt/qf8-creative), one commit on top of main 92ac505. No push, no merge.

## Findings covered
- B-03: Creative accepts `focus=campaignId&is=<id>` (AdView.campaignId, chip label "Campaign", chip text = campaign name). Names for campaign and ad set are filled from `mart.mart_creative_asset` in `loadCreative` (`fillNames`, never overwrites an existing name). Legacy `focus=campaignName` still works and now matches because names are filled. Empty focus state: "No creatives with spend for this filter in this period."
- B-05: "No age or placement data for this period."; modal box top-aligned with min-height min(760px, 100vh-3rem), so tabs no longer jump.
- B-06: new summable component `outboundRows` (COUNTIF outbound_clicks IS NOT NULL, added to the 3 SQL queries). Outbound CTR is null when no clicks and no reported rows; the AdDetail row is hidden.
- B-07: grid row, detail card, ConceptCard, DecisionLog, Breakdown column and chart header read "ROAS (adj.)"; hover/info gives the raw value. `roas()` now uses `formatRatio` ("2.60×", same as Paid); detail card no longer adds a separate unit.
- B-09 (Creative hook): D2 applied. hookRate = video_views / impressions; ad is a video ad only if it had starts over the whole period (videoPlays > 0), else hook is null. Retention curve: 3s point now uses video_views and is omitted when 0.
- B-13: Breakdown banner coverage computed from the period rows on the page (`tagCoverage`, 1 minus Untagged share of the selected dimension). Wording: "Only X% of spend in this period is tagged."
- B-14: integer gridlines (`cadenceTicks`), empty-state sentence in the chart.
- B-15: grid label "CTR (all)" with hover; ROAS formatter unified.
- B-17: new `lib/creative/display.ts` (`cleanPersona`, `noEmDash`) applied in tagsFrom, getPersonas, getConcepts names and AdView.persona.
- B-20 (Creative part): static diagnosis no longer repeats "Judge on CTR" (now "No video metrics. CTR (all) 2.2%.").

## Verification
- tsc clean, `npm run build` clean, `check:creative` (script is scripts/check-creative-engine.ts; no check-creative.ts exists) passes, includes ~40 new assertions (hook numerator, outbound null, fillNames, tagCoverage, ticks incl. rendered LaunchCadence SVG, ROAS formatter, persona cleanup, static diagnosis). check:paid 190/190, check:capabilities 329/329. `check:queries` needs ADC credentials, not run.
- BigQuery read-only, Dobias last 30 days: campaign "CA I PACKS I CBO I 21JULY-26 I OE" id 52545975900212 resolves 14 ads via campaign_id in mart_creative_perf; all 14 get campaign_name from mart_creative_asset (0 missing across 5 campaigns). outbound_rows = 0 and outbound_clicks NULL for all 48 ads. Hook rate (views, over ads with starts) 17.42% vs 51.94% with starts (11 of 48 ads are video).
- No browser harness was run (no login); the AdDetail row hiding and the grid focus are covered by type checks and logic, not a rendered probe.

## Requests to orchestrator
1. `lib/demo/creative.ts` (not owned): `videoCurve` seeds `videoPlays` as the hook numerator. With the new numerator the demo hook tile reads `videoViews` (at(3)), lower than the seed. Seed `videoViews` from the hook rate and make `videoPlays` the larger start figure. Also update the comment on line 180.
2. QF7: switch `lib/paid/links.ts` `creativeHref` focus to `{ field: "campaignId", value: campaignId }` (type `CreativeFocus.field`), merge after QF8.
3. Hook-rate floor default is 20% (`hookRateFloor`, Settings). With 3-second plays, accounts run about 12 to 26%, so more video ads will read "Hook problem". Owner may want to revisit the floor in Settings; not changed here.
4. B-20 Creative default period label ("Oct 3, 2021 to Oct 3, 2026" with a meaningless compare range for preset all) lives in `lib/params` / PageControls, not owned; not done.
5. B-16 (filters in URL) deferred per plan.
