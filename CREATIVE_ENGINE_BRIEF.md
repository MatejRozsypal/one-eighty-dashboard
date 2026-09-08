# Creative Engine — build brief

> Second instance of the One Eighty dashboard. Reads the same BigQuery warehouse, adds creative
> assets and ClickUp tagging, and answers one question: **which personas, concepts, angles, offers
> and formats are earning the spend, and which are noise.**
>
> Owner of the operating model: Lukáš. Owner of the data model: Matt.
> Source process: `agency/_processes/meta-creative-engine/` (authoritative, do not re-derive
> decision logic here). Reference: Blue Sense Digital 2026 framework, M4 Method.

---

## 0. The one thing that shapes everything

One Eighty's clients spend roughly two orders of magnitude less than the accounts Motion and Blue
Sense Digital are built for. Manami runs about **91 000 Kč a month** at a CPA of **527 Kč**. That is
about 173 purchases a month across the entire account.

Purchase counts are the denominator of every money metric. So:

| Level | Typical 30-day purchases | 95% interval on ROAS | Can it carry a decision? |
|---|---|---|---|
| One ad at the signal floor (215 Kč/day) | ~12 | ±66% | No |
| One ad, typical | 4 – 14 | ±60 – 115% | No |
| One ad set | 6 – 85 | ±25 – 93% | Sometimes |
| One persona, 30 days | 4 – 20 | ±51 – 115% | No |
| One persona, lifetime | 20 – 90 | ±24 – 51% | Yes, eventually |
| Whole account | ~173 | ±17% | Yes |

Relative standard error on ROAS is approximately `1.17 / √purchases` (Poisson arrivals plus order
value variance at CV ≈ 0.6). The 95% half-width is `2.29 / √n`.

**To claim with 95% confidence that an ad set truly running at the 2,50 target is above the 1,80
kill line, you need roughly 65 purchases, which is about 34 000 Kč of spend.** Manami's whole
account supports about 2,7 such statements per month.

A dashboard that ranks 12 personas by last-30-days ROAS at this spend level is a random number
generator with a nice font. It will be confidently wrong, and because it looks authoritative it
will make decisions *worse* than the current spreadsheet. The learnings file already recorded this
happening: format, funnel stage and offer all "showed differences" that did not survive scrutiny,
and the only variable that actually separated was which ad set the ad sat in.

### The two-speed answer

Impression-based metrics have 50 to 100 times more samples than purchase-based ones for the same
spend. At **3 000 Kč** of Manami spend:

- **Hook rate** rests on ~20 000 impressions → readable to **±1,4% relative**
- **ROAS** rests on ~5,7 purchases → readable to **±96% relative**

So the system runs two loops at different clocks:

- **Fast loop, days, ad level.** Hook rate, hold rate, CTR, CPC, cost per ATC. These say whether a
  creative earns attention. Nathan is right that they do not predict conversion, so they never
  produce a scale or kill verdict. They produce **iteration instructions**: hook problem, bridge
  problem, or body problem.
- **Slow loop, weeks to months, ad set and above.** ROAS, CPA, contribution margin. These produce
  money verdicts, and only when the interval clears the line.

**Consequence for the product:** tag-level breakdowns (persona, angle, offer, concept, creator)
default to **lifetime-to-date**, not a 30-day window. A persona tested across five months may reach
80 purchases even though no single month reaches 20. Accumulation is how a small account buys
statistical power. A 30-day toggle exists, and it is labelled as diagnostic only.

### Two mechanisms that stop the tool lying

**1. Shrinkage toward the account mean.** Every reported ROAS on a tag row is an empirical-Bayes
posterior, not a raw ratio:

```
reported = (n × observed + k × account_mean) / (n + k)      k = the client's read threshold (25)
```

An ad with 4 purchases at a raw 3,38 reports as **2,17**, not 3,38. This is the arithmetic version
of the rule already in the learnings file: *a creative at 15× on trivial spend is not a winner.*
Both numbers are shown; the shrunk one is the one that sorts and colours.

**2. Nothing sorts by ROAS.** Every table sorts by spend share. Nathan's metric hierarchy puts
Amount Spent first precisely because Meta's sequencing hides upper-funnel contribution from
last-click ROAS, and because under CBO roughly 4% of ads end up holding 64% of spend and revenue.
Spend share is what the algorithm decided; ROAS is a noisy estimate of what happened next.

