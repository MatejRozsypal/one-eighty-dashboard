# WP7 report: Creative product

Branch `wp7-creative`, worktree `oe-dash-wt/wp7-creative`, one commit `42696de` on top of `376392e` (merge of WP1). Frontend only. No warehouse objects, no `mart_qa` objects, nothing to deploy to prod. Only files under `app/(app)/creative/**`, `components/creative/*`, `lib/creative/*` changed (31 files).

## What changed

**Capability guard and Compare**
- `lib/creative/page.ts`: `loadCreativeContext` replaced by `loadCreative(searchParams, { compare? })`, which returns `{status:"not-connected", source}` or `{status:"ready", ctx}`. The guard is `pageAvailability(client, "/creative")` and runs before any query, so a client without Meta costs no BigQuery reads. All five pages return `<CreativeNotConnected title source />` (new, in `primitives.tsx`: Header title + `NotConnected`).
- Compare is opted in only on `/creative` (the only page that reads `ctx.previous`); it also fetches the comparison totals only when asked. The other four pages have no Compare and skip that query.
- Added `<PageControls>` (date range) to `/creative` and `/creative/breakdown`. Both imported or implied it but never rendered it (commit dcd22eb says "every page carries the picker"), so the range could not be changed there. Easy to revert if it was intended.

**Copy (172 strings in scope, 2,412 words before, 1,368 after by the 04 extractor)**
- Of the 1,368, about 367 words are `InfoTip` text and aria-labels (04 counts MOVE as removed), so visible text is about 1,001 words against the 04 target of 1,057 for these files. Per page, extractor "after": Creatives 68, Concepts 105, Breakdown 108, Velocity 106, Production 108, actions 49, AdDetail 193, verdict.ts 188.
- Verdict and diagnosis texts (`verdict.ts`) cut to the 04 proposals ("Needs {n} more spend.", "Still learning (12 of 50).", "Raise budget 20-25%.", "Brief an iteration.", ...). 26 words to 6 for the unjudged text ("Set targets to see verdicts.").
- Removed: every eyebrow/kicker, section subtitle, "ranked by spend"-style caption, footnote, the SourcePill provenance badges in AdDetail (ingested/static/not ingested), pack-model footnotes, "no comparison", KPI micro-captions.
- Moved to tooltips (`info` on `Tile`, MetricCard, SectionHead, DataTable columns; `InfoTip` elsewhere): Winners/Carriers/Losers/Hit rate, velocity gauge targets, pack-spec tile captions, concept stat-line captions, AdDetail metric captions, the tag-coverage explanation, the incomplete-concept explanation, the unmapped-queue explanation.
- Empty states: only `NotConnected`/`NoData`. `data.available === false` shows `NotConnected source="Creative data"` (same mapping as the WP1 wrapper), connected with no rows shows `NoData`. One exception: the grid filter with zero matches shows plain muted "No matches." (not a "no data in range" situation, so I did not reuse `NoData`).
- `NotIngested` and `ThresholdsMissing` wrappers deleted from `primitives.tsx`; call sites use the primitives and `<Notice tone="warning">No verdicts. Set thresholds in Settings.</Notice>`.
- Table placeholders ("unpriced", "no margin set", em dashes) are `n/a` from `NO_VALUE`, muted; the two Production columns that can be `n/a` explain when in a header tooltip.

