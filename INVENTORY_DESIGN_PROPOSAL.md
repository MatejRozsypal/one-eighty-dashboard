# Inventory & Fulfillment — Design Proposal

**Status:** partly built and live. Written 2026-08-03; reconciled against what shipped
2026-08-04. Sections 1–2 of §3 are deployed as one page at `/inventory`; §3 section 3
and the media flag are not built. Everything in §4–§7 that is not marked otherwise is
implemented.
**Scope:** originally three screens in `dashboard/` plus one column on the existing
performance pages; currently one page. Read-only — no writes back to Shopify.
**Clients in v1:** `dobias`, `venev`. `manami` deferred — see §8.

---

## 1. Why this exists

We already know the answer to "how much did we make." We do not know the answer to
"how much of what we sell can we still sell," and that second question governs the first.

Two findings from live client data, both discovered while writing this document:

**Dobias** (stock snapshot 2026-05-19, sales 90d to that date):

| SKU | ABC | revenue 90d | units/day | on hand | days cover |
|---|---|---|---|---|---|
| GutSense® | A | $123,302 | 26.9 | 4,021 | 150 |
| FeelGood Omega® | A | $97,292 | 32.0 | 464 | **14** |
| SoulFood® | A | $75,041 | 15.8 | 4,300 | 272 |
| LiverTune® | A | $44,678 | 10.4 | 0 | **0** |
| TickHex® Body Spray | B | $18,929 | 5.8 | 0 | **0** |
| JointButter® H+ | B | $18,602 | 3.0 | 2,030 | **672** |
| GreenMin® H+ | B | $11,635 | 3.0 | 1,749 | **579** |

(Figures as produced by `mart.mart_sku_inventory`, §7 — window is the 90 days ending at
the snapshot date, so the stock and the velocity describe the same moment.)

The best-selling product by units had two weeks of cover. An A-class product worth
$45k/quarter was at zero. The H+ line is sitting on roughly two years of stock. None of
this is visible on any screen we currently have.

**Venev** (ShopifyQL, 90d to 2026-08-03): 7,141 units on hand, **16 units sold in the
quarter**. At that rate the stock outlives the century. It is cosmetics; it will expire
first. Roughly EUR 23,780 at cost is locked up, and that figure only covers the 6 of 13
variants where we know the cost at all.

For a client, the value is cash and avoided stockouts. For us, it changes the QBR from
"here is your ROAS" to "here is why you cannot scale SKU X and here is EUR 23k you can
get back" — the positioning MarginOS sells to agencies, which we can do better because
the CM1/CM2/CM3 stack already exists in `mart`.

---

## 2. What the field actually does

From research into Shopify native, Stocky, Inventory Planner, Prediko, Fabrikatör,
Assisty, Cogsy, Netstock, ShipBob, Shipfusion, ShipMonk, Flexport and Amazon Seller
Central. Four patterns repeat everywhere:

1. **The hero number is a *time*, not a quantity.** "Days of cover" / "weeks of supply."
   Units on hand is demoted to a supporting column. Every serious tool does this.
2. **Every planning tool has the same spine:** velocity grid → replenishment screen →
   exception list → money screen. We collapse this into three.
3. **The terminal action is a purchase order.** Screens that cannot end in a PO become
   reporting afterthoughts. We are deliberately not doing PO writeback in v1, which means
   we must be honest that v1 ends in an *export*, not an action.
4. **Nobody agrees on sell-through rate.** Across 11 published sources there are **five
   distinct denominators**. Shopify contradicts itself three ways — all three appear on a
   single page. Lightspeed, Amazon and Inventory Planner each contradict themselves once.
   The same SKU can legitimately read 40%, 66%, 80% or 250% with no bug anywhere. See
   §4.2.

**A caution about the sources themselves.** Vendor documentation in this domain contains
checkable errors, so we should not copy a formula because a big name published it.
Verified examples: NetSuite's published "fill rate" formula actually computes the *miss*
rate; its "forecast accuracy" is a sign-flipped bias; Shopify's own days-of-inventory page
says "starting value *minus* ending value, divided by 2" where it means plus; Cin7 Omni's
"under stocked products" definition is tautological. Every formula in §4 is one we should
be able to defend from first principles, not by citation.

