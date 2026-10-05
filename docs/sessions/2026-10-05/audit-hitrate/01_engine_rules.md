# Meta creative engine: rules for testing, winners, hit rate, decisions

Prepared 2026-10-05 for the hit-rate audit. Read-only extraction from the One Eighty Second Brain. Every item is cited `file:line` or `file#heading`. Short quotes (under 20 words) only where wording matters. Where I infer rather than read, I say "inference".

## 0. Legend, source hierarchy, gaps

Path shorthand (all relative to `/Users/matej/Documents/_One Eighty/OE Second Brain`):

| Short | Full path |
|---|---|
| `SOP_master`, `01` to `08` | `agency/_processes/meta-creative-engine-v3/SOP_master.md`, `01-research.md` ... `08-feedback-loop.md` |
| `HANDLIR` | `agency/_playbooks/handlir-meta-ads-creative-testing-playbook.md` |
| `M4` | `M4 Method - The Moonlighters.md` (repo root, Sam Piliero, last updated 2026-05-11) |
| `WPR` | `agency/_processes/weekly-performance-review/SKILL.md` |
| `CONCEPT-SKILL` | `agency/_processes/concept-architecture/SKILL.md` |
| `BRIEF-SKILL` | `agency/_processes/meta-ad-brief/SKILL.md` |
| `FOUNDER-PB` | `agency/_playbooks/founder-ads/founder-ads-playbook.md` |
| `FOUNDER-ANALYSIS` | `agency/_playbooks/founder-ads/founder-ads-account-analysis.md` |
| `MANAMI` | `_clients/manami/learnings/meta-ads.md` |
| `VENEV` | `_clients/venev/learnings/meta-ads.md` |
| `DASH-BRIEF` | `one-eighty-dashboard-repo/CREATIVE_ENGINE_BRIEF.md` (dashboard side, not engine; used only to trace "Nathan ~5%" and to compare) |

Source hierarchy as the repo states it:
- `SOP_master:23` calls itself "the single source of truth" for producing, testing and scaling Meta creative. Version 3.0, `last_updated: 2026-09-26` (`SOP_master:5-7`). Sub-SOPs `06` and `07` carry `last_updated: 2026-07-08` (`06-publishing.md:12`, `07-analyzing.md:12`).
- It is a merge of Blue Sense Digital (BSD) 2026 framework and M4 (`SOP_master:8`). Section 1 is "the ruling" where they disagree (`SOP_master:23`, `SOP_master:39-60`).
- Parallel or stale rule sets exist and are listed in section 6: `WPR`, `CONCEPT-SKILL`, `HANDLIR` (community advice, not a rule set), `M4` (source), client files.

Gaps that matter for an auditor:
- `[[meta-provozni-pravidla]]`, `[[meta-diagnoza-2026-09-04]]` and `[[promo-kalendar-q4-2026]]` are linked from `MANAMI:8`, `MANAMI:88`, `MANAMI:182`. I searched the whole OE Second Brain tree (filename and content) and found no such files. Manami-specific rules cited from them (25-purchase read threshold, 4-ad pack minimum, one live test pack, 1.80 to 2.49 "band" rule, 5-of-6 Nezna rule, winner-lane rule) are therefore visible only second hand in `MANAMI`.
- The "oneeighty KPI Calculator" (`SOP_master:88`, `SOP_master:205`) is not in the repo. `SOP_master:88` says "No absolute numbers live in this process", so per-client Target ROAS, Floor, CPA come from the calculator, not from files. Only Manami has these numbers written down (in `MANAMI`).
- `WPR:27` and `WPR:118` require `agency/frameworks/meta-ads-sop.md`. `agency/frameworks/` does not exist. It also requires `templates/weekly-review.md`.
- No external hit-rate reference (such as ~5%) appears anywhere in `agency/` or `_clients/`; only internal win-rate targets of 25% exist (section 4.2). "Nathan ~5%" appears only in the dashboard brief (`DASH-BRIEF:527`, `DASH-BRIEF:597`). "Nathan" in the engine docs means Nathan Perdriau of Blue Sense Digital (`agency/_playbooks/ad-scripting/ad-scripting-playbook.md:11`, `_clients/dobias/brain_dobias.md:70`). I could not verify the 5% from any engine document. "Piliero" appears as the M4 author (`M4:2`) and once as a rule name in `MANAMI:162`.
- ClickUp field definitions live in ClickUp, not in the repo. I list the fields the repo names (section 5); I did not query ClickUp.

---

## 1. Test structure

### 1.1 Unit of testing
- Concept = Persona x Angle x Offer x Format, "the unit of testing" (`02-ideation.md:19`, `CONCEPT-SKILL:19`).
- "One ad set = one concept" (`02-ideation.md:19`, `CONCEPT-SKILL:19-21`, `BRIEF-SKILL:122`). Ad set is called a pack (`SOP_master:139`, `06-publishing.md:25`: "one pack = one ad set = one concept").
- Exception: SMALL tier launches "Whole weekly batch in ONE new pack" (`SOP_master:73`, `06-publishing.md:70`), so a SMALL pack can hold several concepts.
- Concept is not an ad: "One concept can have 10 ad variants" (`CONCEPT-SKILL:94`).
- New concept needs a different persona, or angle type, or offer structure (`02-ideation.md:79-81`, `CONCEPT-SKILL:67-70`). A format change alone does not pass that check.

### 1.2 Campaign / ad set setup
- CBO always, all tiers and spend levels (`SOP_master:45`, `06-publishing.md:68`). "There is no ABO testing in the One Eighty system" (`06-publishing.md:68`). Do NOT use ABO for new testing (`06-publishing.md:126`).
- Prospecting CBO holds the packs (`SOP_master:122`). Scaling Campaign (separate CBO) from MID tier, created when first winner graduates (`SOP_master:123`). Retargeting optional (`SOP_master:124`). Retention removed from standard structure (`SOP_master:58`).
- Non-negotiables: Sales objective, 7-day click only, broad only, exclude existing customers, UTMs, min spend cap on every new pack (`SOP_master:128-133`). No interest targeting, no lookalikes (`06-publishing.md:98`, `SOP_master:56`).
- Tiers by monthly Meta spend: SMALL under $3k, MID $3k to $15k, LARGE $15k+ (`SOP_master:70`). No currency conversion rule is given for CZK accounts.
- Weekly launch cadence: every batch goes into NEW ad sets, existing ad sets "never topped up, performing or not" (`SOP_master:46`, `SOP_master:122`, `06-publishing.md:27`).
- Iteration of an existing concept = NEW ad set with vN bumped, original keeps running (`06-publishing.md:71`).

### 1.3 Budgets and spend floors
- Min spend cap per new pack = 20% of total daily CBO budget, "Exactly 7 days", removed on day 7 "no exceptions" (`06-publishing.md:78-88`, `SOP_master:45`, `SOP_master:108`, `SOP_master:133`). Example: 1,000 CZK/day campaign gives a 200 CZK/day floor (`06-publishing.md:86`).
- Min budget per pack = 2 to 3x CPA per day (`SOP_master:53`, `SOP_master:107`, `06-publishing.md:96`). `06-publishing.md:131`: do not launch a pack that cannot get "at least 2x CPA/day" with the cap.
- Min spend per ad = 0.5x CPA/day (`SOP_master:109`). Max creatives per pack = daily budget / (0.5x CPA) (`SOP_master:82`, `SOP_master:110`, `06-publishing.md:70`, `06-publishing.md:132`).
- Scaling Campaign budget = 2 to 3x the testing CBO daily budget (`SOP_master:51`, `SOP_master:122`, `07-analyzing.md:161`).
- KPI inputs per client: break-even ROAS (floor), Target ROAS, AOV, current CPA, tier, evaluation cadence, new-ads quota (`SOP_master:90`). There is no "Target CPA" input (see 6.19).

