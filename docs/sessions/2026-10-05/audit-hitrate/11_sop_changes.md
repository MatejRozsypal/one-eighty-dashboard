# ME4: Second Brain SOP changes (2026-10-05, dashboard alignment)

Source: `03_audit.md` section 6.3 (E1 to E10) and owner decisions D1 to D6. Backups of every edited file: `/private/tmp/claude-501/-Users-matej-Documents--One-Eighty-OE-Second-Brain/0c0e05a0-ccdc-42e6-aecc-187108a3fbca/scratchpad/audit-hitrate/backup/<same relative path>`. Paths below are relative to `/Users/matej/Documents/_One Eighty/OE Second Brain`. Each change carries a dated "Updated 2026-10-05 (dashboard alignment)" or `[SUPERSEDED: 2026-10-05]` marker. No old rule text was deleted, except the retired absolute decision tree in the weekly-performance-review skill (its content is listed in the note that replaced it).

## Summary: edit to file map

| Edit | Where |
|---|---|
| E1 winner vs graduation (D1) | SOP_master table row, section 7 note, new section 11.1; 07-analyzing Step 5 |
| E2 evaluation period 14 days (D2) | SOP_master table row and 11.2; 07-analyzing Step 1 and note under Step 3; weekly-performance-review |
| E3 hit-rate definition (D6) | SOP_master 11.3; 08-feedback-loop B.5 |
| E4 hook = 3-second plays, hold = ThruPlays, relative floors (D4) | SOP_master 11.4; 07-analyzing Step 1, tree, diagnostics; 08 Type 1 |
| E5 Gate 1 = client N | SOP_master section 7 and 11.5; 07-analyzing Gate 1 |
| E6 attribution (D3) | SOP_master table row, 4.2, 11.6; 06-publishing Step 4 |
| E7 thresholds source (D5) | SOP_master section 3 note and 11.7; 4 new KPI files |
| E8 launched and relaunch | SOP_master 11.8; Manami learnings SUPERSEDED note; landing-page-playbook figure removed |
| E9 active test, top-up | SOP_master 11.9 |
| E10 retire stale rules, fix links | weekly-performance-review (tree retired, links fixed); concept-architecture kill criteria |

## New files (no backup, no diff; contents at the end)

- `_clients/dobias/kpi/meta-thresholds.md`
- `_clients/ethia/kpi/meta-thresholds.md`
- `_clients/manami/kpi/meta-thresholds.md`
- `_clients/venev/kpi/meta-thresholds.md`

## Unified diffs

### agency/_processes/meta-creative-engine-v3/SOP_master.md

````diff
@@ -4,7 +4,7 @@
 process: meta-creative-engine
 version: 3.0
 owner: Lukáš (creative + media buying) + Matt (strategy/data)
-last_updated: 2026-09-26
+last_updated: 2026-10-05
 sources: Blue Sense Digital 2026 Framework v1.0 raw (SOP-01 to SOP-12, creative strategy + production pipeline) + M4 Method by Sam Piliero (account structure, ads manager approach)
 sub_sops: 01-research, 02-ideation, 03-briefing, 04-creating, 05-editing, 06-publishing, 07-analyzing, 08-feedback-loop
 changes_v3: >
@@ -16,6 +16,10 @@
   attribution confirmed as 7-day click only (1-day view removed);
   budget minimum updated to 2-3× CPA/day;
   Retention campaign removed from standard structure
+updated_2026_10_05: >
+  Dashboard alignment (hit-rate audit): creative winner vs graduation, 14-day evaluation period,
+  hit-rate definition, hook and hold definitions, readability gate, attribution reading, thresholds source.
+  See section 11. Older rules stay in place with an "Updated 2026-10-05" pointer.
 ---
 
 # Meta Creative Engine. Master SOP
@@ -46,10 +50,10 @@
 | Adding creatives to live ad sets | Allowed into a non-performing concept ad set | New creative = new packs | Never. Testing runs on a weekly launch cadence: every batch of new creatives launches in NEW ad sets (packs). Existing ad sets are never topped up, performing or not. |
 | Kill rule | ROAS below floor for X days → kill | Pack-level judgment | Kill ONLY when the pack is actively receiving significant spend AND the overall campaign ROAS is being dragged below floor. A pack not within KPI but campaign still healthy = HOLD, remove cap, let it run. |
 | Cold frequency | > 2.0 is a red flag | 2x min, 4x target | Monitor 7-day frequency. 2.0–3.0 = warning, investigate. > 3.0 = act (add new concept in a NEW ad set). |
-| Scale trigger | ROAS ≥ 2× target for 7+ days | High spend + at/above target | Two-step: SCALE (+20-25%) at ROAS ≥ Target × 1.2 sustained one full eval period. AGGRESSIVE SCALE (+30-40% + Scaling Campaign graduation) at ROAS ≥ 2× Target sustained 14+ days. |
-| Winner definition | ROAS gates only | Top 10-15% by spend share, never cherry-pick low spend | Hybrid, all three simultaneously: creative ≥ 20% of pack spend; campaign ROAS ≥ Target × 1.2 for two consecutive eval periods; pack CPA at/below target. |
+| Scale trigger | ROAS ≥ 2× target for 7+ days | High spend + at/above target | Two-step: SCALE (+20-25%) at ROAS ≥ Target × 1.2 sustained one full eval period. AGGRESSIVE SCALE (+30-40% + Scaling Campaign graduation) at ROAS ≥ 2× Target sustained 14+ days. **Updated 2026-10-05 (dashboard alignment):** one evaluation period = 14 days with at least N pack purchases, see section 11.2. |
+| Winner definition | ROAS gates only | Top 10-15% by spend share, never cherry-pick low spend | Hybrid, all three simultaneously: creative ≥ 20% of pack spend; campaign ROAS ≥ Target × 1.2 for two consecutive eval periods; pack CPA at/below target. **Updated 2026-10-05 (dashboard alignment):** this three-part rule is now called "graduation"; a creative winner is the dashboard rule, see section 11.1. |
 | Winner scaling | Scale in place | Post-ID into winners ad set | After 2+ eval periods with Winner Definition met: duplicate via post-ID into Scaling Campaign (separate CBO, budget 2–3× testing CBO). Original pack keeps running. |
-| Attribution | 7-day click + 1-day view + 1-day engagement | 7-day click only | **7-day click only.** No view-through or engagement attribution. Confirm in reporting settings. |
+| Attribution | 7-day click + 1-day view + 1-day engagement | 7-day click only | **7-day click only.** No view-through or engagement attribution. Confirm in reporting settings. **Updated 2026-10-05 (dashboard alignment):** decisions read 7-day click; both windows are stored, see section 11.6. |
 | Min budget per ad set | Absolute ($150/$300 gates) | Pack-level judgment | Relative: minimum 2–3× CPA/day per pack. Below this, the pack does not launch. |
 | Trial reel pre-test | Mandatory step | Not part of system | Optional, client-dependent: only where the client has an organic channel with real reach. Skip otherwise. |
 | Spend gates for decisions | Absolute ($150 / $300) | Pack-level judgment | Relative, per KPI Calculator: hold below 1× CPA, iterate needs 2× CPA, kill needs 3× CPA, investigate 0-conversion at 1.5× CPA. |
@@ -87,6 +91,8 @@
 
 All thresholds are relative values derived via the **oneeighty KPI Calculator**. No absolute numbers live in this process.
 
