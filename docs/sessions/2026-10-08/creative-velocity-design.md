# Creative Velocity in the dashboard: process, model, UI (proposal)

Status: proposal for the owner, 2026-10-08. Nothing built. Source: the `Creative Velocity` tab of `Ethia Baseline One Eighty Tracker` (read in full, cell by cell, reconstruction in this session's notes), SOP `agency/_processes/meta-creative-engine-v3/` (SOP_master section 2, 3, 11; 06; 07; 08), the current `/creative/velocity` page and `lib/creative/velocity.ts`.

All numbers below are either Ethia's own sheet inputs and outputs, or arithmetic on those inputs (marked "arithmetic"). No other client numbers are used.

---

## 1. What the sheet gets right, and what it gets wrong

**Right, and worth keeping**

- It is a calculator, not a report: the question is "how many new ads can this budget bring to a trustworthy verdict", and the answer is a ceiling. Producing above it only queues creative.
- It puts the cost of a verdict (purchases needed x CPA) at the centre. That is the one fixed number; everything else is how it is spread.
- It ends with the right conclusion for the account size: pack ROAS is readable (about plus or minus 26 % at 15 purchases), ad ROAS is not (about plus or minus 52 %). Decide at pack level.
- It compares production with capacity (baseline year 1.51x, contract to date 0.35x). That single ratio is the finding the dashboard should state by itself.

**Wrong or stale, must not be copied**

| # | Problem | Effect on Ethia's numbers |
|---|---|---|
| W1 | Capacity ignores the SOP launch rule (a pack needs at least 2x CPA a day, SOP_master section 3, SOP-06). The status cell checks it, the scenarios and actuals do not. | At 15k to 45k Kč a month the testing budget is 395 to 1,184 Kč a day, below the 1,200 Kč floor, so by SOP no pack launches. The table shows 5.3 to 8.7 ads a month. Actuals at 44,821 and 30,012 Kč show capacity 8.7, where the SOP answer is 0. |
| W2 | One pack at a time. MID and LARGE run one concept per pack, several packs at once, launched weekly (SOP_master section 1, 2). | Capacity is flat at 8.7 from 26k to 130k Kč. At 130k two packs fit at the floor, so arithmetic gives about 17 ads a month, not 8.7. |
| W3 | Purchases per verdict = 15, matching nothing: dashboard reads a pack at N = 10, test size is 25, and the note claims plus or minus 20 % (that needs 25). | Changes the verdict cost from 6,000 to 15,000 Kč. |
| W4 | CPA typed as 600 "7-day click". Dashboard target CPA is 550, September nCAC 527, basis is now 7d click + 1d view. | Every output moves with it. |
| W5 | Three winner definitions, none the SOP's (section 11.1: at least N purchases, shrunk ROAS at or above target, at least 14 days old). Hit rate fixed at 15 % against "1 in 5 to 1 in 10", which section 11.3 retired in favour of the client's own trailing 12 months. | Baseline hit rate shown as 9.6 % on a proxy rule; the dashboard's hit rate (already live) is the SOP one. |
| W6 | Tier from a typed 20 CZK/USD; 60,000 Kc sits exactly on the SMALL/MID line. | Tier flips with the exchange rate. |
| W7 | Stale text: "50 purchases a week" learning exit (gate removed), "winner = most spend in the pack" (dropped), no-touch note cites 7 days while the value is 14. | Misleading copy. |

The current dashboard Velocity page has the same one-pack-at-a-time assumption (`horizons()` uses 30 / days packs a month) and a different fixed N (25). Both models need the same correction.

## 2. The corrected model (one function, used everywhere)

Inputs per client and month: Meta spend S, CPA (on the decision basis), testing share t, verdict size N, no-touch window W, stale limit L, ads per pack A, client tier from S in USD (fx from `ref.fx_rates`).

```
daily testing      D   = S / days_in_month x t
pack floor         F   = 2 x CPA                      (SOP: below this the pack does not launch)
packs at once      P   = SMALL ? min(1, floor(D / F)) : floor(D / F)
per pack per day   d   = P > 0 ? D / P : 0
ads per pack       a   = min(A, floor(d / (0.5 x CPA)))   (0.5x CPA per-ad signal floor)
verdict cost       V   = N x CPA
days to verdict    v   = V / d
cycle              c   = max(W, v)                    (no decision inside the window)
stale              v > L  -> capacity 0, "stale"
packs a month      P x days_in_month / c
new ads a month    packs a month x a                  = CAPACITY
expected winners   capacity x hit rate (trailing 12 months, SOP 11.3)
```

On the sheet's own Ethia inputs (CPA 600, N 15, t 80 %, W 14, A 4), arithmetic:

| Monthly spend | Sheet: new ads / mo | Corrected: new ads / mo | Why |
|---|---|---|---|
| 15,000 to 45,000 Kc | 5.3 to 8.7 | 0 | testing budget below the 1,200 Kc pack floor |
| 60,000 Kc | 8.7 | 8.7 | one pack, window binds |
| 90,000 Kc | 8.7 | 8.7 | still one pack at the floor |
| 130,000 Kc | 8.7 | 17.4 | two packs at once |

And the line the page should print by itself for Ethia's contract to date (30,012 Kc, arithmetic): "A pack gets 790 Kc a day, the floor is 1,200. Either raise testing to 1,200 a day (about 45,600 Kc a month at 80 %), or knowingly run one pack below the floor (verdict data in about 11 days at 15 purchases)." That is a decision the sheet cannot surface today because its capacity cell says 8.7.

Two settings decide which of those is true and are the owner's call (section 6, Q3 and Q4): which N defines a verdict, and which CPA.

## 3. Who uses it, and when

The sheet mixes three jobs. Each has a different user, moment and question:

| Moment | Who | Question | What they need on screen | Output |
|---|---|---|---|---|
| **Monday review** (SOP 07, weekly) | Account manager, Matt | Is the testing machine healthy this week? | Packs in their window, packs starving below the floor, packs past the stale limit, new ads launched this month vs capacity | Logged decisions (already on Concepts) |
| **Monthly creative planning** (last week of the month) | Account lead + Lukas (creative lead), media buyer | How many ads do we brief for next month, in how many packs? | Next month's planned spend (from the Goals plan), capacity at that spend, creative already queued in ClickUp (ready, in production), so the brief quota = capacity minus queue | A number of briefs, written into ClickUp |
| **Budget and expectation talks** (quarterly, onboarding, any budget change) | Owner, account lead with the client | What does this budget buy, and what would it take? | Scenario table across spend levels, spend needed for the target ads a month, months per winner | A sentence for the client: "at 30k you get one pack every 19 days and about one winner a quarter" |

The track record (production vs capacity, hit rate, winners by month) serves the second and third. It is the "did we do what we planned" check.

## 4. Options

### A. Where it lives

| Option | For | Against |
|---|---|---|
| A1. Replace the current Velocity page | One place for velocity; the current page already has packs per month and the pack spec, built on the same (flawed) model | Its eight gauges move or go |
| A2. New sixth Creative page "Capacity" | Nothing existing changes | Two pages computing packs per month two ways; the owner wants fewer things, not more |
| A3. Planner inside Goals (plan layer) | Spend plan is already there | Goals is four things by design; creative is a different team and moment |

**Recommend A1.** Velocity becomes the page for all three moments. Production ROI stays separate (it answers "what does a winner cost", a different question) and links in from the track record.

### B. Planner, monitor, or both

| Option | For | Against |
|---|---|---|
| B1. Two pages | Clean separation | The planning moment needs the monitor's numbers (queue, last month's actuals) on the same screen |
| B2. One page, three bands, top to bottom: This month, Plan, Track record | Matches the three moments in the order they are used; the Monday user stops at band 1 | Longer page |
| B3. One page with a mode switch | Compact | Hides the comparison that matters (plan vs actual) |