### 1.4 Ads per ad set, hooks per body
- Not a fixed number: derived from budget (formula above). "Produce the full hook count, upload only what the budget can feed, rank by hook score, queue the rest" (`SOP_master:82`).
- Tier table: hook variants per body 6 (upload top 3 to 4 SMALL, 4 to 5 MID); LARGE 6 to 10, upload all that clear the budget rule (`SOP_master:74`).
- Brief must carry minimum 6 hooks, scored; production minimum 6 per body (`03-briefing.md:85`, `03-briefing.md:197`, `04-creating.md:22`, `04-creating.md:74`).
- Each hook is a separate ad with its own creative ID (`06-publishing.md:105`, `08-feedback-loop.md:27`: "Each new hook = new creative ID").
- Founder ads: produce 2 to 6 hooks per body, upload 2 to 3 (`FOUNDER-PB:35`, `agency/_processes/founder-ads/04-point-scripts.md:72`). BSD source says 2 to 4, up to 8 (`agency/_playbooks/founder-ads/sources/bsd-founder-ads-masterclass-summary.md:100`).
- Other sources: M4 packs of 4 to 8 ads (`M4:113`); HANDLIR 3 to 5 per ad set at small budgets, 5 to 10 at 5,000+ CZK/day (`HANDLIR:119-131`, `HANDLIR:313-316`); Manami "pack minimum is 4 ads" (`MANAMI:63`); Dobias weekly ad sets with 3 to 6 creatives (`_clients/dobias/meetings/2026-07-07-peter-dobias-personal-meeting-room.md:77`); sub-100k/month rule 4 creatives per pack (`agency/meetings/internal/2026-09-20-ai-meeting-note.md:28`, `:109`).

### 1.5 Duration, learning phase, no-touch
- Days 0 to 7: cap active and also the no-touch window, "Record data, do not act" (`07-analyzing.md:32-35`, `SOP_master:57`, `SOP_master:77`). Day 7: cap removal mandatory (`07-analyzing.md:37-39`).
- Review runs every Monday, 45 to 60 min (`07-analyzing.md:9`, `SOP_master:57`). Packs in the window are marked NO-TOUCH and exempt (`SOP_master:57`).
- Learning phase gate: under 50 purchase events means HOLD (`07-analyzing.md:75-77`, `SOP_master:192`). No time window or level (ad set or campaign) is given.
- Other durations in the repo: M4 says wait 7 to 14 days, 14 if spend under $1K/day (`M4:194-196`); HANDLIR 3 to 7 days (`HANDLIR:104`, `HANDLIR:290`); Manami runs 14-day windows (`MANAMI:78`, `MANAMI:92`, `MANAMI:94`); Manami client sync 2026-09-10 "14denni testovaci okno" (`_clients/manami/meetings/2026-09-10-manami-strategy-sync-call-oe.md:40`, `:56`); Venev kickoff describes 7 days of min spend then removal (`agency/meetings/external/2026-08-03-meeting.md:68-70`).

### 1.6 Cadence and quota
- New ads per month: SMALL 4 to 6, MID 8 to 16, LARGE 20+ (`SOP_master:76`, `02-ideation.md:28`, `08-feedback-loop.md:66`). Active personas SMALL 5 to 8, MID 8 to 15, LARGE 15 to 30 (`SOP_master:75`, `01-research.md:69`).
- Internal decision 2026-09-20 for accounts under 100k CZK/month: 2 packs/month, 4 creatives each, 14-day cycle, min spend 1x CPA/day. The note admits ~3.5 conversions per ad per 14 days, "nizky signal", accepted as a compromise (`agency/meetings/internal/2026-09-20-ai-meeting-note.md:28`, `:107-111`). This is 8 new ads/month and is not written into the SOP.
- HANDLIR: new wave every 1 to 2 weeks (small accounts), about 10 creatives/week for 100k+ accounts (`HANDLIR:139-146`).

### 1.7 What counts as "launched" and "a test"
- "Launched" in the SOP = new pack created in the correct structure, named, tracked, cap set, cap-removal date logged, ClickUp status 🔴 LIVE: TESTING (`SOP_master:179`, `06-publishing.md:114-120`, `06-publishing.md:139-145`).
- No SOP text defines "a test" by a count of ads, purchases or days. A test is a pack; a verdict needs the spend gates (1x, 1.5x, 2x, 3x CPA) after the no-touch window (`SOP_master:102-106`, `07-analyzing.md:69-121`).
- Manami adds: "pack test size" = 25 purchases, about 11,600 CZK (`MANAMI:149`); only one live "test pack" at a time, and an ad set pruned to proven creative is a "carrier", not a test (`MANAMI:164`); a one-ad pack gives Meta nothing to choose between (`MANAMI:63`). These come from the missing `meta-provozni-pravidla`.
- Manami counts "67 ads ran" for the nine net-new personas introduced Jun to Aug (`MANAMI:37`).

### 1.8 Net-new vs iteration vs variant, and how variants are counted
- Concept type on brief: Net New / Iterative / Replication (`03-briefing.md:35`). Ideation output requires a "Net New / Iterative / Replication classification ... (feeds the 80/20 tracking)" (`02-ideation.md:92`). ClickUp field "Production Type" (`03-briefing.md:200`); iteration tasks get Production Type = "Iterative", linked to the parent (`08-feedback-loop.md:21`). "Replication" is never defined anywhere.
- Iteration types: 1 Hook swap (6 to 10 new hooks on the same body, minimal production), 2 Format translation (change only Format), 3 Persona swap (change only Persona, rewrite hook), 4 Full concept iteration (keep persona, change angle, restart at stage 2), 5 Scene swap, 6 Role swap, 7 Involvement swap (`08-feedback-loop.md:23-61`).
- Each hook = its own ad / creative ID (`06-publishing.md:105`). Six hooks on one body are six ads of one concept.
- Founder ads are "a visual type", not a concept; "A body or a shoot is not a concept and not a pack" (`FOUNDER-PB:33-34`). BSD's "any variable change = new concept" is overridden (`FOUNDER-PB:34`).
- Graduation duplicates the AD by post-ID into the Scaling Campaign, original keeps running (`07-analyzing.md:161-167`). The SOP gives no rule on whether that duplicate counts as a new "ad launched".
- Re-uploading a proven creative as a fresh ad is not addressed by the SOP. Manami measured it: three winners copied as fresh ads on 2026-08-25 returned 0.54, 1.20, 0.59 vs 1.94, 2.19, 1.73 in the original ad set. Rule: never re-upload, duplicate by post ID or prune in place (`MANAMI:44-53`, `MANAMI:163`). HANDLIR recommends copying via Post ID to keep social proof and recycling seasonal winners after a 3 to 6 month rest (`HANDLIR:176-182`, `HANDLIR:255-259`).
- 80/20: "80% of production effort ... iterations of proven winners ... 20% researched net-new" (`SOP_master:33`). Also expressed as a quota fill (`02-ideation.md:28`, `08-feedback-loop.md:66`). Manami states it as "5 iterations of a proven winner per 1 net-new concept" (`MANAMI:37`).