---

## 1. What this instance is, and is not

**Is:** a creative-analytics layer over Meta. Tag every ad with the concept that produced it, then
show what earned spend and what the numbers can and cannot support.

**Is not:** a replacement for the existing dashboard (that stays the P&L and channel view), a media
buying tool (no writes to Meta), a Motion clone (their statistics assume 50× the spend), or a
prediction engine. Nathan's line governs the whole design: *nobody can pick winners.* Show ten good
strategists five good ads and none will name the winner. So the tool measures the quality bar and
the volume above it. It does not forecast.

**Out of scope for v1:** Facebook Ad Library competitor swipe, Google Ads banners, TikTok.

**Clients at launch:** Manami and Venev. Venev's ClickUp must carry identical field IDs.

---

## 2. Hierarchy and the tagging contract

```
Persona            MAN_HeadacheFromSynthetics_OfficeWoman_30s
  └─ Concept       C07  ·  exactly one angle, exactly one persona, one offer
       └─ Body     b1   ·  one script
            └─ Hook variant  h3  ·  ONE META AD  ← the unit that gets an ad_id
```

Rules, now written into `SOP_master.md` §4.4:

- Change the angle or the persona and it is a **new concept**, new ConceptID.
- Every ad **inherits** persona, angle and offer from its concept. No ad-level override.
- **Hook variants stay inside the same concept and the same body.** Six hooks on one script are six
  ads, one body, one concept.

Hook variants matter more than anything else in this brief. They are the only creative test One
Eighty currently has the sample size to read (impression-based, fast loop), they are the cheapest
production there is (re-record 3 to 5 seconds), and **One Eighty has never run one.** Nathan reports
rotating 50 new hooks onto a fatigued ad and buying another $100k of spend at the same efficiency,
from about an hour of shooting.

### Naming convention (enforced, but not the join)

```
[PersonaCode] | [ConceptID] | [Stage] | [Format] | [bNhN] | [DATE] | [MKT]

HeadacheFromSynthetics | C07 | TOF | STAT | b1h3 | 04SEP | CZ
```

Stage is **TOF / MOF / BOF** only. Angle and offer are absent because the ConceptID implies them.
`bNhN` replaces `vN`: it says whether an iteration changed the hook or the script.

### The join

**Authoritative: the Meta `ad_id` written into the ClickUp task's `Creative ID` field.** The name is
for humans scanning Ads Manager and as a fallback fuzzy match.

Today that field contains the literal string `"Creative ID"` on every one of the 65 Manami tasks. It
has never been filled once. So the dashboard must fill it, not ask for it:

1. Nightly, every Meta `ad_id` with no ClickUp mapping lands in the **Unmapped ads** queue.
2. The queue proposes a match by parsing the name (persona token, date, format) and scoring it.
3. One click confirms, and the dashboard **writes the ad_id back to ClickUp through the API**.

Two things this must handle:
- **Post-ID graduation creates a second ad_id for the same creative.** `Creative ID` is therefore a
  comma-separated list, and `dim_creative` is many-to-one onto the ClickUp task.
- There is always a window between upload and mapping. The unmapped count is a permanent badge in
  the header, not a page you have to visit.

---

## 3. ClickUp changes required

On `<Client>: Ad pipeline` (Manami list `901521546599`, Venev `901524795825`, template
`901524031947`):

| Field | Type | Values | Why |
|---|---|---|---|
| `Offer` | dropdown | Testovací sada, Plná velikost, Promo, Kvíz, Dárek (GWP) | Currently `Option 1 / Option 2` on the Concept list and unusable |
| `Production method` | dropdown | Internal studio, AI generated, UGC, Influencer, Agency | Drives the cost estimate |
| `Creator` | dropdown or relationship | registry of named creators | No creator field exists anywhere today |
| `Creator type` | dropdown | Agency, Brand employee, UGC creator, Influencer | Different pay structures |
| `Body` | short text | `b1`, `b2` | Groups hook variants |
| `Hook` | short text | `h1` … `h10` | The variant |
| `Production cost` | number (Kč) | auto-filled from settings, manually overridable | Ad level, per user decision |
| `Brief` | url | link to the brief doc | Every ad must have one |
| `Creative ID` | short text | comma-separated Meta ad_ids | **The join.** Clear the placeholder string |