**Recommend B2.**

### C. Which inputs stay inputs

Rule: anything the warehouse can measure is measured; anything that is a decision lives where decisions already live.

| Input | Today (sheet) | Proposed source | Kind |
|---|---|---|---|
| Monthly Meta spend, actual | typed | warehouse, last full month and month to date | measured |
| Monthly Meta spend, plan | typed | Goals plan layer (ClickUp, already synced: the ad budget per month) | decision, already in ClickUp |
| What-if spend | scenario rows | page control (not saved) plus a fixed ladder | exploration |
| CPA | typed 600 | warehouse trailing 90 days on the decision basis, target CPA from Settings shown beside it | measured (see Q4) |
| Target ROAS, verdict N, no-touch W | sheet Settings tab | dashboard Settings (already there per SOP 11.7) | decision, already in Settings |
| Testing share t, ads per pack A, stale limit L, target new ads a month | typed | dashboard Settings, next to the thresholds | decision, new fields |
| Hit rate | typed 15 % | warehouse, trailing 12 months, SOP 11.1 winner rule (`rpt_ad_launch`, already live) | measured |
| Tier, fx | typed 20 CZK/USD | derived from spend and `ref.fx_rates` | measured |
| Launches, packs, winners actuals | hand-entered rows on Baseline and Tracker | warehouse (`rpt_ad_launch`, `mart_creative_adset_perf` after 280c) | measured |

Why Settings and not ClickUp for the rule parameters: SOP 11.7 already names dashboard Settings as the source of truth for N, no-touch and targets, and these are per-client constants, not monthly plans. ClickUp keeps the monthly plan (spend), which it already holds. This keeps the existing principle: ClickUp holds plans and statuses, Settings holds rule parameters, BigQuery computes everything else.

