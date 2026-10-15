# Markets Scouting: opportunity index

2026-10-15, worktree `mk0-markets-spec`. Nothing committed, pushed, deployed or written to BigQuery.

## Definition (owner-approved, implemented as written)

The index is a signal for what to test next. It is never a verdict.

- **Candidates:** every country in `mart.market_scouting_signals` for the client, plus `researchCandidates()`. The research candidates stay in even with no data. The sold set is removed, and only ISO-2 codes are kept.
- **Signals:** each is scored 0..1 against the best candidate of the same client. Higher is better.

| Signal | Raw input | Weight | Scale | n/a when |
|---|---|---|---|---|
| Proven pull | `new_customers_365` | 0.35 | log1p(x) / log1p(max) | signals view not readable |
| Unpaid interest | `unpaid_engaged_sessions_90` | 0.25 | log1p(x) / log1p(max) | `ga4_days_90` is NULL (GA4 not connected) |
| Search demand | `search_volume_core` | 0.25 | log1p(x) / log1p(max) | NULL (core terms not confirmed) |
| Cost to reach | home Meta CPM / country Meta CPM | 0.15 | ratio / max ratio, capped 0..1 | either CPM missing, or no benchmarks loaded ("Benchmarks not loaded") |

- **Index:** round(100 x sum(w x s) / sum(w over the available signals)). It needs at least 2 available signals. Below that it is n/a, and the reason names each missing signal and why it is missing. Coverage is reported as "k of 4".
- **Measured zero vs n/a:** a candidate with no row in the view has no orders in the window, so pull is 0. With GA4 on, it also has no sessions, so unpaid interest is 0. Both of those count as signals. Not measured is n/a and drops out of the denominator. When the max of a signal is 0, every score for that signal is 0 (not NaN).
- **Ranking:** index desc, then coverage desc, then ISO. Ties share a rank (1, 1, 3). n/a candidates come last, in ISO order.
- **No shrinkage and no smoothing** (owner rule: pure numbers).

### CPM benchmark rules

These follow the 295 seed conventions from the coordinator.

- Source: `ref.industry_benchmarks`, `metric_id = 'meta_cpm'`, `is_active`, ISO-2 regions only. CEE and GLOBAL are not read, because a shared regional CPM would give every country the same cost to reach.
- Vertical: the client's own (`ref.client_verticals`) first, then `all_ecommerce`.
- The query keeps one row per country x vertical x source: median, then mean, then range midpoint; latest `as_of`.
- **Pairing:** home and country must come from the same vertical and the **same source**, and be in one currency. Sources disagree by up to 1.5x on the same country (US: 16.08 Lebesgue vs 23.00 AdAmigo), so mixing them would turn the ratio into a source artefact. Within a vertical, the source that covers the most countries goes first (ties broken by name). For the 295 seed that is Lebesgue, which covers all 10 countries.
- No meta_cpm row in the table at all gives "Benchmarks not loaded", which is the state in prod `ref` today.

## Files changed (dashboard/)

- `lib/markets/opportunity.ts` (new). Pure functions: `SIGNALS`, `logScale`, `ratioScale`, `opportunityIndex`, `cpmRatio`, `candidateSignals`, `scoutCandidates`.
- `lib/markets/types.ts`. Adds `ScoutSignalRow`, `CpmBenchmark`, `ScoutingSignalsRaw`, and `MarketsRaw.scoutingSignals`.
- `lib/queries/markets.ts`. Adds `scoutingSignals(clientId)`, which runs parameterised, client-scoped reads of `mart.market_scouting_signals`, `ref.client_verticals` and `ref.industry_benchmarks`. These always read from `mart`/`ref`, also in mart_qa mode. A missing view gives null, the index goes n/a, and the rest of the page stays up.
- `lib/markets/model.ts`. `MarketsModel` gains `candidates`, `opportunity`, `signals` and `scoutMap` (the research candidates plus the top 8 indexed).
- `components/markets/MarketsScreen.tsx`. Candidates now come from the model. The Scouting map is framed on sold + research countries, and the top indexed candidates are labels within reach of a pan. Without this, one far-off country (AU, SG) zooms the map out to the whole world.
- `components/markets/ScoutingView.tsx`:
  - Index card: the "Not computable yet" note is replaced by a ranked top 6 (rank, country, index, k of 4, one tiny bar per signal; n/a bars hatched).
  - GA4 facts: real engaged sessions and unpaid share. When the 90-day window is not fully covered, the label says so, e.g. "GA4 covers 73 of 90 days".
  - Table: adds Index, GA4 engaged (90 d), Unpaid share and Search demand columns, sorted by index by default, with the top 20 shown and "Show all N" for the rest.
  - Map labels show the index.
  - The F10/F11 "needs GA4" texts are gone.
- `lib/demo/markets.ts`. Demo signals, a vertical and CPM rows:
  - US/CA: GA4 on 74 of 90 days for GB, IE, AU, CH and RS. No search terms. CPM for US, GB and IE only.
  - CZ/SK: no GA4; search demand for DE, AT and HU; CPM for CZ, DE, AT and HU; SI has 1 signal, so it is n/a.
  - PL is a sold test market in the CZ/SK demo, so the view excludes it, exactly as the mart does.
- `scripts/check-markets.ts`. 53 new checks (161 in total): log normalisation, weights, re-weighting, measured zero vs n/a, the 2-signal minimum and its reason, ties and shared ranks, CPM ratio (vertical order, same source, currency, missing home/country, not loaded), demo states, and a ScoutingView render (index, coverage, GA4 day coverage, no F10 text).