On `<Client>: Concept list`: `Angle` already exists and is correct. Add `Persona` as a relationship
to the Persona Bank, and enforce single-select on both.

**Status hygiene is a prerequisite.** 65 tasks, almost all sitting at `live`, including ads killed in
March. The dashboard reads Meta for what is actually delivering, so this does not corrupt the
numbers, but it makes the pipeline view useless. One cleanup pass before launch.

---

## 4. Data model

### 4.1 New BigQuery objects

```sql
-- raw: one row per Meta ad creative, refreshed nightly
raw.raw_meta_ad_creatives (
  client_id STRING NOT NULL, ingested_at TIMESTAMP NOT NULL, snapshot_date DATE NOT NULL,
  ad_id STRING NOT NULL, creative_id STRING, adset_id STRING, adset_name STRING,
  campaign_id STRING, campaign_name STRING, effective_status STRING,
  object_type STRING,                 -- VIDEO | SHARE | PHOTO | DPA
  image_hash STRING, video_id STRING, -- stable identifiers, unlike the URLs
  title STRING, body STRING, call_to_action_type STRING, link_url STRING,
  asset_uri STRING,                   -- gs:// path in our own bucket, see §5
  asset_kind STRING,                  -- image | video
  thumb_uri STRING,
  payload_json STRING
) PARTITION BY snapshot_date CLUSTER BY client_id, ad_id;

-- raw: ad set daily, currently missing entirely
raw.raw_meta_adset_insights (...)     -- same shape as raw_meta_ad_insights, adset grain

-- ref: the tagging spine, synced from ClickUp
ref.creative_tags (
  client_id STRING, ad_id STRING,     -- many ad_ids per clickup_task_id (post-ID graduation)
  clickup_task_id STRING, clickup_url STRING,
  concept_id STRING, persona_id STRING,
  angle STRING, offer STRING,         -- denormalised from concept, never set per ad
  stage STRING,                       -- TOF | MOF | BOF
  format STRING,                      -- STAT | DYN | CAR | DPA
  body_code STRING, hook_code STRING,
  production_method STRING, creator_id STRING, creator_type STRING,
  production_cost NUMERIC, production_cost_source STRING,  -- 'settings' | 'manual'
  brief_url STRING, market STRING, launched_at DATE,
  match_method STRING,                -- 'creative_id' | 'name_exact' | 'name_fuzzy' | 'manual'
  match_confidence NUMERIC, synced_at TIMESTAMP
);

ref.concepts (client_id, concept_id, name, persona_id, angle, offer, hypothesis,
              status, created_at, clickup_task_id);
ref.personas (client_id, persona_id, name, awareness, segment, status, clickup_task_id);
ref.creators (client_id, creator_id, name, creator_type, pay_model, rate,
              deliverables_per_shoot, product_cogs, usage_fee, rev_share_pct, active);
```

`mart.mart_creative_perf` joins `mart_meta_ad_perf` to `ref.creative_tags` and carries both raw and
shrunk ROAS, spend share, and the confidence class. Follow `METRICS.md`: only summable components
cross the join, every rate is recomputed after aggregation. Never average a `_per_day` column.

### 4.2 App Postgres

Extend the existing Neon schema alongside `client_settings` and `client_goals`:

```sql
CREATE TABLE creative_settings (
  client_id TEXT PRIMARY KEY,
  break_even_roas NUMERIC, kill_roas NUMERIC, target_roas NUMERIC,
  target_cpa NUMERIC, gross_margin NUMERIC,
  scale_multiplier NUMERIC DEFAULT 1.2, aggressive_multiplier NUMERIC DEFAULT 2.0,
  hold_gate_x NUMERIC DEFAULT 1, iterate_gate_x NUMERIC DEFAULT 2, kill_gate_x NUMERIC DEFAULT 3,
  min_adset_budget_daily NUMERIC, per_ad_floor_daily NUMERIC,
  no_touch_days INT DEFAULT 14, tier TEXT,
  read_purchases INT DEFAULT 25, directional_purchases INT DEFAULT 10,
  max_ci_halfwidth NUMERIC DEFAULT 0.25,   -- above this, verdict is NOT SEPARABLE
  hook_rate_floor NUMERIC DEFAULT 0.20, hold_rate_floor NUMERIC DEFAULT 0.05,
  frequency_warn NUMERIC DEFAULT 2.0, frequency_act NUMERIC DEFAULT 3.0,
  updated_at TIMESTAMPTZ, updated_by TEXT
);

CREATE TABLE production_rates (        -- the per-asset cost estimates, manually entered
  client_id TEXT, production_method TEXT, format TEXT,
  cost_per_asset NUMERIC, includes_internal_time BOOLEAN DEFAULT TRUE,
  notes TEXT, updated_at TIMESTAMPTZ, updated_by TEXT,
  PRIMARY KEY (client_id, production_method, format)
);

CREATE TABLE decisions (               -- the accountability log
  id BIGSERIAL PRIMARY KEY, client_id TEXT NOT NULL,
  level TEXT NOT NULL,                 -- 'adset' | 'ad'
  entity_id TEXT NOT NULL, entity_name TEXT,
  review_date DATE NOT NULL,
  computed_verdict TEXT NOT NULL,      -- what the engine said
  final_verdict TEXT NOT NULL,         -- what the human did
  overridden BOOLEAN NOT NULL DEFAULT FALSE, override_reason TEXT,
  learning_note TEXT,                  -- REQUIRED when final_verdict = 'kill'
  spend NUMERIC, purchases INT, roas NUMERIC, ci_low NUMERIC, ci_high NUMERIC,
  decided_by TEXT NOT NULL, decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

A `kill` insert without a non-empty `learning_note` is rejected at the database level. The SOP says a
kill without a documented learning is invalid; software can enforce that, so it does.

### 4.3 Creator pay models

UGC pay structures vary, so `ref.creators.pay_model` is an enum and cost per ad is derived:

| `pay_model` | Cost per ad |
|---|---|
| `flat_per_asset` | `rate` |
| `per_shoot` | `rate / deliverables_per_shoot` |
| `product_gift` | `product_cogs` |
| `base_plus_usage` | `(rate / deliverables_per_shoot) + usage_fee` |
| `rev_share` | `rev_share_pct × attributed revenue`, recomputed nightly |
| `internal` | from `production_rates` for that method and format |

Manual override on the ClickUp `Production cost` field always wins, and `production_cost_source`
records which it was, so the Production ROI screen can show what share of its input was estimated
rather than actual.

---

## 5. Creative assets: how to get the pictures

The open question. Answer: **mirror into our own GCS bucket. Do not try to serve Meta's URLs.**

Meta's `adcreative` endpoint returns `image_url` and `thumbnail_url` on `scontent.*.fbcdn.net` with
**signed, expiring tokens** (hours to days). They cannot be stored in the warehouse and rendered
later; the grid would fill with broken images within a day. Video needs a second call,
`GET /{video_id}?fields=source,picture`, which also returns a time-limited URL and requires the video
permission on the system user.

What is stable is `image_hash` and `video_id`. So:

1. Nightly job (n8n, or Cloud Run for the video downloads) reads new `ad_id`s.
2. For each, `GET /{ad_id}/adcreative` → `image_hash` / `video_id` / `object_story_spec`.
3. If `(client, hash|video_id)` is not already in the bucket, download once and write to
   `gs://oneeighty-creatives/{client}/{kind}/{hash_or_video_id}.{ext}`, plus a 400px WebP thumbnail.
4. Record `asset_uri` and `thumb_uri` in `raw_meta_ad_creatives`. Dedupe on the hash, so a creative
   reused across ad sets or graduated by post ID stores once.
5. Dashboard serves through short-lived signed URLs (or a Cloud CDN backend bucket behind the same
   auth as the rest of the app).

**This is a much smaller problem than it looks.** Manami produces roughly 30 new assets a month.
Video at ~15 MB and statics at ~500 KB gives about **160 MB a month**, so **under 2 GB per client per
year**. GCS Standard in EU is about $0.02/GB/month. Three clients over five years costs under **$10 a
month**, all in. Motion's storage bill is large because they scrape the whole public Ad Library for
inspiration; mirroring your own accounts is a rounding error.