---

## 2. Winner definition(s)

### 2.1 The One Eighty definition (SOP v3)
"Winner definition (all three simultaneously)" (`07-analyzing.md:150-154`, `SOP_master:50`, `SOP_master:194`):
1. Creative receives >= 20% of total pack spend ("Meta is actively preferring it").
2. Campaign ROAS >= Target x 1.2 for two consecutive evaluation periods.
3. Pack CPA at or below target.

Plus: "NEVER cherry-pick low spend + high ROAS. A 15x ROAS ad on trivial spend is not a winner" (`07-analyzing.md:156`).

Metric basis: ROAS and CPA on 7-day click only (`SOP_master:129`, `07-analyzing.md:16`); existing customers excluded (`07-analyzing.md:16`, `07-analyzing.md:55`). Primary metric at ad level is Amount Spent, not last-click ROAS (`07-analyzing.md:16`). "Evaluation period" is never given a length; review cadence is weekly (`07-analyzing.md:9`) and "evaluation cadence" is a per-client KPI input (`SOP_master:90`).

Thresholds (from the KPI calculator, relative to the client's Target/Floor, `SOP_master:96-110`):
- Floor ROAS = 1 / effective margin; Target ROAS set at onboarding; Scale zone = Target x 1.2; Aggressive zone = Target x 2.0 for 14+ days; Hold zone = Target x 0.9 to x 1.2; Iterate zone = Floor to Target x 0.9; Kill zone = below Floor AND dragging campaign ROAS.
- Spend gates per pack: hold below 1x CPA; investigate 0 conversions at 1.5x CPA; iterate needs 2x CPA; kill needs 3x CPA.

### 2.2 Graduation (winner promotion) triggers
- After 2+ evaluation periods with the Winner Definition met, duplicate the winning ad via post-ID into the Scaling Campaign (MID/LARGE) (`07-analyzing.md:161`). SMALL: raise the winning pack's budget 20 to 30% (`07-analyzing.md:160`, `SOP_master:79`, `SOP_master:196`).
- Separate trigger in the decision tree: pack ROAS >= Target x 2.0 for 14+ days = AGGRESSIVE SCALE and "evaluate for Scaling Campaign graduation" (`07-analyzing.md:92-94`).

### 2.3 Other winner definitions found
- M4 (source): winner = "top and bottom of funnel metrics inside KPI AND ranks in the top 10-15% of all creatives tested"; high spend + at/above target ROAS = graduate; never cherry-pick low spend + high ROAS (`M4:88-94`, `M4:201-202`). SOP v3 replaced the top 10 to 15% rank test with the hybrid in 2.1 (`SOP_master:50`).
- BSD raw per the SOP table: "ROAS gates only" (`SOP_master:50`).
- Old SOP-11 tree in `WPR:42-56`: scale at ROAS >= 2x target for 7+ days, aggressive at >= 3x for 14+ days, kill at < 0.5x target with $300+ spend, $150 spend gate. Still published (see 6.8).
- Concept kill criteria in `CONCEPT-SKILL:84`: "usually ROAS < 0.5x target at $300+ spend".
- Founder ads: "winner" in practice = ranked by spend, then ROAS and CPA compared with the segment benchmark (`agency/_processes/founder-ads/02-mining-and-teardown.md:69-72`). Example: Dobias MitoBoost TOF, USD 5,343, ROAS 3.74, CPA USD 36 vs 2.96 / USD 46 for non-founder TOF (`FOUNDER-ANALYSIS:22`, `FOUNDER-ANALYSIS:62`; slate calls it "MitoBoost TOF winner", `_clients/dobias/founder/shoots/2026-10-shoot/slate.md:21`). That bar is "beats benchmark", not Target x 1.2.
- Strategy scorecard: "Creative win rate (% creatives with positive ROI)", target 25%+, owner Lukas (`agency/_strategy/Strategy.md:223`).
- Dashboard brief (for comparison only): Winner = at or above target ROAS with "Read" confidence; Carrier = above kill line, under target; Loser = below kill line past the 3x CPA gate (`DASH-BRIEF:519-527`).

### 2.4 Confidence / significance rules
- Engine docs contain no statistical rule. Only: Gate 1 under 50 purchase events = HOLD (`07-analyzing.md:75-77`); CPA-multiple spend gates (`SOP_master:103-106`); "TRUST THE PACK ROAS, NOT INDIVIDUAL AD ROAS" (`07-analyzing.md:129`); frequency/diagnostics are "never decide alone" (`07-analyzing.md:132`).
- Manami-level (from the missing rules doc, restated in `MANAMI`): 25 purchases needed per decision (`MANAMI:60`, `:82`, `:149`, `:170`); trivial-spend line 1x CPA per 30 days, "never read below this" (`MANAMI:142`, `:152`); per-ad signal floor 0.5x CPA/day (`MANAMI:151`); "Only 30-day reads with >= 25 purchases are decision-grade" and weekly numbers only to spot collapses (`MANAMI:68`, `MANAMI:170`); consecutive 30-day windows share 23 of 30 days and are not independent (`MANAMI:170`); a rolling window can resurrect a dead ad set, check spend not just ratio (`MANAMI:171`); small-sample freak ROAS must not be read (`MANAMI:162`).
- Dashboard brief (comparison only): SE(ROAS) about 1.17/sqrt(purchases); about 65 purchases to separate a 2.50 target from a 1.80 kill line at 95% (`DASH-BRIEF:30-34`); shrinkage with k = 25 (`DASH-BRIEF:71`).

### 2.5 Who decides and when
- Stage 7 owner: Account Manager, Matt (`SOP_master:180`, `07-analyzing.md:8`). Every Monday morning, before new briefs (`07-analyzing.md:9`). "Budget or status changes in Ads Manager happen only as the execution of a logged decision from stage 7" (`SOP_master:186`).
- Execution: SOP step 4 says the AM updates CBO budget and turns off the ad set (`07-analyzing.md:138-141`); publishing/cap handling belongs to the Media Buyer, Lukas (`06-publishing.md:8`). Brief approval: Matt (`03-briefing.md:8`).
- Practice at Manami: Lukas executed budget changes within hours, pauses did not land for three weeks (`MANAMI:29`, `:62`, `:69`). Winner-lane pause "Matt decides that; it is not an automatic pause" (`MANAMI:87`).

### 2.6 Per-client numbers written in the repo

| Client | Number | Source |
|---|---|---|
| Manami | Working kill line ROAS 1.80 ("Meta over-reports against Shoptet"); theoretical break-even 1.46 at gross margin 68.4% | `MANAMI:155` |
| Manami | Target ROAS 2.50; judge at "1,8 kill line / 2,5 target"; winner threshold per SOP = 2.5 x 1.2 = 3.00, "graduation needed >= 3,00 twice" | `MANAMI:78`, `MANAMI:85`, `MANAMI:71` |
| Manami | CPA 463 Kc (30d), CPA at kill line 520 Kc, at target 375 Kc; AOV 937 Kc | `MANAMI:144-145` |
| Manami | Pack test size 25 purchases about 11,600 Kc; min pack spend 926 Kc/day (2x CPA); per-ad floor 232 Kc/day; trivial line 463 Kc/30d | `MANAMI:149-152` |
| Manami | Client call: break-even ROAS "odhadovan na 1,4; interne hlidano 1,6" | `_clients/manami/meetings/2026-09-10-manami-strategy-sync-call-oe.md:53` |
| Manami | Budget step cap +20 to 25%; SK ladder +25%/week from 350 to 1,000 Kc/day, hold if ROAS under 1.8 | `MANAMI:38`; `_clients/manami/learnings/meta-ads.md.bak2:46` |
| Manami | Scale-step rule from March call: max 20% to avoid learning reset | `agency/meetings/internal/2026-03-13-meeting.md:43` |
| Dobias | Target ROAS >= 3.5 evaluated at ad set/campaign level after 7 days min spend; weekly new ad sets of 3 to 6 creatives; do not turn off individual ads | `_clients/dobias/meetings/2026-07-07-peter-dobias-personal-meeting-room.md:24`, `:40`, `:77` |
| Dobias | "$160 AOV-based creative kill rule" listed as client-specific rule; not defined in any file | `_clients/dobias/brain_dobias.md:66` |
| Dobias | Learnings file `meta-ads.md` is empty ("Empty" in What works / fails), last_updated 2026-05-22 | `_clients/dobias/learnings/meta-ads.md:20-34` |
| Venev | Restart gate 2: CPM <= 300 Kc, CTR >= 2.0%, ROAS >= 1.0; target ROAS M12 2.08; growth model targets Meta ROAS 2.75; break-even CPA about 783 Kc | `VENEV:87`, `VENEV:102`, `_clients/venev/audit/venev-growth-model.md:18`, `VENEV:51` |
| Venev | CZ unlock gate: SK Meta ROAS >= 1.8 at >= 40k/month, SK CVR >= 1.2%, 2+ translatable concepts | `_clients/venev/brain_venev.md:80` |
| Venev | Kickoff: min spend 2 to 3x CPA for 7 days then removed; kill when high spend and low ROAS (example 10,000 EUR at 1.5 to 1.7) | `agency/meetings/external/2026-08-03-meeting.md:68-71` |
| Agency | Average ROAS target all e-com clients 3.5x+ (Strategy); reporting skill compares Meta ROAS to 3.5x | `agency/_strategy/Strategy.md:222`, `agency/_processes/reporting/analysis/SKILL.md:264` |
| Ethia, RawBark | No Meta decision thresholds in repo. ETIA "KPI/ROAS floor" still to be defined (2026-09-20). RawBark purchase-value tracking "looks broken" (ROAS > 100 on several ads) | `agency/meetings/internal/2026-09-20-ai-meeting-note.md:44`, `FOUNDER-ANALYSIS:36` |

How Manami labels "winners" in `MANAMI`: `Nezna - 13MAR - OE` ROAS 2.38 lifetime, "primary winner" (`:21`); `NicheScentLover - Testovaci sada` ROAS 2.45, 37 purchases, "Second proven winner" (`:22`); `Limitka Nezna Last Call` ROAS 4.30 on 17 purchases, flagged under the 25-purchase threshold and promo-confounded (`:28`). See 6.15.

---

## 3. Loser / kill, carrier / iterate, scale rules

### 3.1 Kill and hold (SOP v3, decision tree `07-analyzing.md:65-130`)
Order of gates (`07-analyzing.md:69-121`, `SOP_master:192`):
- Gate 0: min spend cap active or launched < 7 days: NO-TOUCH.
- Gate 1: learning phase (< 50 purchase events): HOLD.
- Gate 2: pack spend below 1x CPA: HOLD.
- Gate 3: KPI zones.

Zone outcomes:
- HOLD: pack ROAS Target x 0.9 to x 1.2 with spend >= 1x CPA (`07-analyzing.md:96-97`). Also HOLD: pack not within KPI after 7 days but overall campaign ROAS at or above floor; "Do not kill healthy campaigns" (`07-analyzing.md:107-110`, `SOP_master:47`).
- KILL: pack ROAS below Floor AND receiving significant spend AND dragging overall campaign ROAS below floor (`07-analyzing.md:112-115`, `SOP_master:47`, `SOP_master:102`). Action: pause ad set, ClickUp 🛑 KILLED, mandatory note (angle, persona, offer, spend, ROAS, why killed) (`07-analyzing.md:114-115`, `07-analyzing.md:141`).
- Zero conversions at spend >= 1.5x CPA: PAUSE + INVESTIGATE (landing page, UTM, ad promise match); if fine, KILL concept after 2+ full eval periods with 0 conversions (`07-analyzing.md:117-121`).
- Never turn off individual low-ROAS ads in a pack that hits KPI (last-click hides sequencing) (`07-analyzing.md:124-129`, `SOP_master:60`).
- Cap removal on day 7 is mandatory regardless of performance (`07-analyzing.md:144`).

### 3.2 Iterate / "carrier"
- ITERATE zone: pack ROAS Floor to Target x 0.9 with spend >= 2x CPA (`07-analyzing.md:99-105`). Branch: Hook Rate < 20% and ROAS "in decent range" means hook problem, brief 6 new hooks on the same body (Type 1). Hook Rate OK but ROAS flat means angle/offer problem, format translation or angle variant (Type 2 / Type 4) (`07-analyzing.md:101-105`).
- Hook Rate defined as ThruPlays / Impressions x 100 (`07-analyzing.md:52`). Diagnostic bands: Hook Rate good >= 25%, warning 15 to 25%, bad < 15%; Hold Rate at 15s good >= 10%, bad < 5%; Outbound CTR good >= 1%; Frequency 7d good <= 2.0 (`07-analyzing.md:132`).
- Iterate action: status 🔁 LIVE: ITERATING, AM creates iteration instruction, CS assigned with type (`07-analyzing.md:142`; brief flow `08-feedback-loop.md:21`).
- "Carrier" is not an SOP term. Manami uses it for an ad set pruned to proven creative (`MANAMI:164`, `:22`, `:26`); the dashboard brief uses it for an ad above the kill line but under target (`DASH-BRIEF:525`). Manami also uses "winner lane" (the mature ABO ad set, `MANAMI:42`, `:87`), "harvest" (move best ad by post ID) and the "1.80 to 2.49 band: pause and harvest" rule (`MANAMI:88-89`).
- Pruning: pausing an ad does not reset the ad set's learning, adding one does (`MANAMI:163`). The SOP only forbids turning off individual ads inside a pack that hits KPI.

### 3.3 Scale
- SCALE: pack ROAS >= Target x 1.2 sustained one full eval period: raise campaign CBO budget +20 to 25%; do not add creatives, do not turn off low-ROAS ads (`07-analyzing.md:88-90`, `SOP_master:98`).
- AGGRESSIVE SCALE: >= Target x 2.0 for 14+ days: +30 to 40%, and evaluate for Scaling Campaign graduation (`07-analyzing.md:92-94`, `SOP_master:99`, `SOP_master:49`).
- Graduation per tier: SMALL raise winning pack budget 20 to 30%; MID/LARGE post-ID into Scaling Campaign CBO after 2+ eval periods with Winner Definition met (`07-analyzing.md:158-161`).
- Scaling Campaign rules: CBO, broad, same exclusions as Prospecting; contains only graduated winners via post-ID; never add untested concepts; never turn off the original winning pack (`07-analyzing.md:163-167`).
- Never: turn off the winner to "move" it; add new ads into a winning pack; duplicate ad sets; decide on individual ad last-click ROAS (`07-analyzing.md:169-173`).
- Frequency: monitor 7-day; 2.0 to 3.0 warning; > 3.0 act by adding a new concept in a NEW pack (`SOP_master:48`, `SOP_master:217`).
- Account health red flags (monthly): < 3 active concepts, ToF share of production < 70%, no new creatives in 30 days, one ad > 60% of spend, DPA > 10% of cold budget, founder-visual-type ads > about 40% of prospecting spend (soft indicator) (`SOP_master:213-223`).
- Cost caps only after M4 gate: 90+ days stable, $30k+/month, validated CPA target (`07-analyzing.md:193`, `SOP_master:198`).
- Monthly breakdowns (Fastest Horse) after 30+ days of data (`07-analyzing.md:189`).

### 3.4 Variant rules in other documents
- M4 pack rules: new creative = new pack; high performing = graduate; average = do not touch; high spend + low performance = pause ("catchy ad that doesn't convert"); low spend + poor performance = pause (`M4:115-120`). M4 also graduates into "Winners" single-interest ad sets (`M4:124-134`); SOP drops this (`SOP_master:56`).
- HANDLIR: kill a creative at about 2x average CPA spent with no conversion, or on soft metrics (CTR, CPC, add-to-cart); never during learning (`HANDLIR:106-111`, `HANDLIR:314`). Scale budget aggressively, "even more than 20%", scaling ABO campaign with 1 creative per ad set up to +100%/day (`HANDLIR:158-165`, `HANDLIR:316`); path test, then main, then scaling by post ID (`HANDLIR:176-182`).
- Reporting skill: under CBO "no per-ad verdicts", no Scale/Iterate/Kill badges or kill thresholds in client reports; the only recommendable levers are creative supply and campaign structure (`agency/_processes/reporting/analysis/SKILL.md:266-272`, `agency/_processes/reporting/learnings.md:135-142`).
- Manami working rules: kill line 1.80 on 30-day reads with >= 25 purchases; pause "fully armed" at spend 49x CPA (`MANAMI:80`); weekly numbers cannot rank ad sets (`MANAMI:170`); winner lane held at 2.28 because it sits in SOP's Target x 0.9 to 1.2 HOLD gate, not in the 1.80 to 2.49 pause band (`MANAMI:88`); graduation "needs >= 3,00 (target x 1,2) for two periods" (`MANAMI:85`).

---

## 4. Hit rate

### 4.1 Definition in the engine docs
- None. The SOP never defines hit rate. It states qualitatively: "Iterations of winners are the highest hit-rate creatives we will ever make" (`SOP_master:33`; same idea in `M4:205`). Goal stated as beating the baseline 2 to 5% per week (`SOP_master:33`, `M4:103`), which is not a hit rate.
- `ad-scripting-playbook.md:416` uses "hit rate" loosely (longer ads must raise hit rate or spend capacity).

### 4.2 Numbers that exist (numerator / denominator / period / cohort)

| Metric | Value | Numerator | Denominator | Period / cohort | Source |
|---|---|---|---|---|---|
| Manami net-new hit rate | about 1.5% (1 of 67, 1.49%) | "one cleared target" | 67 ads run for nine net-new personas (NicheScentLover, HeadacheOffice, BlindBuySkeptic, IngredientSkeptic, RitualSeeker, SensitiveSwitcher, IntimateScent, BusyMom, QuietElegance) | Jun to Aug 2026, net-new personas only | `MANAMI:37` |
| Same figure reused | "one winner from 67 ads, a hit rate of about 1.5%"; kill line ROAS 1.80 | as above | as above | as above | `agency/_playbooks/landing-pages/landing-page-playbook.md:222`; `DASH-BRIEF:529`, `DASH-BRIEF:596-597` |
| Reference value "Nathan ~5%" | about 5% | "winners" | "ads launched" (dashboard formula) | not stated | `DASH-BRIEF:527`, `DASH-BRIEF:597` only; not in engine docs |
| Agency scorecard "creative win rate" | target 25%+ per month | creatives with positive ROI | creatives (all) | monthly, owner Lukas | `agency/_strategy/Strategy.md:223` |
| Venev "win rate" | about 25% / "cil 25 %" | not defined | not defined | M1 to M12 plan | `_clients/venev/audit/venev-growth-model.md:51`, `_clients/venev/strategy/venev-roadmap-v2.md:326`, `_clients/venev/strategy/venev-roadmap-v1-superseded.md:341` |
| "creative win rate" input metric | "Unknown, no data" | n/a | n/a | audit 2026-06-01 | `agency/hormozi-audit-2026-06-01.md:27` |
| Piliero reference | none numeric | n/a | n/a | M4 only gives "top 10-15% of all creatives tested" as winner rank, which implies a 10 to 15% pool-level share by construction | `M4:88` |

The "Nathan ~5%" and "Piliero" references you cited: 5% only in `DASH-BRIEF`; Piliero has no hit-rate value (M4 text above).

### 4.3 Winner bar behind Manami's 1.5%
`MANAMI:37` says "one cleared target". The only named net-new winner from that cohort is NicheScentLover at ROAS 2.45 (`MANAMI:22`), which is below the stated target 2.50 (`MANAMI:78`) and below the SOP winner bar Target x 1.2 = 3.00 (`MANAMI:85`). Later it fell to 2.294 on 36 purchases with the graduation track "broken" (`MANAMI:71`). Inference: under the SOP v3 Winner Definition and Manami's target, Manami's net-new winners would be 0 of 67 as of 2026-10-05; the 1.5% uses a looser, undocumented bar. The stronger later result `Limitka Nezna Last Call` (4.30, 17 purchases, Marianne Days confounded) is an iteration of an existing angle, so it is outside the net-new cohort (`MANAMI:28`).

### 4.4 How hit rate drives decisions (as written)
- 80/20 production split and quota fill: `SOP_master:33`, `02-ideation.md:28`, `08-feedback-loop.md:66`, `02-ideation.md:92`. Manami target mix 5 iterations per 1 net-new (`MANAMI:37`).
- Hook variants first, because "Hook = highest leverage variable" (`BRIEF-SKILL:122-127`), Type 1 hook swap is "most common, highest leverage" (`08-feedback-loop.md:23`), 6 hooks per body (`SOP_master:74`).
- Persona cuts: archive a persona after 3+ tests without a working creative (`01-research.md:89`); active persona counts capped per tier (`SOP_master:75`). Dashboard brief claims the 1.5% is the argument for 80/20, hook variants over new bodies, and cutting the active persona set (`DASH-BRIEF:529-531`); the engine docs do not state that link.
- Landing pages: custom LP only for a concept whose ad "held the account's kill line over at least 25 purchases", because net-new concepts rarely win (`landing-page-playbook.md:222`).
- Volume planning: Venev growth model uses 80/20 and "win rate ~25%" to set at least 3 active concepts and feed Scale (`venev-growth-model.md:51`).

---

## 5. Feedback loop: what gets logged where

Per verdict (`08-feedback-loop.md:64-67`, `08-feedback-loop.md:71-74`):
1. Log learnings the same day to `clients/<client>/learnings/meta-ads.md` (in this repo `_clients/<client>/learnings/meta-ads.md`): what won, what died, hypothesis why, in persona / angle / offer / format terms. "A KILL without a documented learning is invalid" (`08-feedback-loop.md:64`).
2. Update banks: Persona & Angle Bank, Template Bank (winning templates "tagged as proven = 80% iteration sources"), Winner Library (post-IDs and files of all graduates) (`08-feedback-loop.md:65`).
3. Assemble next cycle: iteration briefs (80%) plus net-new from research and swipe log (20%) to fill the tier quota (`08-feedback-loop.md:66`).
4. Quarterly: promote patterns confirmed across 2+ clients to `agency/playbooks/` (`08-feedback-loop.md:67`).

ClickUp (named in the repo, definitions live in ClickUp):
- Pipeline statuses: 📝 BRIEF: IN PROGRESS, 👀 BRIEF: AWAITING APPROVAL, ✅ BRIEF: APPROVED, 🎬 IN PRODUCTION, 🔍 PRODUCTION: QA, optional 📱 TRIAL REEL: LIVE / 📊 TRIAL REEL: REVIEW, 🚀 READY TO UPLOAD, 🔴 LIVE: TESTING, then 📈 LIVE: SCALING | 🔁 LIVE: ITERATING | 🛑 KILLED (`SOP_master:158-164`). HOLD is a decision, not a status (`07-analyzing.md:143`).
- Weekly update of each live task: Amount Spent, Ad Set ROAS, Hook Rate, timestamp (`07-analyzing.md:59-61`).
- Launch log: Meta Ad Set Name custom field, launch date, cap-removal date, KPI thresholds at launch (target ROAS, floor, CPA gates), status (`06-publishing.md:114-120`). Decision log (weekly review record) (`SOP_master:166`).
- Brief/task custom fields: Persona, Angle Type, Offer, Format, Awareness, Production Type (`03-briefing.md:200`); CONCEPT TYPE Net New / Iterative / Replication (`03-briefing.md:35`); "Weekly Decision = Iterate" triggers iteration brief (`08-feedback-loop.md:21`); Visual Type (e.g. `Founder ads`, `Founder story`) (`agency/_processes/founder-ads/SKILL.md:59`); founder layer fields: involvement, role, proof type, story element (`03-briefing.md:77-82`).
- Persona Bank task fields: Name, Persona ID, template fields, Status Active/Archived, Last tested, Performance (link to best creative, filled retrospectively) (`01-research.md:80-89`).
- "Content Purpose" appears only in a 2026-03-13 meeting transcript (values mentioned: Evergreen, Offer, Promo, Winner Variant) and in Manami ad files ("Net-new" to "Offer-Promo"), not in any SOP (`agency/meetings/internal/2026-03-13-meeting.md:607`, `:839`; `_clients/manami/ads/2026-09-03-QuietElegance-BenefitBullets-Nezna-STAT-v1.md:204`).
- Concept statuses mirrored in repo frontmatter: `briefing`, `in-production`, `live`, `iterating`, `scaling` ("winner, budget scaling up"), `killed` with `killed_reason`, `superseded` (`GLOSSARY.md#Status values (in frontmatter, mirrored in ClickUp)`, lines 65-80).
- Dashboard-side additions (not in SOP): fields Offer, Production method, Creator, Body, Hook, Production cost, Brief, Creative ID; the brief says Creative ID has never been filled on any of the 65 Manami tasks (`DASH-BRIEF:157-177`, `DASH-BRIEF:137-141`).

Repo logging pattern:
- Per-client files are append-only with sections What works / What fails / Open questions / Benchmarks / Audit log, and `[SUPERSEDED: date]` tags (`MANAMI:12-15`; `VENEV:12`).
- Index mapping: `meta-ad-brief` + `concept-architecture` write to `clients/<client>/learnings/meta-ads.md`; `founder-ads` also writes `agency/_processes/founder-ads/learnings.md`; `weekly-performance-review` writes the channel file plus `agency/digests/` (`brain.md:97-109`). `BRIEF-SKILL:111-118` lists the post-launch fields: spend at decision point, hook rate (top 3 hooks vs floor), ad-set ROAS, decision and reasoning. `WPR:63-67` and `WPR:72-105` give the weekly review output format.
- Cross-client learnings files for `weekly-performance-review`, `concept-architecture`, `meta-ad-brief` are all empty (`agency/_processes/weekly-performance-review/learnings.md:18-27`, `agency/_processes/concept-architecture/learnings.md:18-27`, `agency/_processes/meta-ad-brief/learnings.md:17-32`). Dobias `meta-ads.md` is empty (see 2.6). Populated: Manami, Venev.
- Founder-ads patterns land in `FOUNDER-PB` Learnings (append-only) once seen in 2+ clients (`FOUNDER-PB:273-294`).

---

## 6. Contradictions and ambiguities between documents

1. Budget mode. SOP: CBO only, "no ABO testing" (`SOP_master:45`, `06-publishing.md:68`, `:126`). Manami's winner lane is an ABO ad set (`MANAMI:21`, `:24`); 2026-07-07 decision keeps ABO as performing pillar plus CBO packs (`agency/meetings/internal/2026-07-07-oe-sync-call.md:23`, `:34`). HANDLIR allows ABO or CBO tests and an ABO scaling campaign with 1 creative per ad set (`HANDLIR:22-42`, `:100`), while SOP scaling campaign is CBO (`SOP_master:123`). The reporting skill asserts "These accounts run campaign budget optimisation" (`reporting/analysis/SKILL.md:267`). Also SMALL-tier "raise winning pack's budget 20 to 30%" (`07-analyzing.md:160`, `SOP_master:196`) presumes an ad set budget, while the same table says "+20-30% CBO budget" (`SOP_master:79`).
2. Minimum spend floor, four values: 20% of daily CBO budget (`06-publishing.md:80`); 2 to 3x CPA/day (`SOP_master:53`, `:107`); "at least 2x CPA/day with the cap" (`06-publishing.md:131`); 1x CPA/day (`2026-09-20-ai-meeting-note.md:28`, `:109`); Manami 2x CPA via `daily_min_spend_target` (`MANAMI:92`). At Manami, 20% of a 1,000 Kc campaign is 200 Kc/day vs 926 Kc/day for 2x CPA (`MANAMI:150`, `:153`). `06-publishing.md:96` itself says if a pack cannot reach the minimum, the budget is too low or there are too many packs.
3. Test window / no-touch: 7 days (`SOP_master:77`, `07-analyzing.md:32-35`) vs 14 days (`MANAMI:78`, `:92`; `2026-09-20-ai-meeting-note.md:28`; Manami call 2026-09-10 `:40`; `DASH-BRIEF:468`) vs 3 to 7 (`HANDLIR:104`) vs M4's 7 to 14 depending on spend (`M4:194-196`).
4. Attribution. SOP: 7-day click only, 1-day view removed (`SOP_master:10-18`, `:52`, `:129`; `06-publishing.md:97`). 2026-06-10 agreed to move to 7-day click (`2026-06-10-sync-call-oe.md:22`, `:30`); 2026-09-20 decided to keep 7-day click + 1-day view, "inspirace Sam", and to set it on accounts (`2026-09-20-ai-meeting-note.md:27`, `:40`, `:103-105`); Venev restart plan says 7d click / 1d view (`VENEV:86`); Manami has 6 of 9 ad sets off strict 7-day click, drifting (`MANAMI:64`, `:161`, `:166`, `:172`); founder analysis notes 7-day click could not be forced (`FOUNDER-ANALYSIS:117`). The SOP cites M4 for 7-day click only (`SOP_master:52`).
5. Level of the winner test and of decisions. Winner item 2 says "Campaign ROAS" (`07-analyzing.md:153`, `SOP_master:50`), the decision tree uses pack ROAS (`07-analyzing.md:88`), item 1 is ad level (share of pack spend), and the tier table says SMALL decides at "Ad level" while stage 7 says "Decisions at AD SET (pack) level" (`SOP_master:78` vs `07-analyzing.md:16`). Manami applies the winner bar to ad sets (`MANAMI:85`).
6. Two graduation / scale triggers and undefined "eval period": SCALE at Target x 1.2 for one period (`07-analyzing.md:88`); AGGRESSIVE at x 2.0 for 14+ days then "evaluate for graduation" (`:92-94`); graduation at x 1.2 for two periods (`:152-153`, `:161`). Length of an evaluation period is never stated (weekly cadence vs 30-day reads at Manami, `MANAMI:170`).
7. Scale step size: +20 to 25% (`07-analyzing.md:89`), +20 to 30% SMALL (`SOP_master:79`), +30 to 40% (`07-analyzing.md:93`), HANDLIR "even more than 20%, up to +100%/day" (`HANDLIR:158-165`), Manami cap +20 to 25% and ~20% learning reset (`MANAMI:38`).
8. Stale decision rules still live: `WPR:42-56` ($150 and $300 absolute gates, scale at 2x target, aggressive at 3x, kill below 0.5x target at $300+) and `CONCEPT-SKILL:84` (kill at ROAS < 0.5x target at $300+) conflict with relative gates and the "dragging campaign below floor" kill rule (`SOP_master:49`, `:55`, `:47`). `WPR` also points at non-existent files (see section 0).
9. Learning-phase gate vs reality: Gate 1 HOLD under 50 purchase events (`07-analyzing.md:75-77`) with no window; Manami ad sets get 2 to 5 purchases/week and 6 to 85 per 30 days (`MANAMI:68`, `DASH-BRIEF:21-28`), so the gate would HOLD nearly everything. Manami uses 25 purchases per 30-day read (`MANAMI:170`) and trivial line 1x CPA (`MANAMI:152`), versus the SOP kill gate of 3x CPA (`SOP_master:103`) and iterate gate 2x CPA (`:104`). The 2026-09-20 note shows ~3.5 conversions per ad per 14 days accepted (`:111`).
10. Hook rate. Definition ThruPlays / Impressions (`07-analyzing.md:52`) vs 3-second views / impressions in the account analysis (`FOUNDER-ANALYSIS:39`). Thresholds: iterate branch at < 20% (`07-analyzing.md:101`, `08-feedback-loop.md:25`) vs diagnostic bands 25 / 15 to 25 / < 15 (`07-analyzing.md:132`).
11. Packs per concept: "one ad set = one concept" (`02-ideation.md:19`) vs SMALL "whole weekly batch in ONE new pack" (`SOP_master:73`, `06-publishing.md:70`); `06-publishing.md:129` prohibits multi-concept ad sets only for MID/LARGE. Under `MANAMI:63` a pack must have 4 ads; the SOP has no minimum.
12. What is "a new concept": tuple includes Persona and Format (`02-ideation.md:19`), uniqueness check accepts persona OR angle OR offer (`02-ideation.md:81`), yet Type 2 (format) and Type 3 (persona swap) are classified as iterations (`08-feedback-loop.md:29-39`). Dashboard brief says changing angle or persona is a new concept (`DASH-BRIEF:113`). Manami's "net-new" cohort = new personas (`MANAMI:37`). The Net New / Iterative / Replication classification (`02-ideation.md:92`) therefore is not reproducible from the tuple, and "Replication" is undefined.
13. 80/20 expressed three ways: production effort (`SOP_master:33`), quota of new ads (`02-ideation.md:28`), 5 iterations per 1 net-new (about 83/17, `MANAMI:37`). Pack rule "5 of 6 ads Nezna iterations" (`MANAMI:92`) is not in the SOP.
14. Four different "hit rate" quantities: Manami net-new hit rate 1.5% (`MANAMI:37`), agency "creative win rate (% creatives with positive ROI)" 25%+ (`Strategy.md:223`), Venev win rate 25% (`venev-growth-model.md:51`), dashboard "winners / ads launched" vs "Nathan ~5%" (`DASH-BRIEF:527`). They differ in numerator bar (target vs positive ROI vs unstated), denominator (net-new vs all vs launched) and period. The SOP defines none.
15. Manami winner labels vs SOP bar: NicheScentLover 2.45 and Nezna 2.38 are called winners (`MANAMI:21-22`) while target is 2.50 (`MANAMI:78`) and graduation needs 3.00 twice (`MANAMI:85`, broken at `:71`). "One cleared target" (`MANAMI:37`) is inconsistent with that.
16. Floor / kill line: SOP Floor = 1 / effective margin (`SOP_master:96`) and kill only if below floor AND dragging campaign (`07-analyzing.md:112-115`). Manami: theoretical break-even 1.46, working kill line 1.80 (`MANAMI:155`), 1.4 / 1.6 on the client call (`2026-09-10 sync :53`), mechanical pause below 1.80 (`MANAMI:80`) and a band rule that pauses ad sets between 1.80 and 2.49 (`MANAMI:88-89`, `:106-109`), where the SOP says HOLD or ITERATE. `MANAMI:88` itself notes the band rule vs SOP's HOLD gate.
17. Pack surgery: SOP forbids switching off single ads in a pack that hits KPI (`07-analyzing.md:124-129`) but is silent on pruning below-KPI packs; Manami prunes packs to one or two "carriers" in place (`MANAMI:26`, `:163`). Both Manami and the SOP forbid topping up (`MANAMI:39`, `06-publishing.md:27`).
18. Owner of execution: SOP stage 7 says AM updates budgets and turns off ad sets (`07-analyzing.md:138-141`), stage 6 gives the Media Buyer ownership (`06-publishing.md:8`). Manami shows pauses unexecuted for 3 weeks, costing 33% to 46% of weekly spend (`MANAMI:62`, `:69`). Reporting skill: "we never turn ads off" under CBO (`reporting/analysis/SKILL.md:267`).
19. Winner needs "pack CPA at or below target" (`07-analyzing.md:154`) but KPI inputs list break-even ROAS, Target ROAS, AOV and current CPA, no Target CPA (`SOP_master:90`). Manami derives CPA from AOV / ROAS (`MANAMI:144`).
20. Dashboard-brief claims not in the SOP: "Rules, now written into SOP_master.md section 4.4" (`DASH-BRIEF:111`) but SOP_master ends at section 4.3 (`SOP_master:135-152`); brief cites path `agency/_processes/meta-creative-engine/` (`DASH-BRIEF:8`), other files also link the old path (`landing-page-playbook.md:1098`), actual folder is `meta-creative-engine-v3`; a 20 to 30% testing share of budget (`DASH-BRIEF:512`) and "SOP 30 % split" (`MANAMI:153`) do not exist in SOP v3 (only the 20% per-pack cap, `SOP_master:108`); 14-day no-touch (`DASH-BRIEF:468`) vs 7 days; hook-variant tagging `bNhN` (`DASH-BRIEF:127`) not in SOP.
21. Naming convention drift: SOP `[PersonaID]-[NAME] | [STAGE] | [FORMAT] | [DATE] | [vN] | [MKT]` (`SOP_master:146`, `06-publishing.md:47`); Manami ad notes cite "SOP 4.3" as `[Stage] | [ConceptID] | [Persona] | [Angle] | [Format] | [vN] | [DATE] | [MKT]` (`_clients/manami/ads/2026-09-03-BlindBuySkeptic-FlatLay-TestovaciSada-STAT-v1.md:189`); dashboard `[PersonaCode] | [ConceptID] | [Stage] | [Format] | [bNhN] | [DATE] | [MKT]` (`DASH-BRIEF:127`); real names in `MANAMI` have no vN or MKT (`MANAMI:22`, `:28`). Hook and iteration counting from names is unreliable; SOP `vN` is "iteration number" only (`06-publishing.md:59`), no hook or body index.
22. Frequency: SOP > 3.0 act, good <= 2.0 (`SOP_master:48`, `07-analyzing.md:132`); M4 2x min / 4x target (`M4:70`); HANDLIR death at 3 to 5+ (`HANDLIR:238`).
23. Statuses: master labels "🔴 LIVE: TESTING" (`SOP_master:162`) vs "🔴 TESTING" (`07-analyzing.md:61`) vs lowercase `live` / `iterating` / `scaling` / `killed` (`GLOSSARY.md:65-80`); there is no ClickUp status for HOLD or for "winner" (only `scaling` and the Winner Library bank, `08-feedback-loop.md:65`). Dashboard brief reports almost all 65 Manami tasks sitting at `live`, including ads killed in March (`DASH-BRIEF:175`).
24. Kill thresholds by source: HANDLIR 2x CPA no conversion (`HANDLIR:109`), SOP investigate at 1.5x CPA with 0 conversions then kill after 2+ eval periods (`07-analyzing.md:117-121`), Venev kickoff 10,000 EUR at ROAS 1.5 to 1.7 (`2026-08-03-meeting.md:71`), Dobias "$160 AOV-based" (`brain_dobias:66`, undefined), Manami 1.80 on 25 purchases.
25. Tier fit: MID tier requires a Scaling Campaign once the first winner graduates (`SOP_master:71`, `:123`); Manami (about 91k Kc/month per `DASH-BRIEF:15-17`; inference: about $4k, so MID by spend) has no Scaling Campaign and keeps its winner in the ABO "winner lane", "no separate budget step" (`MANAMI:86`).
26. Founder-ad ranking vs SOP winner: founder analysis ranks by lifetime spend and compares ROAS/CPA with a segment benchmark (`02-mining-and-teardown.md:69-72`); SOP uses Target-based gates. Different periods (lifetime 2023 to 2026, `FOUNDER-ANALYSIS:6`) and mixed attribution (`FOUNDER-ANALYSIS:117`).
27. Reporting skill compares Meta ROAS to a flat 3.5x target (`reporting/analysis/SKILL.md:264`) while per-client Target is set at onboarding (`SOP_master:97`); Manami target 2.50 and kill line 1.80 sit well below 3.5x, and the reporting learnings already note Manami pixel ROAS "structurally 1.5 to 1.9x" so a 3.5x target flags almost everything (`reporting/learnings.md:187`).
28. Referenced rules with no file: `meta-provozni-pravidla`, `meta-diagnoza-2026-09-04`, `promo-kalendar-q4-2026`, `agency/frameworks/meta-ads-sop.md`, `templates/weekly-review.md`, the KPI Calculator (section 0). Manami promo-index rule was introduced 2026-09-28 and retired 2026-10-05 (`MANAMI:56`, `:67-68`); "promo doubling" is no longer a valid adjustment.
29. Ambiguity: does a post-ID graduation duplicate, a re-uploaded copy (`MANAMI:44-53`) or a hook swap count as a new "ad launched" for hit-rate denominators? SOP silent; dashboard brief makes Creative ID a comma-separated list because post-ID creates a second ad_id for the same creative (`DASH-BRIEF:148-149`).

---

## 7. Where a dashboard comparison most likely diverges (auditor shortlist)
- Winner bar: SOP three-part hybrid (2.1) vs Manami "cleared target" vs dashboard "target ROAS with Read confidence". Confirm which ROAS (campaign / pack / ad), which window (weekly vs 30-day), and whether Target x 1.2 or Target is applied.
- Denominator for hit rate: net-new only (Manami, 1 of 67) vs all launched ads; whether post-ID duplicates, re-uploaded copies and hook swaps are counted once or many times.
- Attribution window of the source data (7-day click vs click+view): Manami has mixed windows by ad set (`MANAMI:172`).
- Per-client Target ROAS and kill line: only Manami is documented (1.80 / 2.50); Dobias 3.5; Venev gates; Ethia and RawBark none.
- Min-spend and window assumptions: 7 vs 14 days; 2x vs 1x CPA; pack of 4 ads vs formula-based.
- "Nathan ~5%" is quoted only in the dashboard brief; no engine document backs it.

## 8. Files read (complete list)
Engine: `SOP_master.md`, `01-research.md` to `08-feedback-loop.md`. Process skills: `weekly-performance-review/SKILL.md` + `learnings.md`, `concept-architecture/SKILL.md` + `learnings.md`, `meta-ad-brief/SKILL.md` + `learnings.md`. Playbooks: `handlir-meta-ads-creative-testing-playbook.md`, `founder-ads-playbook.md`, `founder-ads-account-analysis.md`, `ad-scripting-playbook.md` (grep for testing/winner terms only), `hook-patterns.md`, `bsd-founder-ads-masterclass-summary.md` (grep). Founder process `02-mining-and-teardown.md`, `04-point-scripts.md`, `SKILL.md`. Root: `brain.md`, `GLOSSARY.md`, `M4 Method - The Moonlighters.md`. Client learnings: `_clients/manami/learnings/meta-ads.md` (+ `.bak`, `.bak2`), `_clients/venev/learnings/meta-ads.md`, `_clients/dobias/learnings/meta-ads.md`; plus `brain_dobias.md`, `brain_venev.md`, Manami concepts index and ad files, Venev growth model and roadmaps. Agency: `Strategy.md`, `hormozi-audit-2026-06-01.md`, `landing-page-playbook.md` (line 222), reporting skill and learnings, `_ops/open-action-items.md`. Meetings (Layer 1 summaries, selected transcripts): `agency/meetings/internal/` 2026-03-13, 2026-06-10, 2026-07-07, 2026-09-20; `agency/meetings/external/2026-08-03-meeting.md`; Manami sync 2026-09-10 and 2026-09-24; Dobias 2026-06 to 2026-09 meetings. Dashboard side (comparison only): `one-eighty-dashboard-repo/CREATIVE_ENGINE_BRIEF.md`.