**Timely:** **Shopify Stocky shuts down 31 August 2026** — four weeks from this writing —
and was delisted in February. Its ABC analysis, demand forecasting and multi-supplier
support have **no native replacement**. Whatever any client was getting for free from
Shopify in this area is about to stop existing.

What we take from MarginOS specifically: **weeks of cover displayed next to performance
numbers, not on a separate page.** That is their best idea and it is what makes the
inventory data reach the media buyer instead of sitting in an ops tab.

---

## 3. The screens

> **What was actually built, 2026-08-03.** Sections 1 and 2 below ship as a
> *single* page at `/inventory`, in that order down one scroll. Section 3 is not
> built. The media flag is not built.
>
> They were merged because splitting them puts the evidence for a recommendation
> on a different page from the recommendation, and checking the five items is the
> main thing anyone does with them. The table underneath *is* the check.
>
> The Buying Plan is deferred on missing inputs, not on effort: without supplier
> lead times and MOQs it cannot compute either a date or a quantity, so it would
> ship as a form with four empty columns. That is worse than an absent page —
> see §10, items 1–2.

### Section 1 — Stock Health (the exception screen)

Answers: *what do I do today?*

**One number, with its decomposition.** Cash tied up in stock, split by state:

```
€142,000 in stock  ·  covers 11 weeks  ·  target 8–12

  healthy      €78,000   55%
  at risk      €12,000    8%   ← will stock out inside lead time
  overstocked  €44,000   31%   ← >26 weeks cover
  dead/expiring €8,000    6%   ← no sales 90d, or past expiry-risk threshold
```

"Total inventory value" alone is the wrong hero metric — it is a raw count, and a raw
count does not change behaviour. The split does.

**Then at most five ranked exceptions.** Not observations — decisions. Each row states
the call, the evidence, and the deadline:

> **Reorder FeelGood Omega®** — 14 days cover, 45-day lead time. Stocks out ~17 Aug,
> 31 days before a reorder could land. Missed revenue if not ordered today: ~$32,000.
>
> **Stop scaling LiverTune®** — 0 units, A-class, $45k/quarter. Ads running against it
> are buying a stockout.
>
> **Mark down JointButter® H+** — 655 days cover, $19k/quarter. €X of cash recoverable.

**Why five.** Process-industry alarm standards (EEMUA 191 / ISA-18.2) give the only
empirically-derived limits on how many alerts a human absorbs: <6/hour steady state,
>10 in 10 minutes is a flood, <10 standing alarms, 5/15/80 priority split. Scaled to a
weekly business review that is **≤5 exceptions, ≤1 high**. Google SRE's rule applies too:
every alert must be actionable and require judgement — if the response is always the same,
automate it instead of showing it. A permanently red tile is a standing alarm and the
standards say to eliminate it, not to live with it.

The base rate for BI adoption is bad — 58% of deployments sit below 25% adoption, and the
diagnosed cause is dashboards that show *available* data rather than *decision-relevant*
data. The five-item budget is the main defence against that.

**Trust bar, always visible.** See §6.

### Section 2 — Catalog (same page, below the list)

Answers: *what is the state of everything?*

One row per SKU (per SKU × batch once we have batch data — see §5). Sortable.

**Saved views are specified here but NOT built** — the shipped table sorts by any column
and nothing more. Inventory Planner and Prediko both converged on saved views as
first-class navigation, so they are worth adding; they are not load-bearing for the
five decisions above, which is why they were cut from the first pass.

| Column | Note |
|---|---|
| SKU / product | |
| **ABC** | ours, ranked on **contribution margin**, not revenue — §4.1 |
| Velocity | units ÷ **days in stock**, not calendar days — §4.3 |
| On hand | |
| **Days cover** | the hero column |
| Sell-through | with its window and denominator labelled — §4.2 |
| CM2 / unit, CM2 % | already in `mart` |
| Stock value at cost | |
| Days aged / expiry risk | §5 |
| Media flag | 🟢 scale / 🟡 hold / 🔴 don't scale — §4.5 |