The ClickUp `Output` / `Final` / `Raw files` fields stay the production source of truth on
Drive/Dropbox. The GCS copy is the serving copy, and the dashboard links to both.

**Video playback** in the grid: serve the mirrored MP4 in a plain `<video>` element with the WebP
thumbnail as `poster`, muted and `preload="none"` so a grid of 40 tiles does not pull 600 MB.

---

## 5b. The ad detail view, and where each field comes from

Clicking any creative opens it. Everything on that panel is obtainable from Meta. **Nothing here needs
ClickUp**, which was the open question.

### Already in the warehouse

`purchases`, `purchase_value`, `spend`, `impressions`, `reach`, `frequency`, `clicks`, `ctr`, `cpc`,
`video_play_actions`, `video_thruplays`. Cost per purchase and ROAS are derived. Hook rate is
`video_play_actions ÷ impressions`; hold rate is `video_thruplays ÷ impressions`.

### Add to the existing ad-insights call in `wf_meta_ads_to_bigquery.json`

These are extra fields on a request that already runs, so the cost is one line in the node config:

```
video_avg_time_watched_actions      average seconds played
video_p25_watched_actions           25% of duration
video_p50_watched_actions           50%
video_p75_watched_actions           75%
video_p95_watched_actions           95%
video_p100_watched_actions          completions
video_30_sec_watched_actions
outbound_clicks, unique_outbound_clicks     outbound CTR, the one Nathan actually reads
```

**A real retention curve, not a reconstruction.** With `video_play_actions` (start), the 3-second
figure, the four quartiles, `video_thruplay_watched_actions` (15s) and `p100`, you get **eight real
points** across the duration. The demo draws exactly those eight and interpolates between them, with
the hook and hold moments marked. Pressing play scrubs a marker along the curve so you can read
"at 0:07, 9,2% of impressions are still watching". No estimation from hook and hold rate is needed.

### Ad copy: `adcreative`, no ClickUp

```
GET /{ad_id}/adcreative
  ?fields=object_story_spec,asset_feed_spec,title,body,link_description,call_to_action_type,
          image_hash,video_id,effective_object_story_id
```

- Single image or video: `object_story_spec.link_data.message` is the primary text,
  `.name` the headline, `.description` the description, `.call_to_action.type` the CTA. For video
  ads the same fields live under `object_story_spec.video_data`.
- Advantage+ creative and dynamic ads: `asset_feed_spec.bodies[]`, `.titles[]`, `.descriptions[]`
  return **every text variant Meta is rotating**, which is more than Ads Manager shows in one view.

Store these on `raw_meta_ad_creatives` (§4.1) as `body`, `title`, `link_description`,
`call_to_action_type`, plus `bodies_json` / `titles_json` for the multi-variant case. Same nightly job
as the asset mirror, same call.

### Demographics and placement: two more breakdown tables

Meta will not return arbitrary breakdown combinations in one call, so these are separate requests
against the same insights endpoint, at ad level, `time_increment=1`:

```sql
raw.raw_meta_ad_breakdown_demo      -- breakdowns=age,gender
  client_id, ad_id, date_start, age, gender,
  spend, impressions, reach, clicks, purchases, purchase_value

raw.raw_meta_ad_breakdown_placement -- breakdowns=publisher_platform,platform_position
  client_id, ad_id, date_start, publisher_platform, platform_position, impression_device,
  spend, impressions, reach, clicks, purchases, purchase_value
```

Row multiplier is roughly 12× for age×gender and 8× for placement. On Manami's volume that is still
a few thousand rows a day, which is nothing in BigQuery. Partition by `date_start`, cluster by
`client_id, ad_id`, and keep `require_partition_filter = TRUE` like the existing tables.

**One warning to put in the UI.** Purchase counts inside a breakdown are a fraction of an already
small number. A single ad split six ways by age has single-digit purchases per bucket. So the
breakdown panels show **impressions and spend distribution by default**, which are reliable, and
gate purchase-based figures behind the same confidence rules as everywhere else. Placement and
demographics are for *delivery diagnosis* (where is Meta putting this, and is that where the buyer
is), not for ROAS comparison. The monthly Fastest Horse breakdowns in `07-analyzing.md` run at
account level for exactly this reason.