### D. Per client or cross client

Per client page (tiers, CPA, hit rates differ). Cross client gets one table in the Reports suite later: client, tier, spend, capacity, launched, production vs capacity, months per winner. Out of scope for the first build.

## 5. What the dashboard can say that the sheet cannot

1. **The queue.** With task 1's mapping, ClickUp ad tasks in `ready to upload`, `in production`, `brief: approved` are counted against capacity: "4.5 months of creative queued at this budget" or "brief 6 more for November". The sheet cannot see ClickUp.
2. **Starving packs.** Actual daily spend per live pack against the 2x CPA floor, from the ad set mart (empty until 280c is deployed).
3. **Stale packs.** Packs past the stale limit without N purchases: the verdict will never come, stop or merge.
4. **Production vs capacity by month**, from real launches, not hand-entered rows. And the same for every client, without a tracker sheet.
5. **Plan vs actual capacity.** Capacity at planned spend vs at actual spend, so a missed budget explains a missed launch count.

## 6. Decisions needed from the owner

| # | Question | Options | My recommendation |
|---|---|---|---|
| Q1 | Replace the current Velocity page? | Replace / add a sixth page | Replace (A1) |
| Q2 | One page with three bands? | Three bands / two pages / mode switch | Three bands (B2) |
| Q3 | What N defines a verdict for capacity? | Settings "read at" N (Ethia 10) / test size (25) / a new field | Read-at N, the number decisions are actually taken on (SOP 11.5). 25 stays the "confident" line shown beside it |
| Q4 | Which CPA drives capacity? | Actual trailing 90 days / Settings target CPA | Actual: capacity is what the money really buys. Target shown as the "if we hit target" line |
| Q5 | Parallel packs for MID and LARGE? | Yes (SOP) / keep one at a time | Yes, it is the SOP, and it is the only way extra budget buys more learning |
| Q6 | Where do t, A, L and target ads a month live? | Settings / ClickUp plan / page inputs | Settings, beside the thresholds |
| Q7 | Retire the sheet tab once the page exists? | Yes / keep both | Yes, after one month of both agreeing on Ethia |

## 7. UI proposal (Apple Health language)

White page, white cards, Inter, rings only where one rotation is a goal. Wireframe, top to bottom:

```
Velocity                                   [client]  [October 2026]

THIS MONTH                                                        (Monday)
 ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
 │  (ring)      │ │  (ring)      │ │ Packs in     │ │ Queue        │
 │  New ads     │ │  Verdicts    │ │ window   n   │ │ n months     │
 │  n / cap     │ │  n / plan    │ │ starving n   │ │ n ready or   │
 │  capacity    │ │  this month  │ │ stale    0   │ │ in production│
 └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
  ring: one rotation = this month's capacity at actual spend

PLAN                                                  (monthly planning)
  Spend  [ 60,000 Kc ]  from Goals plan ▾    Tier MID
  ┌──────────────────────────────────────────────────────────────┐
  │ One pack gets 1,579 Kc a day (floor 1,200). Verdict in 14    │
  │ days. 2.2 packs, 8.7 new ads, about 1.3 winners a month.     │
  │ Brief n for November (capacity minus queue).                 │
  └──────────────────────────────────────────────────────────────┘
  Scenarios   15k  20k  26k  33k  45k  60k  90k  130k   (plan row marked)
   packs/mo    0    0    0    0    0   2.2  2.2  4.3
   new ads     0    0    0    0    0   8.7  8.7  17.4
   winners     0    0    0    0    0   1.3  1.3  2.6
   (cells below the floor read "no pack", not 0)
  What it takes: the first pack needs 45,600 Kc (8.7 ads). A second pack needs 91,200 Kc.

TRACK RECORD                                         (quarterly, owner)
  bar chart by month: new ads launched vs capacity at that month's spend
  production vs capacity: baseline 1.51x, contract 0.35x
  hit rate trailing 12 months, winners by launch month  -> Production ROI
```

Notes on the wireframe: the scenario cells are Ethia's sheet inputs run through the corrected model (arithmetic, section 2), shown only to make the layout concrete. "No pack" is a state, not a zero. The two rings are the only goal-shaped numbers on the page, so they are the only rings.

## 8. Build plan, once Q1 to Q7 are answered

1. `velocity.ts`: one `capacity()` function implementing section 2, unit tests on the sheet's Ethia inputs (the table in section 2 is the test).
2. Settings: four new per-client fields (Q6).
3. Warehouse: monthly view per client (spend, CPA on basis, launches, packs, winners, queue from ClickUp ad tasks by status), `mart_qa` first.
4. Page: three bands, replacing the gauges and the horizon table.
5. One month in parallel with the sheet for Ethia, then retire the tab (Q7).

Depends on task 1 being deployed (280c fills the ad set mart; 280 makes the ClickUp queue mappable).