Intended saved views, when built: `Stockout risk`, `Overstock`, `Dead stock`,
`Expiring`, `No cost data`, `Negative stock`.

### Section 3 — Buying Plan — NOT BUILT (blocked on lead times and MOQs)

Answers: *what do I order, how much, and what will it cost me?*

Grouped by supplier, since that is how orders are actually placed. Per SKU:

```
forecast demand over (lead_time + target_days_cover)
  − on hand
  − on order
  + safety stock
  = raw recommendation
  → rounded up to MOQ / case pack = quantity to order
```

This is Inventory Planner's order-up-to-level model, which is also Fabrikatör's and
Prediko's. Assisty uses a fixed-order-quantity model where current stock only sets the
trigger; that is a genuine model difference and we are choosing the majority form.

Two columns, deliberately: **raw recommendation** and **orderable quantity**. Every
serious tool separates these, because the gap between them is the MOQ tax and the client
should see it.

Footer: **total cash required, and when.** This is the screen that connects to the P&L
page — a buying plan is a cash-flow event, and it is the number that decides whether the
plan is executable at all.

**When built, v1 ends in a CSV/PDF export.** Not a PO in Shopify — which makes this
the weakest of the three until phase 3, and is part of why it was not first.

### The media flag — NOT BUILT (blocked on the same lead times)

The requirement "must feed back into media buying" is met by putting **days of cover and a
three-state flag as a column on the existing performance pages**, not by building a
separate page.

Amazon PPC has had inventory-aware bid throttling as a shipped feature for years (Pacvue,
Carbon6, Adbrew). The Shopify/DTC ecosystem has no equivalent primitive — Meta and Google
can pause ads on out-of-stock *catalogue* items, but nothing throttles a prospecting budget
because a hero SKU is at three weeks of cover. The published state of the art in DTC
content is literally "have a weekly cross-functional meeting."

We do not need to change the bid. We need to tell the buyer before they commit next
month's budget. That is a column, and it puts us ahead of published practice rather than
behind it.

---

## 4. The metric decisions that matter

Each of these is a fork where tools disagree. Picking silently is how a dashboard loses
trust; each choice below needs to be visible in the UI.

### 4.1 ABCD ranking — what it is, and what ours does

**The idea in one paragraph.** Sort every SKU from best to worst on one measure. Walk
down the sorted list adding up that measure as you go. The SKUs that together make up the
first 80% of the total are **A**. The next 15% are **B**. The last 5% are **C**. It is the
Pareto principle turned into a filing system: in most catalogues a handful of SKUs produce
most of the money, and they deserve different treatment from the long tail.

The cutoffs are **cumulative, not per-item**. A SKU is not "A" because it individually
makes 80% of anything — it is A because it falls inside the group that collectively
accounts for the first 80%. A typical result:

| Grade | Share of SKUs | Share of the measure | What it means |
|---|---|---|---|
| **A** | ~10–20% | first 80% | The business. Never let these stock out. |
| **B** | ~20–30% | next 15% | Solid. Normal replenishment. |
| **C** | ~50–70% | last 5% | The long tail. Cheap to get wrong, expensive in aggregate. |

**Why bother — the whole point is differentiated treatment.** A grade is not a report card,
it is a policy assignment. Standard practice by class:

| | A | B | C |
|---|---|---|---|
| Stock counting | frequent | periodic | rarely |
| Safety stock | high service level | moderate | minimal, or none |
| Review cadence | weekly | monthly | quarterly |
| Forecast effort | worth modelling | simple baseline | reorder on trigger |
| Supplier terms | worth negotiating | standard | take what's offered |

Applied to Dobias: FeelGood Omega® at 14 days of cover is an **A** — that is a
drop-everything problem. A C-class SKU at 14 days of cover is a shrug.

**The two extra letters.** Plain ABC has a blind spot: it only ranks things that sold. So
we add two, and both are ours rather than Shopify's:

- **D — sold nothing in the window.** Shopify simply omits these SKUs from the ranking
  entirely, which is precisely backwards: a SKU with stock and no sales is the most
  interesting row on the page, because it is dead capital. Venev has two of these sitting
  on ~1,500 units between them. D is where the freed cash lives.
- **U — unclassified, less than 8 weeks of sales history.** Borrowed from Stocky. A new
  product cannot be graded, and grading it anyway produces a false C that gets it starved
  of stock at exactly the wrong moment. U says "too early to judge," which is a real answer.

**What we rank on, and why it differs from Shopify.** Shopify ranks on **revenue at full
retail, discounts excluded, cost excluded**, over a **fixed rolling 28-day window that
cannot be changed**, at variant grain. Not available on Basic or Lite. Stocky uses a
different algorithm again — 8-week window — so the same store can get two different grades
from two Shopify surfaces.

We rank on **CM2 contribution**, not revenue. The documented critique of revenue-ranked ABC
is that it misleads whenever margins vary, and Dobias' margins run 50–89% across the
catalogue — a high-revenue, low-margin SKU and a lower-revenue, high-margin one can trade
places entirely. We already have per-SKU margin in `mart`; ranking on revenue while holding
margin would be perverse.

Worked example of why it matters:

| SKU | Revenue 90d | Margin % | Contribution | Revenue rank | **Our rank** |
|---|---|---|---|---|---|
| JointPowder | $49,846 | 73.5% | $36,643 | 5 | 5 |
| LiverTune® | $44,678 | 78.6% | $35,131 | 6 | 6 |
| FeelGood Omega® H+ | $28,423 | 74.2% | $21,087 | 7 | 7 |
| TickHex® Spray | $18,929 | 72.4% | $13,710 | **8** | 9 |
| JointButter® H+ | $18,602 | 88.3% | $16,431 | **9** | 8 |

TickHex outsells JointButter on revenue and loses to it on contribution — a 16-point margin
gap is enough to swap them. Small here; on a catalogue with a 40-point spread it reorders
the top of the list, which is where the reordering actually costs money.

**Our other departures, all deliberate:**
- **90-day window**, not 28. Venev sells ~5 orders a month — a 28-day window there is pure
  noise. Dobias has history back to 2013.
- **The native 28-day revenue grade is shown alongside ours.** If a client sees A here and
  B in Shopify admin they will file a bug, so both appear with their provenance labelled.
- Negative margins are clamped to zero for the cumulative share, or one loss-making SKU
  would break the running total's monotonicity and shift every grade below it.

**What ABC does not tell you.** It ranks by *size*, not by *predictability* or *health*. An
A-class SKU can be a disaster (655 days of cover) and a C-class one can be perfectly run.
The industry answer is to add an XYZ axis for demand variability, giving a 3×3 matrix — AX
being high-value and stable, CZ being low-value and erratic. We are **deferring XYZ**: the
standard CV-based cutoffs have two incompatible conventions in circulation (0.5/1.0 in
procurement, 10%/25% in retail), and the substantive critique is that CV is simply the wrong
measure — a stable seasonal item and a noisy flat item score identical CVs. The defensible
version uses out-of-sample forecast error instead, which is not worth building at these
volumes yet. Until then, ABC answers "how much does this matter," and days-of-cover answers
"is it in trouble." Those two columns side by side do most of the work the matrix would.

### 4.2 Sell-through — pick one, label it everywhere

Five denominators are in active use across the sources surveyed; these three are the ones
that matter for us:

| Form | Formula | Used by |
|---|---|---|
| (a) | `sold ÷ (sold + on hand)` | Shopify **help centre** |
| (b) | `sold ÷ units received` | retail buying / fashion planning |
| (c) | `sold ÷ beginning-of-period stock` | Shopify **blog** |

Shopify contradicts its own documentation between its marketing content and its product
docs — and in one case three ways on a single page. Changing denominators between periods
makes the trend meaningless, and form (b) can legitimately exceed 100% (a reading of 250%
is possible) when sales draw down carryover stock rather than the new receipt. That is not
a bug and the UI must not treat it as one.