### What the panel shows

Left column: the creative with a play control, the scrub bar, and the ad copy as Meta serves it.
Right column: key metrics (purchases, cost per purchase, ROAS with its interval, spend, impressions,
reach, frequency, CTR, CPM, and for video the hook rate, hold rate and average time played), the
retention curve, the age and gender split, and the placement split.

For a static, the retention block is replaced by a plain statement that Meta reports no video
metrics for it and that it should be judged on CTR and cost per purchase. Showing an empty chart
would imply the data is missing rather than nonexistent.

---

## 6. The decision engine

Gate order is unchanged from `07-analyzing.md`. What is new is the honesty ladder in front of it, in
the language you asked for:

| Status | Condition | What the UI says |
|---|---|---|
| `DATA MISSING` | no rows, or 0 conversions at ≥ 1,5× CPA | "Check the pixel and the landing page before reading this." |
| `TOO EARLY` | inside no-touch window, or < 50 purchase events (learning) | "No decision until 18 Sep." |
| `NEEDS MORE DATA` | spend below the relevant gate | **"Needs 4 200 Kč more spend to decide."** |
| `NOT SEPARABLE` | past the gate, but the 95% interval spans the target or kill line | "2,15, but the true value is between 1,42 and 2,88. Cannot separate from the kill line." |
| decidable | interval clears the line | SCALE / HOLD / ITERATE / KILL |

`NEEDS MORE DATA` carries the remaining-spend figure, computed from the purchases required to bring
the half-width under `max_ci_halfwidth`, times target CPA. That single number is the most useful
thing on the screen: it converts "we do not know yet" into "this costs 4 200 Kč to find out", which
is a decision Lukáš can actually make.

**Ad level never produces a money verdict.** It produces one of: `hook problem` (hook rate below
floor), `bridge problem` (hook rate fine, hold rate below floor), `body problem` (both fine, CTR
fine, no conversion), or `insufficient signal`. These map directly onto iteration types 1 to 4 in
`08-feedback-loop.md`, and the tool drafts the iteration brief.

**At ad level, compare revenue and ROAS only, not contribution margin.** Per your call: ad-level is a
like-for-like comparison between creatives, not a profitability analysis. Contribution margin enters
at concept level and above, and on the Production ROI screen, where the production cost is a real
input.

---

## 6b. Creative velocity

The unit of velocity is the **pack**, not the ad. One Eighty launches weekly to biweekly batches
into new ad sets with a minimum daily spend held for a 7 to 14 day evaluation window, and the longer
the window, the lower the daily spend. So the mechanic has to be built on packs.

Nathan's model (video at 01:44:58) is `expected value per ad = mean spend per ad × 7-day-click ROAS`,
then `creatives per month = new customer revenue target ÷ expected value`. He names its two failures
himself: it ignores how long an ad takes to spend, and it does not separate winners from losers. The
pack framing closes both, because a pack has a fixed cost to a verdict and a fixed duration.

### One equation, and it already closes

From `_clients/manami/learnings/meta-ads.md`:

```
pack test size        25 purchases ≈ 13 175 Kč at a 527 Kč CPA
min spend, new pack   860 Kč/day  (2 × CPA)
per-ad signal floor   215 Kč/day  (0,5 × CPA)
no-touch window       14 days
```

Which gives:

```
ads per pack      =    860 ÷ 215  =  4 ads     = exactly what PACK6 launched with
a 14-day pack     =    860 × 14   = 12 040 Kč  = 23 purchases at a 527 Kč CPA
a verdict needs   = 25 × 527      = 13 175 Kč  = 16 days at 860 Kč/day
```

The ads-per-pack figure lands exactly on what PACK6 actually launched with, which is a good sign
that the floor is set right. **The horizon does not quite close: a 14-day pack at 860 Kč/day reaches
23 purchases and the test size is 25.** Two purchases short, every pack, which means either the
verdict is taken on thinner data than the standard claims or the no-touch window quietly runs long.
Either raise the pack to **941 Kč/day** or let it run **16 days**. The Velocity screen states this
as a single line rather than a table, because it is one decision with two answers.

### The planner

The cost of a verdict is fixed. How you spread it is the choice, and it is the only real lever:

| Horizon | Pack budget/day | Ads per pack | Packs/month | New ads/month | Share of budget |
|---|---|---|---|---|---|
| 7 days | 1 882 Kč | 8 | 4,3 | 34 | 62 % |
| 10 days | 1 318 Kč | 6 | 3,0 | 18 | 43 % |
| **14 days** | **941 Kč** | **4** | **2,1** | **9** | **31 %** |
| 21 days | 627 Kč | 2 | 1,4 | 3 | 21 % |

Fourteen days is the right setting and it lands on **9 new ads a month**, which is the bottom of the
SOP's MID tier quota of 8 to 16. Anything shorter spends more than half the account on testing;
anything longer outruns the no-touch window and starves the pack.

### The gauges

Eight tiles, red / amber / green, no prose:

| Gauge | Green when | Source |
|---|---|---|
| Packs launched, 30 days | 2 or more | weekly-to-biweekly cadence |
| Ads in the last pack | equals pack budget ÷ per-ad floor | dilutes above, wastes below |
| Days to a verdict | at or under the no-touch window | pack test size ÷ pack budget |
| New ads, 30 days | at or above packs × ads per pack | SOP tier quota |
| Hooks per body | 4 or more of a 6 target | Nathan: 2 bodies + 15 hooks beats 5 bodies + 2 hooks |
| Net-new share of production | at or under 20 % | the 80/20 rule, master SOP §0 |
| Testing share of budget | 20 to 30 % | leaves the carriers funded |
| Pack daily budget | at or above 2 × CPA | floors are not optional at this account size |

Manami reads red on three: **1 pack launched in the last 30 days against a target of 2, 1,0 hooks
per body against a target of 6, and 80 % net-new production against a 20 % target.** None of the
three needs more budget to fix.

### Winner economics, on the Creatives screen

Added below spend, blended ROAS, CPA and purchases, because it is the number that judges everything
else:

- **Winners** — at or above target ROAS with Read confidence
- **Carriers** — above the kill line but under target, with Read confidence
- **Losers** — below the kill line past the 3 × CPA gate
- **Hit rate** — winners ÷ ads launched, against Nathan's ~5 % reference

Manami's measured net-new hit rate is **1,5 %**, one winner from 67 ads. That single number is the
argument for the 80/20 split, for hook variants over new bodies, and for cutting the active persona
set. Everything else in this brief follows from it.

---

## 7. Screens

**The approved UI is `docs/creative-engine/DEMO.html`.** Open it in the browser pane and build
against it. Live copy: https://claude.ai/code/artifact/807d3c29-ad6f-4531-93a6-32335b64818d

1. **Creatives.** Visual grid, thumbnails and playable video, ranked by spend share. Every tag
   filterable. Scorecard row carries spend, blended ROAS, CPA, purchases, **winners, carriers,
   losers and hit rate**. Unmapped ads queue with write-back. Clicking any creative opens the ad
   detail panel: creative fixed on the left at 420px with its scrub bar, everything else scrolling
   on the right — three large primary tiles (purchases, cost per purchase, ROAS with interval), a
   compact secondary metric strip, the retention curve for video only, the ad copy as Meta serves
   it, then demographics and placement.
2. **Concepts.** Angle coverage first: all 18 angle types from the ClickUp vocabulary as a grid,
   used ones showing spend, the rest reading "never run". Then concept cards, Motion-style: the
   concept's ads as a thumbnail strip, persona / angle / offer as chips, figures, and the verdict as
   a status chip with one line of plain text. No decision band, no buttons on the card.
3. **Breakdown.** Pick a dimension: angle (default), persona, concept, offer, format, stage, body
   and hook, creator, production method, ad set. Lifetime-to-date. **Grouped bars: spend and revenue
   as two bars per row on one shared scale**, spend in neutral grey, revenue coloured by status, so
   the gap between the bar ends is the profit. Purchases and ROAS to the right of the pair, share as
   a muted line under the label, never inside the bar. Then the interval chart with its three shaded
   zones and a plain-language readout per row. Then the matrix. Time series last.
4. **Velocity.** Eight red/amber/green gauges in a 4 × 2 grid, the one-pack spec, and the horizon
   chooser. See section 6b.
5. **Production ROI.** Contribution margin against production cost by method. Cost to first winner.