+> **Updated 2026-10-05 (dashboard alignment):** the per-client numbers (Target ROAS, Kill ROAS, Target CPA, Break-even ROAS, N) are owned by dashboard Settings and mirrored in `_clients/<client>/kpi/meta-thresholds.md`. Where this document, an older client note or the KPI Calculator disagrees with Settings, Settings wins. See section 11.7.
+
 **Required inputs:** Break-even ROAS (floor), Target ROAS (set with client at kickoff), AOV, current CPA, tier, evaluation cadence, new-ads quota (confirm or adjust the tier default).
 
 **Derived thresholds:**
@@ -126,7 +132,7 @@
 ### 4.2 Non-negotiable settings
 
 - **Sales objective always. Never Traffic.**
-- **Attribution: 7-day click only.** Not 7d click + 1d view. Confirm in reporting settings.
+- **Attribution: 7-day click only.** Not 7d click + 1d view. Confirm in reporting settings. *Updated 2026-10-05 (dashboard alignment): set 7-day click on every new ad set at creation; the dashboard stores both 7-day click and 1-day view and decisions read 7-day click, see section 11.6.*
 - **Broad audiences only, everywhere.** No interest targeting at any tier or stage.
 - **Exclude existing customers** from all prospecting (customer list uploaded at ad set level).
 - **Landing URLs always carry UTM parameters.**
@@ -189,10 +195,12 @@
 
 ## 7. Decision Logic (summary; full tree in `07-analyzing.md`)
 
-Order of gates every Monday: (0) min spend cap active or no-touch window → NO-TOUCH, check if cap removal due. (1) Learning phase, under 50 purchase events → HOLD. (2) Spend below 1× CPA → HOLD. (3) KPI check against Calculator zones → SCALE / AGGRESSIVE SCALE / HOLD / ITERATE (branch on Hook Rate) / HOLD (pack underperforming but campaign healthy) / KILL (pack dragging campaign below floor) / INVESTIGATE.
+Order of gates every Monday: (0) min spend cap active or no-touch window → NO-TOUCH, check if cap removal due. (1) Learning phase, under 50 purchase events → HOLD *(Updated 2026-10-05 (dashboard alignment): gate 1 is now "pack purchases in the evaluation period below the client's N", see section 11.5)*. (2) Spend below 1× CPA → HOLD. (3) KPI check against Calculator zones → SCALE / AGGRESSIVE SCALE / HOLD / ITERATE (branch on Hook Rate) / HOLD (pack underperforming but campaign healthy) / KILL (pack dragging campaign below floor) / INVESTIGATE.
 
 Winner definition (graduation trigger), all three simultaneously: creative ≥ 20% of pack spend; campaign ROAS ≥ Target × 1.2 for two consecutive eval periods; pack CPA at/below target. Never cherry-pick.
 
+> **Updated 2026-10-05 (dashboard alignment):** the rule above is now the **graduation** trigger in the form given in section 11.1 (winner AND pack ROAS ≥ Target × 1.2 in two consecutive 14-day periods, each with ≥ N pack purchases). A **creative winner** is defined in section 11.1.
+
 Graduation: SMALL +20–30% on the winning pack. MID/LARGE post-ID into Scaling Campaign CBO (2–3× testing budget). Originals never pause, never move.
 
 Monthly: Fastest Horse breakdowns and Account Health Red Flags check. Cost caps only behind the M4 gate: 90+ days stability, $30k+/month, validated CPA target.
@@ -238,3 +246,63 @@
 | `08-feedback-loop.md` | 3.0 | BSD SOP-12 + One Eighty learning system | Iteration types 1-7, learnings log, banks, next-cycle quota plan | 2026-09-26: founder iteration Types 5 to 7 added |
 
 **Extension (2026-09-26): Founder Ads.** Founder ads are a Visual Type delivered through [[founder-ads/SKILL|Founder Ads]] (intake, Story Bible, founder concept matrix, point scripts, shoot pack, editor brief). Theory and rulings: [[founder-ads-playbook]]. Naming, packs, budgets and account settings in this SOP are unchanged for founder ads.
+
+---
+
+## 11. Updates 2026-10-05 (dashboard alignment)
+
+> Small, dated alignment edits after the hit-rate audit of 2026-10-05 (owner decisions D1 to D6). Nothing above is deleted: where an older rule is superseded it carries an "Updated 2026-10-05" pointer to this section. The owner runs fewer scaling campaigns than when v3.0 was written and plans to revise the whole SOP later, so these are targeted fixes, not a rewrite. The dashboard (Creative page) is the reference implementation of the definitions below.
+
+### 11.1 Creative winner vs graduation (D1)
+
+- **Creative winner** (a single ad): lifetime purchases ≥ N AND shrunk ROAS ≥ Target ROAS, and the ad is at least 14 days old. N ("Read at") and Target ROAS are per client (section 11.7). Shrunk ROAS is the ad's ROAS pulled toward the client's trailing 365-day ROAS with a weight of N purchases; the dashboard computes it. An ad below N purchases is at most "promising" (directional), never a winner.
+- **Graduation** (what v3.0 called the Winner Definition): a creative winner whose pack ROAS is ≥ Target × 1.2 in two consecutive evaluation periods, each period with ≥ N pack purchases. Only then does the tier action apply (SMALL: +20-30% on the pack; MID/LARGE: post-ID into the Scaling Campaign).
+- Dropped as criteria: "creative ≥ 20% of pack spend" (Meta's budget split inside a pack is not a winner signal at our spend, see `_clients/manami/learnings/meta-ads.md`, 2026-10-05; keep the share as context) and "pack CPA at or below target" (the dashboard winner does not use CPA and Venev has no Target CPA set; read CPA as context against the client's KPI file).
+- Unchanged: never cherry-pick low spend with high ROAS. The N-purchase gate is what enforces it.
+
+### 11.2 Evaluation period (D2)
+
+- One evaluation period is **14 days**. "Sustained one full eval period", "two consecutive eval periods" and "14+ days" in this SOP mean 14-day periods with at least N pack purchases. A period with fewer than N purchases is not a read (HOLD).
+- Why: weekly reads at our volumes (3 to 13 purchases per pack or campaign per week) carry an interval of roughly +/-63 to 100%.
+- The Monday review stays weekly as a monitoring and execution meeting (cap removals, logged decisions, pipeline). It does not by itself start a new evaluation period.
+- Not touched here: day-7 cap removal and the 7-day no-touch window. The dashboard uses 14 no-touch days for its own verdicts; aligning the two is left for the later SOP revision.
+
+### 11.3 Hit rate (D6)
+
+- **Definition:** hit rate = creative winners (11.1) ÷ ads launched in the cohort, where the cohort is the launch month. Ad grain, deduplicated by creative asset, winner status lifetime to date.
+- **Maturity:** an ad is read after 60 days. Younger ads stay in the denominator as open launches, and a cohort younger than 60 days is shown as maturing (no trend verdict).
+- **Reported per client, monthly, by launch month** from the dashboard Creative page. Also reported: hit rate by launch context (ad in a new ad set vs added to an existing ad set) and pack-level hit rate (ad sets with at least one winner ÷ ad sets launched).
+- **Reference:** the client's own trailing 12-month hit rate. No fixed benchmark. Explicit per-client targets are set after two quarters of maturity-clean data.
+- **Retired as references** (different quantities, no common definition): Manami net-new "1.5%" (superseded, see the Manami learnings), the Strategy scorecard "creative win rate" 25%+ (share of creatives with positive ROI), the Venev "win rate ~25%" planning figure and the "~5%" figure in the dashboard brief. Restate any of them in the definition above before using it.
+
+### 11.4 Hook rate and hold rate (D4)
+
+- **Hook rate = 3-second plays ÷ impressions. Hold rate = ThruPlays ÷ impressions.** The v3.0 text defined hook rate as ThruPlays ÷ impressions, which is the hold rate; at our accounts it makes every video read below 20%.
+- **Video** means video starts ≥ 30% of impressions or a video asset. A banner with incidental video starts is not a video.
+- **Floors are relative per client:** the p25 of the client's genuine video ads over the trailing 180 days (minimum 15 ads), otherwise the fallback of 20% hook and 5% hold. They replace the fixed bands in `07-analyzing.md`.
+- **Diagnostic only, never decides alone.** In the audit data hook rate did not separate winners from non-winners at any client.
+
+### 11.5 Readability gate (replaces the "50 purchase events" gate)
+
+- Gate 1 is: pack purchases in the evaluation period below the client's N (Read at, KPI file) → HOLD (not readable). The "under 50 purchase events" gate is removed because no pack at our volumes reaches it, so it held every decision.
+
+### 11.6 Attribution (D3)
+
+- **Decisions read 7-day click.** Set 7-day click on every new ad set at creation. The review and the dashboard both read 7-day click.
+- The dashboard stores both 7-day click and 1-day view per row (audit change C2) and shows the window it reads. This reconciles the 2026-09-20 decision to keep 7-day click plus 1-day view available with the v3.0 click-only ruling: both are stored, one decides.
+
+### 11.7 Where thresholds live (D5)
+
+- **Dashboard Settings is the source of truth** (dashboard.oneeighty.cz, Settings, section Creative Engine, per client). It is mirrored into `_clients/<client>/kpi/meta-thresholds.md` for dobias, ethia, manami and venev. When the two differ, Settings wins; update the file in the same sitting.
+- Older numbers in repo notes (for example Manami target 2.50, Dobias target 3.5) are superseded by those files.
+
+### 11.8 "Launched" and relaunch
+
+- An ad is launched on its first day with impressions, as a new creative asset.
+- **Not a launch:** a post-ID duplicate into the Scaling Campaign, and a re-upload of a known asset (Manami measured re-uploads at a third to a half of the original, `_clients/manami/learnings/meta-ads.md`).
+- **A launch:** a hook swap (a new hook is a new asset).
+
+### 11.9 Active test: topping up existing ad sets
+
+- The ruling in section 1 ("never top up an existing ad set") stays in force. It is now also an **active test**, not settled fact: in the last 12 months all of Ethia's winners were ads added to existing ad sets (7 of 92 vs 0 of 64 in new ad sets), Manami reads 9.1% added vs 6.2% in new ad sets, Dobias 0 of 4 vs 6 of 31. Heavily confounded (mature ad sets carry budget and history), so this is a reason to measure, not to change the rule.
+- Measured by the dashboard hit rate by launch context. Revisit after two quarters of data.
````

