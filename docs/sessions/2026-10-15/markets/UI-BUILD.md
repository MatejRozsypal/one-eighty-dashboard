# Markets v1a: UI build

Date: 2026-10-15. UI agent, worktree `oe-dash-wt/mk0-markets-spec`, branch `mk0-markets-spec`. Nothing committed, pushed or deployed. No file under `infra/` touched.
Inputs: CONTRACT.md (including the data agent's amendments), DATA-BUILD.md section 0, SPEC.md, proposal.html (Option A "Atlas": layout and behaviour ported, CSS not).

## 1. What was built

`/markets` (nav item "Markets" with a globe icon, Profitability group, any shop platform), in the Health skin with existing tokens and `components/ui` only.

- **Controls.** Period picker, Compare (Prev period / Prev year / None) and the % | 123 delta toggle are the app's own `PageControls`. Default preset 90 days (30 days is too thin for small markets). On the page: view switch Sold markets / Scouting, currency Base / Local, map metric (GP after ads, Net revenue, nCAC, LTGP:CAC, Status). Those four plus the open market are held client-side and written to the URL in place (`view`, `mccy`, `map`, `market`), like the delta toggle, so they never re-run a warehouse query and a shared link reopens the same view.
- **Map hero.** `d3-geo` + `topojson-client`, outlines from `world-atlas` JSON imported at build time and projected on the server (`lib/markets/geo.ts`): the browser gets only path strings, never the atlas (route JS is 118 kB first load, unchanged order of magnitude). Framed to the client's markets (conic conformal North America for US/CA, Mercator Central Europe for CZ/SK, Natural Earth when a frame spans an ocean). Choropleth on a growth-token ramp (nCAC inverted, LTGP:CAC fixed 0 to 3x, at or below 0 in the negative token), hatched for n/a, countries pooled into Other and scouting candidates. Markets are focusable buttons (Tab, Enter or Space). Tile-grid fallback when a market has no outline. ChartSummary (or an sr-only list for Status) on every map.
- **Leaderboard.** Ranked by GP after ads, falling back to gross profit, then net revenue when any market lacks it; verdict chip (with "on CM1" and the rule in an InfoTip), maturity badge, delta.
- **P&L matrix.** Markets as columns (ranked), Other, Unallocated (spend only, never spread), Total. Sections Volume, Revenue, Profit, Acquisition, Lifetime, each collapsible. Deltas under every period figure (DeltaChip, follows % | 123). CM2, CM3, shipping cost, payment fees and compare-at markdown stay as rows with n/a and the reason. Lifetime reads complete cohorts at 90 / 180 / 365 d (repeat, revenue, GP per customer, cohort CAC, LTGP:CAC, CAC payback); the forecast has its own two rows (GP per customer 365 d and LTGP:CAC 365 d), dashed, italic, labelled "forecast" with the band, and never appears in Total, ranking or verdicts. First column sticks on narrow screens.
- **Drawer.** KPIs (net revenue, GP after ads, nCAC, MER, LTGP:CAC 365 d, payback), waterfall gross sales to GP after ads with the CM2 lines as empty dashed placeholders, cohort GP curve vs the nCAC line with the home market in grey and the forecast as a dashed segment plus band, discount block with the addiction flag (rate over 15 % plus a second signal), ops friction (COD, free shipping, shipping per order, refunds, payment mix; delivery mix, COD refusal, fulfilment as n/a), leading indicators for Young and Directional markets. Escape and the scrim close it; focus returns to whatever opened it; deep links (`?market=CA`) open it on load.
- **Scouting.** Map of sold markets vs hatched candidates, opportunity index as an honest empty state (needs F10/F11), candidates table (DataTable): orders with no campaign (from OTHER split by `country`), research candidates, VAT, Meta audience and CPM from the research, GA4 and search demand n/a with reasons.
- **Status logic** (SPEC section 4, `lib/markets/model.ts`): maturity Young / Directional / Established; verdicts Exit, Fix structure (names the driver), Fix acquisition, Scale, Hold, No verdict, all on CM1 while CM2 needs rate cards. Young markets get no verdict.
- **n/a**: glyph `n/a` plus an InfoTip with the reason, decided next to the arithmetic that failed (platform gaps, no COGS F7, no spend, spend history gap, cohort too young, forecast `none` reason).

## 2. Contract amendments applied (DATA-BUILD.md section 0)

| Amendment | Where |
|---|---|
| Cohort GP per customer = gp_N / `costed_customers`; first-order GP per customer likewise; repeat, revenue and CAC stay on `customers` | `cohortSummary` in `lib/markets/model.ts`, query reads `costed_customers` |
| `allocation = 'none'` on UNALLOCATED rows | `AllocationRule` type, allocation labels, demo fixture |
| Quarterly forecast rows keyed by the quarter's first month | `forecastSummary` reads three cohort months for the CAC; weights by the row's own `customers` |
| Forecast shown only where the backtest supports it; `none` rows render n/a with `reason_if_none` | `forecastSummary` |
| `mk_client_markets` (prod `ref.client_markets`): sold set, home market (`is_home`, Dobias = US), local currency | `clientMarkets()` in the query layer; `configuredMarkets` overrides the fallback rule (spend in 365 d, home, 5 % of revenue) |
| AOV new / returning on net sales, first-order GP from `new_customer_gross_profit / new_customer_costed_orders`, COGS % on `costed_net_sales` | `periodMetrics` (falls back to the old derivation on a source without the columns) |
| `spend_base` NULL = no spend data that day | days counted per range; nCAC, MER, aMER and GP after ads become n/a with the gap, spend is shown and noted "Partial"; cohort months with NULL spend days read `cohort_spend` as missing (lower bound, so CAC n/a) |
| `country` on orders | OTHER split back by country for Scouting and the map's Other members |

## 3. Files

New:
- `dashboard/app/(app)/markets/page.tsx`, `loading.tsx` (route guard + skeleton)
- `dashboard/components/markets/MarketsScreen.tsx` (header, controls, Suspense with per-widget skeleton), `MarketsSkeleton.tsx`, `MarketsView.tsx`, `MarketMap.tsx`, `Leaderboard.tsx`, `PnlMatrix.tsx`, `MarketDrawer.tsx`, `Waterfall.tsx`, `CohortChart.tsx`, `ScoutingView.tsx`, `bits.tsx`
- `dashboard/lib/markets/types.ts` (contract shapes), `model.ts` (all derivations, pure), `display.ts`, `state.ts`, `geo.ts` (server only), `scouting.ts` (research reference)
- `dashboard/lib/queries/markets.ts` (BQ, `MARKETS_SOURCE` = `mart_qa` default | `mart`)
- `dashboard/lib/demo/markets.ts` (contract-shaped fixture, two shapes)
- `dashboard/scripts/check-markets.ts` (`npm run check:markets`, 108 checks)
- `dashboard/app/dev/markets/page.tsx` (dev harness, see section 4)

Changed: `lib/nav.ts` (item + icon key), `components/shell/NavIcon.tsx` (globe), `lib/capabilities.ts` (`/markets` any shop), `scripts/check-capabilities.ts` (nav counts +1, `/markets` in the shop pages), `package.json` / `package-lock.json` (d3-geo, topojson-client, world-atlas, their types; `check:markets` script).

## 4. How to run the demo locally

Local `next dev` cannot sign in (no Postgres, no SSO) or read BigQuery, so the real route is unreachable on a laptop. The harness renders the same `MarketsScreen` inside the shell providers for the DEMO client only (no query can reach the warehouse) and answers 404 under `next build` / `next start` (verified).

```
cd dashboard
PATH=/Users/matej/.local/node/bin:$PATH npx next dev -p 3107
open http://localhost:3107/dev/markets            # US + CA demo
open http://localhost:3107/dev/markets?region=eu  # CZ + SK demo, with a Young PL test market
```

On the deployed app the demo client (`?client=demo`) renders `/markets` with the same fixture; the "US + CA | CZ + SK" switch shows for the demo client only. Delete `app/dev/` if the harness is not wanted in the tree.

Fixture: proportions from research/data-audit.md (Dobias-like US/CA in USD: new share, AOV new vs returning, discount 12 % vs 16.5 %, COGS 19 % vs 25 %, nCAC 44 vs 92, repeat curves; RawBark-like CZ/SK in CZK with COGS added so the whole page renders, SK Directional, COD shares), volumes scaled, every series generated. It produces the contract rows (daily sums, order extras, spend with allocation, cohorts, forecast run, client markets, OTHER by country) and goes through the same `buildModel` as production.

## 5. Verified

- `tsc --noEmit` clean. `next build` exit 0 (`/markets` 118 kB first load JS, the atlas stays on the server).
- Check scripts: markets 108/108, capabilities 411/411, delta 177, delta-shop 65, delta-paid 181, delta-cmpc 72, period 58, retention 272, paid 211, reports-* all green, creative, hitrate, velocity, xp, home-alerts green. `check:loading` 331/332: the known pre-existing HandoffStage failure only. `npm run lint`: no ESLint config in the repo (interactive setup prompt), pre-existing.
- In the built-in browser (dev harness, desktop 1440 and 375 px): all five map metrics change fills, title and summary; Local switches columns to CAD / EUR / PLN with "several currencies" notes on Other and Total; region switch navigates; Sold markets / Scouting; map click, map keyboard (Enter) and leaderboard and column-header clicks open the drawer, URL gets `market=`, Escape closes and returns focus; deep link `?market=SK` opens on load with no hydration error; section collapse; Compare None (no deltas, toggle hidden), Prev year (labels "vs last year"), delta 123 (absolute deltas); no horizontal page scroll at 375 px (sr-only text in table cells was escaping the scroller; fixed with a positioned scroller); no console errors after the fixes.
- The app has no dark theme (light everywhere by design), so none was tested.

Fixed during verification: page widened at 375 px by sr-only text, hydration mismatch on a deep-linked drawer, unreadable map and chart labels on a phone (labels and the cohort chart now size to the rendered width), waterfall labels truncated, Directional chips faded below contrast (now full contrast with the Directional badge beside them).

Screens: `screens/01-sold-markets-us-ca-desktop.jpg`, `screens/02-market-drawer-ca-desktop.jpg`, `screens/03-cz-sk-status-map-375px.jpg`.

## 6. Needs production data to verify

- Every SQL in `lib/queries/markets.ts` has only been type-checked, never run (no credentials locally): column names follow CONTRACT.md with the amendments. First run against `mart_qa` should check `mk_client_markets` (`is_home` BOOL), `country` on orders, `costed_customers`, forecast `customers`.
- Real n/a paths: Manami (no gross, discounts, refunds, shipping), RawBark (no COGS: ranking falls back to net revenue, verdicts "No verdict", forecast `none`), Dobias spend gap before 2026-04-20 (nCAC, MER, GP after ads n/a on L12M; cohort CAC n/a), Dobias CA local currency after 2026-05 (FX NULL).
- Venev-size samples: maturity rules make every market Directional; check the page still reads well with three tiny markets.
- Map frames for real market sets (single-market Ethia: CZ only; Manami CZ/SK with Other members from `country`).
- Payback is interpolated between ages 0/30/60/90/180/365; confirm the owner accepts that until daily cohorts exist.
- Open UI decisions: Ethia's untested quarterly forecast (shown if the run carries it); default 90-day preset; Markets placed under Profitability in the nav.