**Decision:** use form (a) as the headline, because it matches what the client sees in
Shopify admin. Use form (b) on the Buying Plan screen, where "did this purchase order sell
through" is the actual question. Never show a sell-through figure without its **window**
and its **denominator** on the label.

The benchmark tables that look contradictory are not: Toolio's "health & beauty 75–90%"
is a terminal, against-receipts number; Shopify's "cosmetics ~25% at 8 weeks → 48% at
52 weeks" is cumulative-to-date. For our clients the operationally useful one is Shopify's
— **~25% of a receipt sold in the first 8 weeks is normal for cosmetics**, and materially
below that at week 8 is an early markdown signal.

A caution we have already proven: **Shopify's own `sell_through_rate` is unusable for
Venev.** Whenever stock was negative it returns 1.0 (100%). Mathematically correct,
factually nonsense. We compute our own and flag periods where the input is untrustworthy.

### 4.3 Velocity must exclude stockout days

This is the highest-value subtlety in the whole design and it is almost never handled
correctly in small-brand tooling.

When an item is out of stock, recorded sales are a **censored** observation: sales ≤ demand.
Fitting a forecast to sales biases demand *downward* → lower reorder quantity → more
stockouts → further downward bias. The literature calls this the **spiral-down effect**.

The full correction menu runs to Kaplan–Meier estimators and Tobit Kalman filters, and the
literature openly admits there is no accepted general solution. But two cheap things fix
most of it:

1. **Store daily on-hand** so we know which days were censored.
2. **Report velocity as `units ÷ days in stock`**, not `units ÷ calendar days`.

That is the crudest form of the partial-day-scaling method and it requires no modelling.
It is also the single strongest argument for starting the daily snapshot immediately (§7).

**Almost nobody does this.** Of every tool surveyed, only Inventory Planner, Prediko and
Cin7 exclude stockout days from velocity. Everyone else — including Shopify natively —
understates velocity, and therefore understates reorder point, forecast and lost sales,
all in the same direction. Given that our clients demonstrably run out of stock on
A-class SKUs, this is not a theoretical refinement; it is the difference between a
recommendation that fixes the problem and one that perpetuates it.

Until snapshots exist, velocity is computed on calendar days and **flagged as
possibly-censored** rather than presented as fact.

### 4.4 Stockout cost

Forward-looking, Fabrikatör's form:
`potential out-of-stock days × daily average sales × price`.

For lost margin rather than lost revenue, substitute CM2/unit — which is the more honest
number and one we can compute.

Citable evidence that stockouts cost real money: Gruen, Corsten & Bharadwaj (2002),
>71,000 consumers across 29 countries, worldwide OOS rate 8.3%. Consumer response:
31% buy at another store, 9% don't buy at all — so **~40% of stockout encounters are lost
outright**, and that is in grocery where substitution is easiest.