### Presentation rules

- Percentages display as **whole numbers** everywhere except CTR, hook rate and hold rate, where a
  decimal carries real signal at those magnitudes.
- Scorecard grids are symmetric: 8 tiles as 4 × 2, 6 tiles as 3 × 2. Values never wrap.
- No explanatory prose on screen. Labels and numbers. This is software, not a document.
- **Liquid glass surfaces**: translucent panels over a fixed green-tinted gradient ground,
  `backdrop-filter: saturate(180%) blur(22px)`, hairline borders with a top-edge highlight, layered
  soft shadows, 14 to 22px radii, hover lift on cards. Tables stay more opaque than everything else,
  because dense figures on glass become unreadable. Geist and the growth-green accent are unchanged
  from `dashboard/styles/tokens/`.

---

## 8. The persona problem, quantified

You said the personas have been a hassle to measure and there are too many broad ones. Here is the
arithmetic, because it settles the argument.

To read a persona to ±25%, enough to separate a 2,50 performer from the 1,80 kill line, needs about
**84 purchases**. At a 527 Kč CPA that is about **44 300 Kč of spend per persona**.

Manami spends about **273 000 Kč a quarter**. So:

> **Manami can properly read about 6 personas per quarter. The Persona Bank has 12 active.**

And that is the generous version, assuming spend splits evenly. It does not: 34% currently sits on a
single untagged creative, and 5 of the 12 personas have taken no spend at all.

Three consequences, and the tool should enforce all three:

1. **Settings carries a computed `persona capacity`.** "At current spend you can read 6 personas per
   quarter. 12 are active." Cutting the active set is the fix, not better dashboards.
2. **Personas that have taken no spend in 90 days auto-flag as dormant.** They are not findings, they
   are inventory.
3. **The 80/20 rule is what pays for this.** Nine net-new personas produced 67 ads and one winner, a
   **1,5% hit rate** against Nathan's ~5% reference. Iterations of a proven winner are the highest
   hit-rate creative you will ever make. The Production ROI screen prices this: roughly 60 300 Kč of
   production and 92 100 Kč of burned media per net-new winner.

---

## 9. Build order

| Phase | Scope | Ships |
|---|---|---|
| **0** | ClickUp field changes, status cleanup, Venev field parity | Week 1, no code |
| **1** | `raw_meta_ad_creatives` + GCS asset mirror + `raw_meta_adset_insights` | Ingestion only, verify in BigQuery |
| **2** | `ref.creative_tags` + ClickUp sync + Unmapped ads queue with write-back | The join. Nothing else works without it |
| **3** | Screen 1, Creatives grid | First thing anyone sees |
| **4** | Screen 3, Monday review + decisions log | The accountability layer, and the reason Lukáš opens it |
| **5** | Screen 2, Breakdown | Turn on once ~60% of spend is tagged, realistically November |
| **6** | Screen 4, Production ROI | Needs several months of cost data to say anything |

Phases 3 and 4 before 2 is tempting and wrong. A grid of untagged ads is a screensaver.

**Stack:** same as the existing dashboard. Next.js 14 App Router, no API routes, async server
components calling `lib/queries/*`, server actions for mutations, Tailwind bound to
`styles/tokens/*.css`, Recharts, NextAuth, BigQuery via `sa-frontend-reader`, Neon for app state.
Deploy `npx vercel --prod --yes` from the repo root. Reuse `resolveClient()` for tenancy; a `client`
role must never see another client's creatives. Read `runbooks/22_dashboard_deploy.md` before the
first deploy: authorized datasets, Root Directory, and the middleware trap all still apply.

---

## 10. Open decisions

1. Separate Vercel project on a subdomain, or a route group inside the existing app? A route group
   reuses auth, tenancy and tokens for free. A separate app isolates risk. Recommend route group.
2. UGC pay model per creator is modelled in §4.3, but the actual rates and structures need entering.
3. `max_ci_halfwidth` default of 0.25 is a judgement call. It is the dial that decides how often the
   tool says "not separable" instead of giving an answer. Set it once, per client, and do not move it
   to get the answer you wanted.
4. Hook variant testing has never been run. It is the highest-leverage thing in this brief and it
   does not need the dashboard to start.