## Verification

- `npx tsc --noEmit`: clean.
- `npm run check:markets`: 161 passed, 0 failed.
- `next build`: compiled successfully.
- Browser at `/dev/markets?view=scout` (US+CA):
  - Ranked GB 94, IE 88, CH 67, RS 60, AU 38.
  - GA4 facts: 4,700 engaged, 61.6% unpaid, "GA4 covers 74 of 90 days".
  - Map labels show GB 94 etc.
  - AU is listed as "GA4 visits".
  - No console errors.
- Browser at `?region=eu&view=scout` (CZ+SK):
  - Ranked DE 91, HU 77, AT 75, each on 3 of 4.
  - Unpaid bar hatched; GA4 n/a, "not connected".
  - Search 18,400 / 3,600 / 2,900.
  - SI is n/a, with the missing signals named.

## Prod preview with today's signals (dobias, manami)

How this was computed:

- Signals from `mart.market_scouting_signals`, read-only, 2026-10-15. GA4 covers 73 of 90 days for both clients. No search terms are confirmed, so search is n/a everywhere.
- CPM from `mart_qa.ob1_industry_benchmarks` (prod `ref` holds no meta_cpm rows yet, so the live page currently shows cost n/a "Benchmarks not loaded").
- Run through `opportunityIndex` in a throwaway tsx script.
- 97 of dobias's 178 view rows were left out of the run. Each has 0 new customers and at most 14 unpaid engaged sessions, so it would score at most 16 and moves no max.

**dobias** (home US; vertical pet_supplements has no CPM rows, so it falls back to all_ecommerce, source Lebesgue)

| Rank | Country | Index | Signals | New cust 365 d | Unpaid engaged 90 d | CPM US / country | Pull | Unpaid | Cost |
|---|---|---|---|---|---|---|---|---|---|
| 1 | GB (research) | 88 | 3 of 4 | 15 | 978 | 1.36 | 1.00 | 0.97 | 0.43 |
| 2 | RS | 85 | 2 of 4 | 15 | 97 | n/a | 1.00 | 0.65 | n/a |
| 3 | CZ | 64 | 3 of 4 | 3 | 118 | 2.82 | 0.50 | 0.67 | 0.90 |
| 4 | RO | 62 | 2 of 4 | 4 | 129 | n/a | 0.58 | 0.69 | n/a |
| 5 | CH | 58 | 2 of 4 | 4 | 59 | n/a | 0.58 | 0.58 | n/a |
| 6 | IE (research) | 57 | 3 of 4 | 3 | 98 | 1.95 | 0.50 | 0.65 | 0.62 |
| 7 | FR | 54 | 2 of 4 | 3 | 70 | n/a | 0.50 | 0.60 | n/a |
| 7 | SE | 54 | 2 of 4 | 3 | 71 | n/a | 0.50 | 0.60 | n/a |
| 9 | DE | 50 | 3 of 4 | 2 | 77 | 1.78 | 0.40 | 0.61 | 0.57 |
| 10 | PL | 47 | 3 of 4 | 1 | 37 | 2.90 | 0.25 | 0.51 | 0.92 |
| 11 | IN | 46 | 2 of 4 | 1 | 212 | n/a | 0.25 | 0.76 | n/a |
| 11 | NL | 46 | 2 of 4 | 2 | 50 | n/a | 0.40 | 0.55 | n/a |

**manami** (home CZ; vertical fragrance falls back to all_ecommerce)

| Rank | Country | Index | Signals | New cust 365 d | Unpaid engaged 90 d | CPM CZ / country | Pull | Unpaid | Cost |
|---|---|---|---|---|---|---|---|---|---|
| 1 | AT (research) | 45 | 3 of 4 | 0 | 6 | 0.66 | 0.00 | 1.00 | 0.61 |
| 2 | DE (research) | 35 | 3 of 4 | 0 | 3 | 0.63 | 0.00 | 0.71 | 0.58 |
| 3 | HU (research) | 32 | 3 of 4 | 0 | 1 | 1.09 | 0.00 | 0.36 | 1.00 |
| 4 | PL (research) | 31 | 3 of 4 | 0 | 1 | 1.03 | 0.00 | 0.36 | 0.94 |
| 5 | US | 30 | 3 of 4 | 0 | 3 | 0.35 | 0.00 | 0.71 | 0.33 |
| 6 | CH | 24 | 2 of 4 | 0 | 2 | n/a | 0.00 | 0.56 | n/a |
| 7 | AL, BA, ES, FR, GR, HR | 15 | 2 of 4 | 0 | 1 | n/a | 0.00 | 0.36 | n/a |

### What the preview says

- **Dobias:** GB leads on both pull and unpaid interest. RS ranks second on just 2 signals, because it has no CPM benchmark.
- **Dobias:** SG (1,194 unpaid engaged sessions) and AU (965) have no orders and no CPM. They land at about 42 and 40, just below the table.
- **Manami** has no new customer in any unsold country in 365 days and at most 6 unpaid engaged sessions per country. Its index runs on a single session's difference, so read it as "no signal yet", not as a ranking. Confirmed search terms are the signal that would change this.
- **Search demand** is n/a for every client until the owner confirms terms (SEARCH-TERMS-DRAFT.md). Loading it will move every index.

## Open

- Benchmarks reach prod `ref.industry_benchmarks` after owner OK. The code already reads it, and cost to reach switches on by itself.
- The view emits 178 rows for dobias, so the table shows the top 20 by default.