### agency/_processes/meta-creative-engine-v3/07-analyzing.md

````diff
@@ -7,7 +7,8 @@
 master: "[[SOP_master]]"
 owner: Account Manager (Matt)
 cadence: every Monday morning, 45-60 min, before any new briefs; LARGE adds daily spend check; breakdowns + red flags monthly
-last_updated: 2026-07-08
+last_updated: 2026-10-05
+updated_2026_10_05: Dashboard alignment (hit-rate audit). Creative winner vs graduation, 14-day evaluation period, readability gate at client N, hook = 3-second plays and hold = ThruPlays with relative floors. See SOP_master section 11.
 changes_v3: Pack lifecycle protocol added; kill rule updated (only kill if pack actively dragging campaign ROAS below floor); HOLD state added for packs not within KPI after 7 days; Scaling Campaign rules added; Winner Definition clarified
 ---
 
@@ -47,9 +48,9 @@
 
 ## Step 1: Pull data from Ads Manager
 
-1. Campaign view, date range last 7 days
+1. Campaign view, date range last 7 days *(Updated 2026-10-05 (dashboard alignment): also pull the last 14 days, which is the evaluation period, see the note under Step 3)*
 2. Confirm attribution = 7-day click in reporting settings
-3. Columns: Amount Spent, Purchases, ROAS, CPA, Hook Rate (custom: ThruPlays ÷ Impressions × 100), Hold Rate, Frequency, CPM
+3. Columns: Amount Spent, Purchases, ROAS, CPA, Hook Rate (custom: 3-second plays ÷ Impressions × 100), Hold Rate (ThruPlays ÷ Impressions × 100), Frequency, CPM *(Updated 2026-10-05 (dashboard alignment): hook was defined here as ThruPlays ÷ Impressions, which is the hold rate)*
 4. Drill to Ad Set view, then Ad view
 5. Confirm existing customers excluded (reporting filter or ad set level)
 6. Check which packs still have min spend cap active — these are in no-touch, no decisions
@@ -72,9 +73,9 @@
       Check if cap removal is due — if so, remove cap now.
 
 ──────────────────────────────────────────────────────────
-GATE 1: Learning Phase? (< 50 purchase events)
+GATE 1: Readable? (pack purchases in the evaluation period < client N)
 ──────────────────────────────────────────────────────────
-YES → HOLD. Do not touch anything.
+YES → HOLD. Not enough purchases to read. Do not touch anything.
 
 ──────────────────────────────────────────────────────────
 GATE 2: Pack spend below 1× CPA?
@@ -98,7 +99,7 @@
 
 Pack ROAS Floor to Target × 0.9, spend ≥ 2× CPA
   → ITERATE. Branch on diagnostics:
-     Hook Rate < 20% and ROAS in decent range
+     Hook Rate below the client's floor (fallback 20%) and ROAS in decent range
        → Hook problem, not concept. Brief 6 new hooks on same body (Type 1).
      Hook Rate OK but ROAS flat
        → Angle or offer problem. Format translation (UGC → static)