**Dev vocabulary (server actions)**
- `lib/creative/clickup.ts`: `ClickUpNotConfigured` message is now "ClickUp not connected."; new `clickUpUserMessage(error)` maps to one short line ("ClickUp token rejected.", "Task not found in ClickUp.", "Token cannot access this task.", "ClickUp refused the request.", "Could not reach ClickUp."). `probeClickUp().problem` (shown on Data Health, WP8's page) is now "ClickUp not connected." or the same mapped line. Status codes and response bodies go to `console.error` with a `[creative]` prefix in `actions.ts` and the probe.
- `actions.ts`: all user-facing messages are one short line ("Written to ClickUp.", "Already on the task.", "A kill needs a learning note.", "Give a reason for the override.", "Ad not mapped to a task yet.", "Write failed."). No `CLICKUP_API_TOKEN`, Secret Manager, migration numbers, "SOP", "database".
- The two `process.env.CLICKUP_API_TOKEN` reads in `clickup.ts` are code, not strings in the UI, so they remain; the grep gate regex still matches them (2 hits, see below).

**Formatting (P1-12)**
- `AdDetail.tsx`: removed `CS`/`csDec`/`csPct`/`csCount`/`csMoney`/`csRate*`/`csRoas`, `SYMBOL`, `symbolOf`, `DASH`. Figures now come from the primitives that sit on `lib/format` (`money`, `unitMoney`, `pct`, `ratePct`, `roas`, `count`), so the grid tile and the panel print the same string for the same amount (`CZK 48,210`, `1.5%`, `12%`). Unit costs (CPA, CPM) use 2 decimals under 100. CTR/hook/hold on the cards are 1 decimal (policy), was 2 with a decimal comma. ROAS keeps the small grey "x" unit on the big card; the number is the same string as the grid. Dates use `en-US` (was `en-GB`).
- Other `toLocaleString("en-US")` replaced by `formatNumber`. One locale-qualified `toLocaleString("en-US", {month:"short"})` remains in `velocity.ts` (month label, not a bare call, passes the gate).
- Added `unitMoney` to `primitives.tsx`.

**Untagged**: one constant, `UNTAGGED = "Untagged"` in `lib/creative/model.ts`, used for grouping key and label, the grid filter option, Breakdown, Production ("unattributed" gone) and Concepts ("Untagged legacy creative" gone).

**`focusLabel`**: `adId` -> "Ad", `campaignName` -> "Campaign" (vocabulary.ts). The Creatives page also resolves the chip text for `adId` to the ad name, so `?focus=adId&is=<id>` shows the name, not the id. The grid already filters on any `AdView` key, and both fields exist there.

**Dashed borders (WP1 left it to me): replaced everywhere, no exception.** The verdict chips for "not judged / needs more data / not separable" are now a solid hairline outline (still distinct from the filled verdicts, which is what the dash was doing). The `Tag` placeholder is a solid hairline chip reading `persona: n/a` (was dashed "persona ?"). Same treatment for the concept card "+N" chip and unset Facet, and the "never run" angle tile (AngleCoverage). Reason: the dash carried no information the outline and the `n/a` text do not, and the policy reserves dashed boxes for the empty-state primitives, so a dashed box always means "nothing here".

**Comments**: em dashes (170 in comment lines, plus string ones) and client names ("Manami", "Lukas") removed from comments in owned files.

## Verification
- `npx tsc --noEmit`: exit 0.
- `npm run build`: exit 0 (log `scratchpad/wp7_build.log`).
- Grep gates on owned files (`scratchpad/wp7_gates.sh`): em dash 0, en dash 0, `border-dashed` 0, `bg-[#` 0, any `[#hex]` 0, client names 0, `toLocaleString()` 0, `pageEyebrow(` 0, `eyebrow=` 0, `NotIngested|ThresholdsMissing|cs-CZ|SYMBOL` 0. Dev-vocabulary regex: 2 hits, both `process.env.CLICKUP_API_TOKEN` (code, not a string shown to anyone). Czech characters remain only in comments (matcher accent tests, example ad names).
- Word counts: before/after per file above, from `scratchpad/wp7_count.sh` (extract.py/classify.py logic limited to the three owned trees; baseline taken from `git archive HEAD`).
- Visual check: NOT done (no login from this agent). To check on the dev server: `/creative` shows the date picker with Compare, scorecard tiles with (i) tooltips, grid chips `persona: n/a`; open an ad panel and compare Spend/CPA with its tile; `/creative?focus=adId&is=<id>` chip reads "Ad <name>"; Notes tab with the ClickUp token unset shows one line; RawBark (no Meta) shows the title and "Meta not connected." on all five Creative pages; Concepts "In the bank" block; Velocity gauges with (i).

## New notices needing the lead's OK (closed list, policy 4.7)
1. "Only {pct} of spend is tagged." (Breakdown, tone warning, with an (i) tooltip).
2. "Costs are estimates." (Production, tone warning, with an (i) tooltip).
The third, "No verdicts. Set thresholds in Settings.", is on the list.

## Behaviour changes worth knowing
- Compare no longer shows on Concepts, Breakdown, Velocity, Production (they never used it). Creatives keeps it.
- `/creative` and `/creative/breakdown` gain the date picker (see above).
- Velocity: the "Packs per month" chart and pack spec only lost text; logic untouched. The horizon-table footnote and the section subtitles are gone.
- ROAS interval text is "1.42 to 2.88" (was "1.42 - 2.88" with dashes). Breakdown legend and chart readout labels now share `SEPARATION_LABELS` ("At target", "Under target", "Below kill line", "Cannot tell", "Too little data"); the unused function `separation()` is still unused.
- Verdict chip for a client without lines: label "Not judged", text "Set targets to see verdicts."

## Open issues / requests to orchestrator
1. Data Health (WP8) renders `probeClickUp().problem`; it now receives the short lines above. WP8 may want to render the Creative row without the token name; nothing to change on its side for correctness.
2. `lib/queries/creative.ts` (not owned) still returns `data.missing` (dev object names) and is unused by the UI now; `lib/demo/creative.ts` untouched. Harmless, WP9 can drop `missing` when sweeping.
3. `Tile`/`StatLine`/`Scorecard` gained an `info` prop in `components/creative/primitives.tsx` (owned). If the Paid redesign wants the same pattern it should use `MetricCard`/`InfoTip` from `components/ui`, not these.
4. The grid "No matches." and the DecisionLog `<details>` summary "N recorded decisions" are the only free-text states left that are not primitives; flagging in case the sweep wants them gone.