**Do not cite** the figures circulating in vendor blogs ("63% never return," "$1.2T
globally," "average stockout lasts 35 days"). None trace to a primary study; they are
mutually-citing content marketing.

### 4.5 The media flag — stock-capped spend

The rule, stated so it is computable:

```
if days_cover < lead_time                        → 🔴 don't scale
if lead_time ≤ days_cover < lead_time + buffer   → 🟡 hold
if days_cover ≥ lead_time + buffer  and CM2 ok   → 🟢 scale
```

The logic: **if cover is shorter than lead time, a stockout is already unavoidable** — no
purchase order can land in time. Every incremental order pulls the stockout forward and
spends CAC on demand that will hit an empty shelf. This needs only two inputs: days of
cover (which we compute) and lead time (config, §7).

A richer form exists — cap spend at
`available units × CM2/unit ÷ target LTGP:CAC` — and is worth adding once lead times are
real. Nobody publishes it in this form; the ingredients are all sourced, the assembly is
ours.

---

## 5. Cosmetics: expiry is not an edge case

Both Venev and Manami are cosmetics. This changes the model rather than adding a field.

**Batch tracking is a legal requirement, not an ops nicety.** EU Regulation 1223/2009
mandates a batch/lot code on both the primary container and the outer packaging, with a
recording system that traces each unit sold, for recall purposes. **Shopify does not model
batch natively.** The correct grain for cosmetics is therefore **variant × batch**, and
getting there needs either an app or a separate ledger.

**The 30-month asymmetry.** Under Article 19: if minimum durability ≤30 months, a
best-before date must be printed. If >30 months, it need not be — instead the label shows
period-after-opening (the open-jar "12M" symbol). Most of a cosmetics catalogue falls in
the second group, which means **the aging risk is invisible on the unit and exists only in
batch records**. That is precisely why the batch ledger is load-bearing rather than nice
to have.

**The rule to implement** (from Eightx, and the best operational rule found in the entire
research): *flag any SKU where days on hand exceeds half its remaining usable life.* It
surfaces write-off risk roughly two quarters before expiry, and it does so on the same
axis — days on hand — that ops and finance already use.

```
expiry_risk = days_on_hand ÷ effective_remaining_sellable_days

  < 0.5    healthy
  0.5–1.0  markdown phase 1 (10–15%)
  1.0–2.0  markdown phase 2 (20–30%), remove from full-price ad sets
  > 2.0    will not clear at any realistic velocity — liquidate/bundle/donate
           and take the write-down now
```

**Hold-vs-markdown, and why cosmetics is different.** At ~25% annual carrying cost,
holding costs ~2.1%/month, so break-even hold ≈ `markdown% ÷ 2.1` months. For cosmetics
this is **capped by remaining sellable life** — if the break-even hold exceeds remaining
life, holding is strictly dominated and the only question is how deep to cut. Non-perishable
stock depreciates toward a salvage floor above zero; cosmetics goes to zero and then
negative, because disposal costs money.

**One thing to check with an accountant, because the internet will mislead you here:** US
sources state that inventory write-downs are irreversible (ASC 330). Under IFRS/IAS 2 they
*must* be reversed if net realisable value recovers. The "delay the provision" instinct
imported from US content is backwards in an EU context. Needs confirmation for Czech GAAP
specifically before we put it in a client deck.

**Default shelf lives** for the config table until clients give us real numbers (Eightx's
table, to be labelled as estimates in the UI):

| Product type | Usable life | Max days on hand |
|---|---|---|
| Mascara / eye | 3 months | ~45 |
| Liquid foundation / serums | 12 months | ~180 |
| Lipstick / balm | 18 months | ~270 |
| Powders | 24 months | ~360 |
| Fragrance | 36+ months | ~540 |

Note the last row against Venev: fragrance is the *most* forgiving category, and Venev
still has stock that will not clear before expiry.

**MOQ context for cosmetics:** indie/private-label labs 250–1,500 units; mid-size
1,000–10,000; large CDMOs 5,000–50,000+. Overseas formulation runs 90–120 days from PO to
landed stock. Colour cosmetics often carry **per-shade MOQs**, which force over-buying on
slow shades — this is very likely the mechanism behind Venev's 7,141 units.

---

## 6. Data quality is a feature, not a footnote

DeHoratius & Raman (2008) examined ~370,000 inventory records across 37 stores and found
**65% inaccurate**. This is measured, not folklore. Our own data agrees:

| Problem | Evidence |
|---|---|
| Stale snapshot | Dobias' only stock snapshot is 2026-05-19 — 2.5 months old |
| Missing cost | Dobias 122/215 variants (57%), Venev 7/13 (54%) |
| Negative stock | Dobias 32 variants; Venev ran negative for 14 months straight |
| Untracked vs sold out | Dobias A-class SKUs at 0 — cause unknown |
| Silent write-offs | Venev lost 783 units in 2026-07 with **zero** sales that month |
| Catalogue drift | Dobias has sold 387 SKUs but only 215 exist in the catalogue |

Trust erodes gradually and terminally: a client who finds one wrong number stops believing
the right ones. So every screen carries a persistent **trust bar**:

> Stock as of **2026-05-19 (76 days ago)** · cost known for **43%** of variants ·
> **32 SKUs** with negative stock · velocity **possibly censored** on 6 SKUs

And any SKU failing a quality gate is **excluded from recommendations** rather than
silently given a wrong one. A missing cost means no margin, no ABC grade, no
recommendation — shown as "cannot compute: no cost," not as zero. We have a precedent for
this and it was the right call: migration 217 handled Venev's bundle SKUs by carrying NULL
rather than zero, which kept them out of margin instead of counting them as free goods.

---

## 7. What has to be built

### Phase 0 — start immediately, independent of every other decision

**Daily inventory snapshot → BigQuery.** A small n8n job writing one row per
`client_id × variant × location × day` into a partitioned table, capturing `available`,
`on_hand`, `committed` and `incoming` separately. Not just `available` — Venev's COD orders
sit PENDING indefinitely, which makes those four numbers diverge persistently for that
client.

This blocks: real velocity (§4.3), stockout days, lost revenue, turnover, aging.
**Every day of delay is a day of history that cannot be recovered.**

**One-off backfill of what Shopify still holds.** The object API (`InventoryItem`,
`InventoryLevel`) has no as-of-date argument anywhere — snapshot only. But ShopifyQL was
reinstated on the Admin GraphQL QueryRoot in API version 2025-10, and
`FROM inventory SHOW starting_inventory_units, ending_inventory_units,
inventory_units_sold, sell_through_rate` works. Tested live on Venev: **31 months back to
2024-02**, per SKU. Also grab the Month-end inventory snapshot CSVs manually — monthly
grain, floor of 2023-10-01.

Do this as a backfill, never as the source of truth. Shopify killed an inventory dataset in
2023 and the ShopifyQL API in 2024 before reviving it in 2025.

**Fix the products webhook.** `raw_shopify_products` is partitioned by `ingested_at` and
could carry history, but contains exactly one ingest day per client. Either the webhook is
not firing or it is not appending. Worth an hour regardless of this project.

**Do not build the walk-backwards reconstruction** (current stock − sales + receipts, run
backwards). Manual stocktakes are invisible to it and corrupt everything before them
permanently with no error signal; shrinkage compounds the same way. Error is cumulative,
unbounded, and never self-correcting — tolerable for two weeks, nonsense at twelve months.
Venev's history is the proof: two stocktakes in 2025 moved stock by ~8,000 and ~7,700 units
with no corresponding sales.

### Phase 1 — the metric layer and the three screens

- `mart.mart_sku_daily` — one row per client × SKU × day: units, revenue, CM2, on hand,
  in-stock flag.
- `mart.mart_sku_health` — current state per SKU: velocity, cover, ABC, sell-through,
  aging, flags.
- `ref.suppliers` and `ref.sku_config` — supplier, lead time, MOQ, case pack, target cover,
  shelf life. Registry-driven in the same spirit as `ref.clients`, and **nullable
  throughout**: the system runs with empty values and says "cannot compute, missing lead
  time" rather than guessing.

### Phase 2 — the parts blocked on information we do not have

- Real lead times and MOQs from clients.
- Shelf life and whether batches are tracked at all.
- Expiry logic and the batch ledger.
- Shoptet stock pipeline for Manami (§8).

### Phase 3 — optional, decide later

Purchase-order writeback, email/Slack alerts, XYZ/forecast-error classification,
stock-capped budget rule in its full form.

---

## 8. Manami is deferred, deliberately

Two independent reasons, worth not conflating:

1. **No pipeline.** `raw_shoptet_products` does not exist. The current Shoptet workflow
   pulls orders only. Stock access exists but is a new integration, not a modification —
   and the Shoptet API is an addon-gated product.
2. **Manami is a manufacturer.** It buys oils and essences and blends them into perfumes.
   Dobias and Venev have a 1 SKU = 1 purchased item relationship; Manami has a **bill of
   materials**. Selling one perfume consumes X ml of oil A and Y ml of essence B, and one
   raw material is shared across many finished products. Replenishment applies to
   *components*, not finished goods. That is a different data model, not a parameter.

Recommendation: deliver v1 for Dobias and Venev, and design the schema so a BOM can be
added without rewriting it — a `ref.bom (parent_sku, component_sku, quantity)` table and a
demand-explosion step is enough to keep the door open.

Worth noting the silver lining: **Shoptet's API is better than Shopify's here.**
`GET /api/stocks/{stockId}/movements` is a genuine ledger with a `changeTimeFrom` filter,
and every row carries `actualAmount` — the absolute stock level *after* the movement. So
history can be read retroactively at any past date rather than replayed from deltas.
Paginate on `lastId`, not `changeTime`; Shoptet warns that multiple events share a
one-second timestamp.

---

## 9. What this is worth

**For the client**
- Stop losing revenue on A-class stockouts. Dobias had two live examples in one snapshot.
- Free trapped cash. Venev's ~EUR 23,780 is the clearest case; Dobias' H+ line is larger.
- See expiry risk two quarters early, while a markdown still recovers something.
- A buying plan that states the cash requirement, so it can be checked against the P&L
  before it is committed.

**For us**
- The QBR stops being a ROAS conversation. This is exactly the wedge MarginOS sells to
  agencies — *"move conversations from ROAS to contribution, payback and inventory
  reality"* — and we can do it better because the CM stack already exists.
- The media flag prevents spending against SKUs that cannot be restocked in time. That is
  a defensible, checkable claim about wasted budget.
- Inventory-aware media planning has no shipped equivalent in the Shopify ecosystem.

**What it is not**
- Not a forecasting system. Naive and seasonal baselines are the correct starting point at
  these volumes, and often the correct ending point — Venev sells five orders a month, and
  no model earns its keep there.
- Not a WMS. No picking, no receiving, no cycle counting.
- Not automated. v1 recommends; a human decides and places the order.

---

## 10. Open questions

1. Lead time and MOQ per supplier — rough estimates are fine, the difference between 60
   and 70 days does not change a decision but 14 vs 90 changes everything.
2. Shelf life per product type, and whether batch/lot is tracked anywhere today.
3. Dobias' zero-stock A-class SKUs: real stockout, or inventory tracking simply switched
   off for part of the catalogue? This changes whether they are alerts or noise.
4. The 32 negative-stock variants — overselling, or an artefact?
5. Venev's 783 missing units in 2026-07 — expiry write-off, stocktake, or something else?
6. Is anyone at the client side going to *act* on the buying plan, or is v1 really an
   internal tool for us that the client can also see?
7. Czech GAAP treatment of inventory write-down reversal (§5).

---

## Appendix — research sources

Four research passes, full reports in the session scratchpad:

- `research_tools.md` — Shopify native/Stocky/SFN, Inventory Planner, Prediko, Fabrikatör,
  Assisty, Cogsy, Netstock, ShipBob, Shipfusion, ShipMonk, Flexport, Amazon Seller Central;
  formulas, screen inventories, and where vendors disagree.
- `research_abc_sellthrough.md` — Shopify ABC exact spec, ABC/Pareto theory, ABC-XYZ,
  sell-through definitions and benchmarks, EU cosmetics regulation, expiry/PAO/FEFO.
- `research_cfo_framing.md` — Blue Sense Digital's actual frameworks, CCC/OTB/inventory
  financing, censored demand, marketing–inventory coupling, dashboard adoption and alarm
  management.
- `research_shopify_inventory_history.md` — what is retrievable retroactively from Shopify
  and Shoptet, and what must be snapshotted from today.

Note on Blue Sense Digital: they are a real Australian performance-media agency
(*"Performance media, judged by the P&L"*), and their LTGP:CAC and MER frameworks are
well documented. But their full site contains **zero** inventory, open-to-buy,
cash-conversion-cycle or working-capital content. "Inventory velocity" appears once, as a
$50M+ efficiency lever. Their framing informs §9; none of the substance in §4–§5 could
come from them.