@@ -129,8 +130,13 @@
 destroys the sequence. TRUST THE PACK ROAS, NOT INDIVIDUAL AD ROAS.
 ```
 
-**Diagnostic metrics (explain WHY, never decide alone):** Hook Rate (good ≥ 25%, warning 15–25%, bad < 15%), Hold Rate at 15s (good ≥ 10%, bad < 5%), Outbound CTR (good ≥ 1%), Frequency 7d (good ≤ 2.0, act > 3.0 by adding a new concept in a NEW pack), Post Shares, CPM trend (rising MoM = fatigue).
+> **Updated 2026-10-05 (dashboard alignment, see [[SOP_master]] section 11).**
+> - **Evaluation period = 14 days**, read at ≥ N pack purchases (N = the client's "Read at" in `_clients/<client>/kpi/meta-thresholds.md`). "Sustained one full eval period", "two consecutive eval periods" and "14+ days" in this file mean that. The Monday review stays weekly for monitoring and execution.
+> - **Gate 1** was "Learning Phase? (< 50 purchase events) → HOLD". No pack at our volumes reaches 50, so it held every decision; it is now the client's N.
+> - **Hook Rate floor** is relative per client (section 11.4), diagnostic only.
 
+**Diagnostic metrics (explain WHY, never decide alone):** Hook Rate = 3-second plays ÷ Impressions and Hold Rate = ThruPlays ÷ Impressions, each against the client's own floor (p25 of the client's genuine video ads, trailing 180 days, min 15 ads, else fallback 20% hook / 5% hold; see SOP_master section 11.4) *[SUPERSEDED: 2026-10-05, dashboard alignment: the fixed bands "Hook Rate good ≥ 25%, warning 15–25%, bad < 15%" and "Hold Rate at 15s good ≥ 10%, bad < 5%", which were written on the ThruPlays definition]*, Outbound CTR (good ≥ 1%), Frequency 7d (good ≤ 2.0, act > 3.0 by adding a new concept in a NEW pack), Post Shares, CPM trend (rising MoM = fatigue).
+
 ---
 
 ## Step 4: Execute decisions
@@ -147,8 +153,14 @@
 
 ## Step 5: Winner identification + Scaling Campaign graduation
 
-**Winner definition (all three simultaneously):**
+> **Updated 2026-10-05 (dashboard alignment, see [[SOP_master]] section 11.1).** Two separate things now:
+> - **Creative winner** (one ad): lifetime purchases ≥ N AND shrunk ROAS ≥ Target ROAS, and the ad is at least 14 days old. N and Target per client in `_clients/<client>/kpi/meta-thresholds.md`. This is the dashboard rule.
+> - **Graduation:** a creative winner AND its pack ROAS ≥ Target × 1.2 in two consecutive 14-day evaluation periods, each with ≥ N pack purchases.
+>
+> The three-part rule below is replaced by this. Its criterion 1 (≥ 20% of pack spend) and criterion 3 (pack CPA) are now context to note in the decision log, not criteria.
 
+**Winner definition (all three simultaneously) [SUPERSEDED: 2026-10-05, now the graduation rule above]:**
+
 1. Creative receives ≥ 20% of total pack spend (Meta is actively preferring it)
 2. Campaign ROAS ≥ Target × 1.2 for **two consecutive evaluation periods**
 3. Pack CPA at or below target
@@ -158,7 +170,7 @@
 **Graduation per tier:**
 
 - **SMALL:** raise winning pack's budget 20–30%. Do not move the creative, do not add new creatives to the winning pack.
-- **MID/LARGE:** after 2+ eval periods with Winner Definition met → duplicate the winning ad via **post-ID** into the **Scaling Campaign** (separate CBO). Original pack keeps running. Scale campaign budget = 2–3× the testing CBO daily budget.
+- **MID/LARGE:** after 2+ eval periods with Winner Definition met *(Updated 2026-10-05: read as "graduation met", see the note above)* → duplicate the winning ad via **post-ID** into the **Scaling Campaign** (separate CBO). Original pack keeps running. Scale campaign budget = 2–3× the testing CBO daily budget.
 
 **Scaling Campaign rules:**
 - CBO, broad, same exclusions as Prospecting
````

### agency/_processes/meta-creative-engine-v3/08-feedback-loop.md

````diff
@@ -8,8 +8,9 @@
 owner: Matt logs decisions, Creative Strategist (Lukáš) writes iteration briefs
 cadence: last block of every Monday review
 clickup: triggered from 🔁 LIVE ITERATING; new briefs re-enter at 📝 BRIEF IN PROGRESS
-last_updated: 2026-09-26
+last_updated: 2026-10-05
 changes_v3: no changes (file copied from v2.0)
+updated_2026_10_05: Dashboard alignment. Hook Rate definition, hit-rate reporting in the learnings step. See SOP_master section 11.
 ---
 
 # 08. Feedback Loop: Iteration Briefs + Learning System
@@ -22,7 +23,7 @@
 
 **Type 1: Hook Swap (most common, highest leverage)**
 
-- When: Hook Rate < 20%, OR strong ad set ROAS starting to fatigue.
+- When: Hook Rate < 20%, OR strong ad set ROAS starting to fatigue. *(Updated 2026-10-05 (dashboard alignment): Hook Rate = 3-second plays ÷ Impressions and the 20% is the fallback; the trigger is the client's own floor, see [[SOP_master]] section 11.4. Diagnostic only, never the sole trigger.)*
 - How: identify the winning body (the part that converts, keep intact). Write 6-10 new hooks across different patterns (Problem Agitation, Contrarian Truth, Curiosity Gap, Specific Proof...). Each new hook = new creative ID = novel audience reach.
 - Production: minimal. For video, re-record only the first 3-5 seconds.
 
@@ -65,6 +66,7 @@
 2. **Update the banks:** Persona & Angle Bank (which personas/angles convert), Template Bank (winning templates tagged as proven = 80% iteration sources), Winner Library (post-IDs + files of all graduates).
 3. **Assemble next cycle's plan:** iteration briefs from this week's decisions (the 80%) + net-new concepts from research/swipe log (the 20%), filling the tier quota (SMALL 4-6, MID 8-16, LARGE 20+ ads/month).
 4. **Quarterly:** promote patterns confirmed across 2+ clients to `agency/playbooks/` (hook patterns, angle types).
+5. **Hit rate, monthly** *(added 2026-10-05, dashboard alignment)*: per client, read the hit rate by launch month from the dashboard Creative page and log it with the month's learnings. Definition: creative winners ÷ ads launched in the cohort, ad grain, relaunches excluded, 60-day maturity, reference = the client's own trailing 12-month rate. A hit rate quoted without that definition does not go into the learnings file. Full definition: [[SOP_master]] section 11.3.
 
 ## Outputs
 
````

### agency/_processes/meta-creative-engine-v3/06-publishing.md

````diff
@@ -94,7 +94,7 @@
 - **Campaign:** Prospecting CBO only. Never put new tests into Scale campaign.
 - **Budget:** Min spend cap = 20% of total daily CBO budget, applied at ad set level.
 - **Min budget check:** confirm each pack can receive at least 2–3× CPA/day with the cap. If not, the campaign budget is too low or there are too many packs.
-- **Attribution:** 7-day click (NOT 7d click + 1d view or 1d view).
+- **Attribution:** 7-day click (NOT 7d click + 1d view or 1d view). *Updated 2026-10-05 (dashboard alignment): set 7-day click at ad set creation. The dashboard stores both windows, decisions read 7-day click, see [[SOP_master]] section 11.6.*
 - **Audience:** Broad. No interest targeting. No lookalikes. The creative IS the targeting.
 - **Exclude existing customers** (uploaded customer list) + retargeting pools, at ad set level.
 
````

### agency/_processes/weekly-performance-review/SKILL.md

````diff
@@ -7,9 +7,9 @@
   client update, or analyze last week's results across channels. Triggers on
   "weekly review", "týdenní review", "what to scale this week", "kill list",
   "performance check", "should we iterate this", "ad set ROAS", "scale or
-  kill", "what did last week tell us". Follows SOP-10 and SOP-11 from the
-  Meta Ads SOP, produces decisions logged to ClickUp + appended learnings
-  to the relevant client channel learning file.
+  kill", "what did last week tell us". Follows the Meta Creative Engine v3 SOP
+  (stage 7, `07-analyzing.md`), produces decisions logged to ClickUp + appended
+  learnings to the relevant client channel learning file.
 ---
 
 # One Eighty — Weekly Performance Review
@@ -24,8 +24,10 @@
 
 1. `clients/<client>/brain.md`
 2. `clients/<client>/learnings/<channel>.md` — for the channel being reviewed
-3. `agency/frameworks/meta-ads-sop.md` — SOP-10, SOP-11, SOP-12
-4. `agency/playbooks/angle-types.md` and `hook-patterns.md` for context
+3. `agency/_processes/meta-creative-engine-v3/07-analyzing.md`: decision tree, winner and graduation rules (SOP v3.0; replaces the missing `agency/frameworks/meta-ads-sop.md`, link fixed 2026-10-05)
+   and `agency/_processes/meta-creative-engine-v3/08-feedback-loop.md`
+4. `_clients/<client>/kpi/meta-thresholds.md`: the client's Target ROAS, Kill ROAS, Target CPA, N (mirror of dashboard Settings)
+5. `agency/playbooks/angle-types.md` and `hook-patterns.md` for context
 
 ## Inputs needed from user
 
@@ -37,24 +39,14 @@
 - Frequency
 - Days running
 
-If learning phase or <$150 spend → defer decision, don't force one.
+If the pack is inside its no-touch / min-spend-cap window, has fewer than N purchases in the evaluation period (N from the KPI file), or spend below 1× CPA → defer the decision, don't force one. *(Updated 2026-10-05, retired the "learning phase or <$150" rule, see below.)*
 
-## The decision tree (from SOP-11)
+## The decision tree
 
-```
-GATE 1: Learning phase (<50 purchases)?  → HOLD
-GATE 2: Spend < $150?                     → HOLD
-GATE 3: Spend ≥ $150 — apply KPI:
+> **Updated 2026-10-05 (dashboard alignment): old tree retired.** The absolute gates that stood here ($150 / $300 spend gates, learning phase under 50 purchases, SCALE at 2× target after 7 days, SCALE aggressively at 3× target after 14 days, ROAS 0.8-1.5× target iterate bands, KILL at ROAS < 0.5× target with $300+) came from the pre-v3 SOP and conflict with SOP v3.0. Run the tree in `agency/_processes/meta-creative-engine-v3/07-analyzing.md` (Step 3) with the client's thresholds from `_clients/<client>/kpi/meta-thresholds.md`. Relative gates, per `SOP_master.md` section 3: hold below 1× CPA, iterate needs 2× CPA, kill needs 3× CPA (pack dragging the campaign below Floor), investigate 0 conversions at 1.5× CPA.
+>
+> Also from SOP v3 (`SOP_master.md` section 11): one evaluation period is 14 days with at least N pack purchases; a creative winner = lifetime purchases ≥ N and shrunk ROAS ≥ Target (dashboard rule); graduation = winner plus pack ROAS ≥ Target × 1.2 in two consecutive periods; hook rate = 3-second plays ÷ impressions against the client's relative floor, diagnostic only.
 
-ROAS ≥ 2× target, 7+ days     → SCALE budget 20–25%
-ROAS ≥ 3× target, 14+ days    → SCALE aggressively (30–40%)
-ROAS 0.8–1.5× target:
-   hook < 20%  → ITERATE hooks
-   hook OK     → ITERATE angle/format
-ROAS < 0.5× target, $300+     → KILL
-0 conversions, $150+          → PAUSE + investigate
-```
-
 ## Process per session
 
 1. **Confirm scope.** Which client? Which channels? Which week?
@@ -67,7 +59,7 @@
 5. **Append to `clients/<client>/learnings/<channel>.md`.**
 6. **Update ClickUp** — concept status (killed/scaling/iterating), notes.
 7. **Identify gaps:** are we under 3 active concepts? Is hero ad >60% of
-   spend? Use Appendix B (Account Health Red Flags).
+   spend? Use `SOP_master.md` section 9 (Account Health Red Flags; formerly "Appendix B").
 
 ## Output structure
 
@@ -111,10 +103,10 @@
 - **Last-click ROAS lies.** Trust ad-set ROAS, not individual ad ROAS.
 - **Capture the learning every time.** A killed concept without a learning
   is wasted spend.
-- **Be honest about uncertainty.** If data is noisy, say HOLD, not "Scale."
+- **Be honest about uncertainty.** If data is noisy, say HOLD, not "Scale." Weekly reads at our purchase volumes are mostly noise; decide on 14-day periods.
 
 ## See also
 
-- `agency/frameworks/meta-ads-sop.md` (SOP-10, SOP-11, SOP-12)
+- `agency/_processes/meta-creative-engine-v3/SOP_master.md` and `07-analyzing.md`, `08-feedback-loop.md` (SOP v3.0; replaces the missing `agency/frameworks/meta-ads-sop.md`)
 - `templates/weekly-review.md`
 - `skills/weekly-performance-review/learnings.md`
````

### agency/_processes/concept-architecture/SKILL.md

````diff
@@ -81,7 +81,7 @@
 - Format
 - Differentiation note (vs which active concepts)
 - Hypothesis (what we expect to learn)
-- Kill criteria (when do we kill this — usually ROAS < 0.5× target at $300+ spend)
+- Kill criteria (when do we kill this: per SOP v3.0, pack ROAS below the client's Floor AND the pack dragging campaign ROAS below Floor, at spend ≥ 3× CPA; client numbers in `_clients/<client>/kpi/meta-thresholds.md`) *(Updated 2026-10-05, dashboard alignment: the old absolute rule "ROAS < 0.5× target at $300+ spend" is retired, see `agency/_processes/meta-creative-engine-v3/07-analyzing.md` Step 3 and `SOP_master.md` section 11)*
 
 ### Step 7: Mirror to ClickUp Concept Bank.
 
````

### _clients/manami/learnings/meta-ads.md

````diff
@@ -34,7 +34,7 @@
 
 - **`LANDING_PAGE_VIEWS` optimisation inside a Sales campaign.** `Landing page clicks I 24APR I CZ` — 12 995 Kč, **ROAS 0,39**, 9 004 LPV (as many as the main ad set produced on 14× the budget). Paused 4 Sep 2026. Beyond the wasted spend it poisoned four months of account-level LPV and click-to-purchase reporting, and made the May CVR cliff look far worse than it was. SOP is explicit: Sales objective always, never Traffic.
 - **Weekly pack launches with no retirement rule.** By Sep 2026: 8 live CZ pack ad sets, exactly one ever paused. All converged to 1,08–1,38 because none could accumulate enough conversions to leave learning. Packs need a scheduled close, not just a launch date.
-- **Net-new personas without a proven-winner anchor.** Jun–Aug introduced nine: NicheScentLover, HeadacheOffice, BlindBuySkeptic, IngredientSkeptic, RitualSeeker, SensitiveSwitcher, IntimateScent, BusyMom, QuietElegance. 67 ads ran; one cleared target. **Hit rate ≈ 1,5 %.** Target mix is 5 iterations of a proven winner per 1 net-new concept.
+- **Net-new personas without a proven-winner anchor.** Jun–Aug introduced nine: NicheScentLover, HeadacheOffice, BlindBuySkeptic, IngredientSkeptic, RitualSeeker, SensitiveSwitcher, IntimateScent, BusyMom, QuietElegance. 67 ads ran; one cleared target. **Hit rate ≈ 1,5 %.** Target mix is 5 iterations of a proven winner per 1 net-new concept. [SUPERSEDED: 2026-10-05 (dashboard alignment): the "1,5 %" paired a net-new numerator with an all-delivering denominator, and the 67 cannot be reproduced from the warehouse (nearest count is 69 ads with any delivery Jun to Aug, which includes older ads and relaunch copies). Recomputed under the dashboard hit-rate definition (winner = lifetime purchases ≥ 15 and shrunk ROAS ≥ 2,25; relaunches excluded; first delivered Jun to Aug): **3 of 40 ads = 7,5 %** overall and **1 of 24 = 4,2 %** for net-new persona ads (the one winner is `NicheScentLover - Testovaci sada | TOF | STAT | 1JULY`, whose 2,45 on 37 purchases was already below the 2,50 target stated at the time). The qualitative conclusion, that net-new personas without a proven-winner anchor rarely win, stands; the number does not. Definition: `agency/_processes/meta-creative-engine-v3/SOP_master.md` section 11.3. Original text above kept as written.]
 - **Single-step budget jumps.** 14 Apr: `Testing I 6JUN I CZ` 455 → 1 780 Kč/day (+291 %). 25 Aug: `PACKS CBO | CZ` 1 250 → 3 000 Kč/day (+140 %) on a campaign already at 1,28. Cap is +20–25 %; above ~20 % Meta re-enters learning.
 - **Topping up live ad sets.** `Testing I 6JUN I CZ` took 23 ads across 12 separate upload dates Jan–Jun; `Testing creatives I 31MAR` took 24 across 11. Every upload reset the learning on the account's best asset. Fixed from June onward by the pack system.
 
````

### agency/_playbooks/landing-pages/landing-page-playbook.md

````diff
@@ -219,7 +219,7 @@
 
 Mixed traffic: write for the dominant awareness of the creative, add exits for warmer readers (sticky bar, early CTA), and send retargeting to a product-aware page, never to an advertorial.
 
-**Which concepts earn a custom LP (H).** One LP per awareness entry point, and only where it pays: build a custom page for the dominant traffic source, or for a concept whose ad has held the account's kill line over at least 25 purchases. Every other concept goes to the PDP or to the existing page for its awareness entry. Net-new concepts rarely win (Manami: one winner from 67 ads, a hit rate of about 1.5%; kill line ROAS 1.80; `_clients/manami/learnings/meta-ads.md`), so a page per concept in briefing (six at Manami, `_clients/manami/concepts/_index.md`) spends build time on ads that will mostly be killed.
+**Which concepts earn a custom LP (H).** One LP per awareness entry point, and only where it pays: build a custom page for the dominant traffic source, or for a concept whose ad has held the account's kill line over at least 25 purchases. Every other concept goes to the PDP or to the existing page for its awareness entry. Net-new concepts rarely win (Manami: see the hit-rate entry under "What fails" in `_clients/manami/learnings/meta-ads.md`, recomputed 2026-10-05; kill line ROAS 1.80), so a page per concept in briefing (six at Manami, `_clients/manami/concepts/_index.md`) spends build time on ads that will mostly be killed.
 
 ---
 
````

## New file contents

### _clients/dobias/kpi/meta-thresholds.md

````markdown
---
type: client-kpi
client: dobias
channel: meta-ads
last_updated: 2026-10-05
source_of_truth: dashboard Settings
---

# Dobias: Meta Creative Engine thresholds

> **Source of truth: dashboard Settings** (dashboard.oneeighty.cz/settings?client=<id>, section "Creative Engine"). This file is a mirror, written 2026-10-05 from the values saved in Settings that day. If Settings and this file differ, Settings wins; update this file in the same sitting. Why: [[SOP_master]] section 11.7 (`agency/_processes/meta-creative-engine-v3/`).

## Values (Settings, saved and read back after reload on 2026-10-05)

| Threshold | Settings field | Value |
|---|---|---|
| Target ROAS | Target ROAS | 3 |
| Kill ROAS | Kill ROAS | 1.5 |
| Target CPA | Target CPA (USD) | 54 USD |
| Break-even ROAS | Break-even ROAS | 1.51 |
| Gross margin | Gross margin % | 80 |
| N, purchases for a Read row (also the shrinkage weight) | Read at | 25 (default, unchanged) |
| Directional purchases | Directional at | 10 (default, unchanged) |

Currency of the client in Settings: USD.

## How the SOP uses these

- **Creative winner:** lifetime purchases ≥ N AND shrunk ROAS ≥ Target ROAS ([[SOP_master]] section 11.1). N = "Read at".
- **Graduation, evaluation period, readability gate:** pack ROAS ≥ Target × 1.2 in two consecutive 14-day periods, each with ≥ N pack purchases (sections 11.1, 11.2, 11.5).
- **Kill line:** Kill ROAS; spend gates are relative to Target CPA (kill 3×, iterate 2×, hold 1×, investigate 1.5× with 0 conversions).
- **Not in Settings:** the kill spend gate multiple (3× CPA) has no Settings field; it comes from the SOP.

## Notes

- Cost assumptions in Settings (read only, not changed): OpEx 35 % of revenue, fulfilment 20.5 USD per order, other CM1 per order empty. Fulfilment 20.5 USD is at or above 20 USD, so the Settings branch "fulfilment about 20 USD or more" applied: Kill ROAS 1.50, Break-even ROAS 1.51.
- Older repo notes that cite Dobias target ROAS 3.5 are superseded by this file (3.00).
- Other Creative Engine settings were not changed on 2026-10-05 and sit at their defaults: hook rate floor 20 %, hold rate floor 5 % (to be replaced by relative per-client floors, [[SOP_master]] section 11.4), no-touch days 14, "Test size" 25 (purchases a pack must reach before its verdict means anything).
````

### _clients/ethia/kpi/meta-thresholds.md

````markdown
---
type: client-kpi
client: ethia
channel: meta-ads
last_updated: 2026-10-05
source_of_truth: dashboard Settings
---

# Ethia: Meta Creative Engine thresholds

> **Source of truth: dashboard Settings** (dashboard.oneeighty.cz/settings?client=<id>, section "Creative Engine"). This file is a mirror, written 2026-10-05 from the values saved in Settings that day. If Settings and this file differ, Settings wins; update this file in the same sitting. Why: [[SOP_master]] section 11.7 (`agency/_processes/meta-creative-engine-v3/`).

## Values (Settings, saved and read back after reload on 2026-10-05)

| Threshold | Settings field | Value |
|---|---|---|
| Target ROAS | Target ROAS | 2.5 |
| Kill ROAS | Kill ROAS | 1.7 |
| Target CPA | Target CPA (CZK) | 550 CZK |
| Break-even ROAS | Break-even ROAS | 1.66 |
| Gross margin | Gross margin % | 73 |
| N, purchases for a Read row (also the shrinkage weight) | Read at | 10 |
| Directional purchases | Directional at | 5 |

Currency of the client in Settings: CZK.

## How the SOP uses these

- **Creative winner:** lifetime purchases ≥ N AND shrunk ROAS ≥ Target ROAS ([[SOP_master]] section 11.1). N = "Read at".
- **Graduation, evaluation period, readability gate:** pack ROAS ≥ Target × 1.2 in two consecutive 14-day periods, each with ≥ N pack purchases (sections 11.1, 11.2, 11.5).
- **Kill line:** Kill ROAS; spend gates are relative to Target CPA (kill 3×, iterate 2×, hold 1×, investigate 1.5× with 0 conversions).
- **Not in Settings:** the kill spend gate multiple (3× CPA) has no Settings field; it comes from the SOP.

## Notes

- Other Creative Engine settings were not changed on 2026-10-05 and sit at their defaults: hook rate floor 20 %, hold rate floor 5 % (to be replaced by relative per-client floors, [[SOP_master]] section 11.4), no-touch days 14, "Test size" 25 (purchases a pack must reach before its verdict means anything).
````

### _clients/manami/kpi/meta-thresholds.md

````markdown
---
type: client-kpi
client: manami
channel: meta-ads
last_updated: 2026-10-05
source_of_truth: dashboard Settings
---

# Manami: Meta Creative Engine thresholds

> **Source of truth: dashboard Settings** (dashboard.oneeighty.cz/settings?client=<id>, section "Creative Engine"). This file is a mirror, written 2026-10-05 from the values saved in Settings that day. If Settings and this file differ, Settings wins; update this file in the same sitting. Why: [[SOP_master]] section 11.7 (`agency/_processes/meta-creative-engine-v3/`).

## Values (Settings, saved and read back after reload on 2026-10-05)

| Threshold | Settings field | Value |
|---|---|---|
| Target ROAS | Target ROAS | 2.25 |
| Kill ROAS | Kill ROAS | 1.8 |
| Target CPA | Target CPA (CZK) | 527 CZK |
| Break-even ROAS | Break-even ROAS | 1.46 |
| Gross margin | Gross margin % | 68.4 |
| N, purchases for a Read row (also the shrinkage weight) | Read at | 15 |
| Directional purchases | Directional at | 6 |

Currency of the client in Settings: CZK.

## How the SOP uses these

- **Creative winner:** lifetime purchases ≥ N AND shrunk ROAS ≥ Target ROAS ([[SOP_master]] section 11.1). N = "Read at".
- **Graduation, evaluation period, readability gate:** pack ROAS ≥ Target × 1.2 in two consecutive 14-day periods, each with ≥ N pack purchases (sections 11.1, 11.2, 11.5).
- **Kill line:** Kill ROAS; spend gates are relative to Target CPA (kill 3×, iterate 2×, hold 1×, investigate 1.5× with 0 conversions).
- **Not in Settings:** the kill spend gate multiple (3× CPA) has no Settings field; it comes from the SOP.

## Notes

- Older repo notes that cite Manami target ROAS 2.50 (for example in `learnings/meta-ads.md`) are superseded by this file (2.25). Kill ROAS 1.80 is unchanged.
- Other Creative Engine settings were not changed on 2026-10-05 and sit at their defaults: hook rate floor 20 %, hold rate floor 5 % (to be replaced by relative per-client floors, [[SOP_master]] section 11.4), no-touch days 14, "Test size" 25 (purchases a pack must reach before its verdict means anything).
````

### _clients/venev/kpi/meta-thresholds.md

````markdown
---
type: client-kpi
client: venev
channel: meta-ads
last_updated: 2026-10-05
source_of_truth: dashboard Settings
---

# Venev: Meta Creative Engine thresholds

> **Source of truth: dashboard Settings** (dashboard.oneeighty.cz/settings?client=<id>, section "Creative Engine"). This file is a mirror, written 2026-10-05 from the values saved in Settings that day. If Settings and this file differ, Settings wins; update this file in the same sitting. Why: [[SOP_master]] section 11.7 (`agency/_processes/meta-creative-engine-v3/`).

## Values (Settings, saved and read back after reload on 2026-10-05)

| Threshold | Settings field | Value |
|---|---|---|
| Target ROAS | Target ROAS | 2.1 |
| Kill ROAS | Kill ROAS | 1.9 |
| Target CPA | Target CPA (EUR) | not set |
| Break-even ROAS | Break-even ROAS | 1.89 |
| Gross margin | Gross margin % | empty (not entered) |
| N, purchases for a Read row (also the shrinkage weight) | Read at | 10 |
| Directional purchases | Directional at | 5 |

Currency of the client in Settings: EUR.

## How the SOP uses these

- **Creative winner:** lifetime purchases ≥ N AND shrunk ROAS ≥ Target ROAS ([[SOP_master]] section 11.1). N = "Read at".
- **Graduation, evaluation period, readability gate:** pack ROAS ≥ Target × 1.2 in two consecutive 14-day periods, each with ≥ N pack purchases (sections 11.1, 11.2, 11.5).
- **Kill line:** Kill ROAS; spend gates are relative to Target CPA (kill 3×, iterate 2×, hold 1×, investigate 1.5× with 0 conversions).
- **Not in Settings:** the kill spend gate multiple (3× CPA) has no Settings field; it comes from the SOP.

## Notes

- Target CPA is **not set**. The Venev Settings form is denominated in EUR and no EUR figure has been confirmed, so nothing was entered. Dashboard summary shows "Missing CPA". Winner and hit-rate logic do not need a Target CPA; spend gates that use CPA stay unavailable until it is set.
- Other Creative Engine settings were not changed on 2026-10-05 and sit at their defaults: hook rate floor 20 %, hold rate floor 5 % (to be replaced by relative per-client floors, [[SOP_master]] section 11.4), no-touch days 14, "Test size" 25 (purchases a pack must reach before its verdict means anything).
````

## Not done / for the owner

- Out of the edit list, so untouched: `agency/_strategy/Strategy.md:223` ("Creative win rate" 25%+), Venev `venev-growth-model.md:51` and roadmaps ("win rate 25%"), `one-eighty-dashboard-repo/CREATIVE_ENGINE_BRIEF.md:529,596` ("1 of 67", "Nathan ~5%", dashboard repo), `agency/_playbooks/angle-types.md:14` and `meta-ad-brief` (still link to the missing `agency/frameworks/meta-ads-sop.md`), and `[[meta-provozni-pravidla]]` links inside the Manami learnings (file does not exist; the learnings file is append-only). SOP_master 11.3 names the first two as retired references.
- Kept as is, flagged in 11.2: day-7 cap removal and the 7-day no-touch window vs the dashboard's 14 no-touch days.
- Gate 1 now binds at client N: a pack below N purchases is HOLD, including low-volume kill and investigate cases (the old 50-event gate behaved the same way, just never opened). Worth a look when the SOP is revised.
- 11.1 adds "ad at least 14 days old" (audit C9) and describes shrunk ROAS in words only (weight N, prior = trailing 365-day client ROAS); the exact formula lives in the dashboard code.
- Attribution (11.6) says the dashboard stores both windows as audit change C2; that is a dashboard change, not verified here.

## Correction 2026-10-05 (attribution basis, from coordinator)

Owner clarified the agency runs primarily 7-day click + 1-day view. Decisions now use that as the standard basis; the dashboard stores 7d click, 1d view and engaged view separately and reports the standard basis; full playbook revision planned later. Pre-correction copies: `/private/tmp/claude-501/-Users-matej-Documents--One-Eighty-OE-Second-Brain/0c0e05a0-ccdc-42e6-aecc-187108a3fbca/scratchpad/audit-hitrate/backup_pre_correction/<same relative path>`. The diffs above are original vs. state before this correction; the diffs below are the correction only. The "Not done" bullet about attribution (11.6 stores both windows) is superseded by this correction.

### agency/_processes/meta-creative-engine-v3/SOP_master.md

````diff
@@ -53,7 +53,7 @@
 | Scale trigger | ROAS ≥ 2× target for 7+ days | High spend + at/above target | Two-step: SCALE (+20-25%) at ROAS ≥ Target × 1.2 sustained one full eval period. AGGRESSIVE SCALE (+30-40% + Scaling Campaign graduation) at ROAS ≥ 2× Target sustained 14+ days. **Updated 2026-10-05 (dashboard alignment):** one evaluation period = 14 days with at least N pack purchases, see section 11.2. |
 | Winner definition | ROAS gates only | Top 10-15% by spend share, never cherry-pick low spend | Hybrid, all three simultaneously: creative ≥ 20% of pack spend; campaign ROAS ≥ Target × 1.2 for two consecutive eval periods; pack CPA at/below target. **Updated 2026-10-05 (dashboard alignment):** this three-part rule is now called "graduation"; a creative winner is the dashboard rule, see section 11.1. |
 | Winner scaling | Scale in place | Post-ID into winners ad set | After 2+ eval periods with Winner Definition met: duplicate via post-ID into Scaling Campaign (separate CBO, budget 2–3× testing CBO). Original pack keeps running. |
-| Attribution | 7-day click + 1-day view + 1-day engagement | 7-day click only | **7-day click only.** No view-through or engagement attribution. Confirm in reporting settings. **Updated 2026-10-05 (dashboard alignment):** decisions read 7-day click; both windows are stored, see section 11.6. |
+| Attribution | 7-day click + 1-day view + 1-day engagement | 7-day click only | **7-day click only.** No view-through or engagement attribution. Confirm in reporting settings. **Updated 2026-10-05 (dashboard alignment, corrected same day):** the agency runs primarily 7-day click + 1-day view, which is the standard basis for decisions; the windows are stored separately, see section 11.6. |
 | Min budget per ad set | Absolute ($150/$300 gates) | Pack-level judgment | Relative: minimum 2–3× CPA/day per pack. Below this, the pack does not launch. |
 | Trial reel pre-test | Mandatory step | Not part of system | Optional, client-dependent: only where the client has an organic channel with real reach. Skip otherwise. |
 | Spend gates for decisions | Absolute ($150 / $300) | Pack-level judgment | Relative, per KPI Calculator: hold below 1× CPA, iterate needs 2× CPA, kill needs 3× CPA, investigate 0-conversion at 1.5× CPA. |
@@ -132,7 +132,7 @@
 ### 4.2 Non-negotiable settings
 
 - **Sales objective always. Never Traffic.**
-- **Attribution: 7-day click only.** Not 7d click + 1d view. Confirm in reporting settings. *Updated 2026-10-05 (dashboard alignment): set 7-day click on every new ad set at creation; the dashboard stores both 7-day click and 1-day view and decisions read 7-day click, see section 11.6.*
+- **Attribution: 7-day click only.** Not 7d click + 1d view. Confirm in reporting settings. *Updated 2026-10-05 (dashboard alignment, corrected same day): the standard basis is 7-day click + 1-day view, set on every new ad set at creation; the dashboard stores 7-day click, 1-day view and engaged view separately and reports the standard basis, see section 11.6.*
 - **Broad audiences only, everywhere.** No interest targeting at any tier or stage.
 - **Exclude existing customers** from all prospecting (customer list uploaded at ad set level).
 - **Landing URLs always carry UTM parameters.**
@@ -286,10 +286,10 @@
 
 - Gate 1 is: pack purchases in the evaluation period below the client's N (Read at, KPI file) → HOLD (not readable). The "under 50 purchase events" gate is removed because no pack at our volumes reaches it, so it held every decision.
 
-### 11.6 Attribution (D3)
+### 11.6 Attribution (D3, corrected 2026-10-05: standard basis is 7-day click + 1-day view)
 
-- **Decisions read 7-day click.** Set 7-day click on every new ad set at creation. The review and the dashboard both read 7-day click.
-- The dashboard stores both 7-day click and 1-day view per row (audit change C2) and shows the window it reads. This reconciles the 2026-09-20 decision to keep 7-day click plus 1-day view available with the v3.0 click-only ruling: both are stored, one decides.
+- **Decisions use 7-day click + 1-day view as the standard basis**, set on every new ad set at creation. The review and the dashboard both report that basis. This follows the 2026-09-20 decision and the owner's clarification of 2026-10-05 that the agency runs primarily 7-day click + 1-day view; it replaces the v3.0 "7-day click only" ruling (kept above, marked).
+- The dashboard stores 7-day click, 1-day view and engaged view separately (audit change C2, still to land) and shows the window it reports, so any comparison against a click-only number is explicit. A full playbook revision on attribution is planned later.
 
 ### 11.7 Where thresholds live (D5)
 
````

### agency/_processes/meta-creative-engine-v3/07-analyzing.md

````diff
@@ -14,7 +14,7 @@
 
 # 07. Analyzing: Weekly Review + Scale / Hold / Iterate / Kill
 
-> **Core rules:** Decisions at AD SET (pack) level. Never kill/scale based on individual ad last-click ROAS. Attribution always 7-day click. Existing customers always excluded. Primary metric at ad level: Amount Spent, not last-click ROAS.
+> **Core rules:** Decisions at AD SET (pack) level. Never kill/scale based on individual ad last-click ROAS. Attribution always 7-day click *(Updated 2026-10-05 (dashboard alignment, corrected same day): the standard basis is 7-day click + 1-day view, see [[SOP_master]] section 11.6)*. Existing customers always excluded. Primary metric at ad level: Amount Spent, not last-click ROAS.
 
 ---
 
@@ -49,7 +49,7 @@
 ## Step 1: Pull data from Ads Manager
 
 1. Campaign view, date range last 7 days *(Updated 2026-10-05 (dashboard alignment): also pull the last 14 days, which is the evaluation period, see the note under Step 3)*
-2. Confirm attribution = 7-day click in reporting settings
+2. Confirm attribution = 7-day click in reporting settings *(Updated 2026-10-05 (dashboard alignment, corrected same day): read the standard basis, 7-day click + 1-day view, and confirm it is the same on every ad set; see [[SOP_master]] section 11.6)*
 3. Columns: Amount Spent, Purchases, ROAS, CPA, Hook Rate (custom: 3-second plays ÷ Impressions × 100), Hold Rate (ThruPlays ÷ Impressions × 100), Frequency, CPM *(Updated 2026-10-05 (dashboard alignment): hook was defined here as ThruPlays ÷ Impressions, which is the hold rate)*
 4. Drill to Ad Set view, then Ad view
 5. Confirm existing customers excluded (reporting filter or ad set level)
````

### agency/_processes/meta-creative-engine-v3/06-publishing.md

````diff
@@ -94,7 +94,7 @@
 - **Campaign:** Prospecting CBO only. Never put new tests into Scale campaign.
 - **Budget:** Min spend cap = 20% of total daily CBO budget, applied at ad set level.
 - **Min budget check:** confirm each pack can receive at least 2–3× CPA/day with the cap. If not, the campaign budget is too low or there are too many packs.
-- **Attribution:** 7-day click (NOT 7d click + 1d view or 1d view). *Updated 2026-10-05 (dashboard alignment): set 7-day click at ad set creation. The dashboard stores both windows, decisions read 7-day click, see [[SOP_master]] section 11.6.*
+- **Attribution:** 7-day click (NOT 7d click + 1d view or 1d view). *Updated 2026-10-05 (dashboard alignment, corrected same day): the standard basis is 7-day click + 1-day view, set at ad set creation on every new ad set. The dashboard stores 7-day click, 1-day view and engaged view separately and reports the standard basis, see [[SOP_master]] section 11.6.*
 - **Audience:** Broad. No interest targeting. No lookalikes. The creative IS the targeting.
 - **Exclude existing customers** (uploaded customer list) + retargeting pools, at ad set level.
 
@@ -139,7 +139,7 @@
 - [ ] New ad set (pack) created per concept — never added to existing
 - [ ] All hook variants uploaded as separate ads, in hook-score order
 - [ ] Naming convention applied at ad and ad set level
-- [ ] Attribution: 7-day click; customers excluded; UTMs on all URLs
+- [ ] Attribution: 7-day click; customers excluded; UTMs on all URLs *(Updated 2026-10-05: standard basis is 7-day click + 1-day view, see Step 4)*
 - [ ] Min spend cap = 20% of daily CBO budget, set at ad set level
 - [ ] Launch log updated: ad set name, launch date, cap removal date, KPI snapshot
 - [ ] Status: 🔴 LIVE: TESTING
````

### agency/_processes/weekly-performance-review/SKILL.md

````diff
@@ -33,7 +33,7 @@
 
 Per ad set being reviewed:
 - Spend
-- ROAS (7-day click, excluding existing customers)
+- ROAS (7-day click, excluding existing customers) *(Updated 2026-10-05: the standard basis is 7-day click + 1-day view, see `SOP_master.md` section 11.6)*
 - Conversion count
 - Hook rate (if available)
 - Frequency
````

