# CMP-B Paid: delta display mode on the Paid tabs

Branch `cmp-b-paid`, commit `9c81376` on `main` @ `1e78a31` (CMP1 foundation + hit-rate tile). Not pushed. Frontend only (`dashboard/`), no BigQuery.

## What changed
Every Paid delta now goes through `change={{ current, previous, kind, currency }}` and follows the `% | 123` toggle.

| File | Change |
|---|---|
| `components/paid/overview/PaidTile.tsx` | `delta` prop replaced by `change` (undefined holds the space, null no chip); the "vs prev period" label rides `DeltaChip after=`. |
| `app/(app)/paid/page.tsx` | 8 tiles: money (spend, new-customer revenue, nCAC, CAC, revenue), ratio (aMER, MER), count (new customers). Unused `deltaOf` removed from `overview/model.ts`. |
| `overview/CampaignsAcross.tsx` | Delta Spend (compact money) and Delta ROAS (ratio) cells via `DeltaChip change fallback=<NoValue/>`, sort via `deltaSortKey`; low volume ROAS delta n/a and sorts last in both modes; spend delta column widened. |
| `meta/cells.tsx` | `DeltaCell` takes `change`; local `PpChip` deleted. |
| `meta/MetaKpis.tsx` | KpiTile `change` for 5 outcome tiles, SoftKpi takes `change` (Link CTR, ATC to purchase, Hook rate are `rate`, Frequency is `ratio`); local PpChip removed. |
| `meta/MetaTrend.tsx` | Metric gets `kind`; one DeltaChip, PpChip removed. |
| `meta/MetaCampaigns.tsx` | Delta Spend / Delta ROAS cells and `deltaSortKey` sort; compact money; compare grids and min width widened (spend delta 1.1fr, min 1040px). |
| `google/GoogleKpis.tsx`, `BrandSplit.tsx` | Tiles and lines carry `change`; local PpChip (in `google/parts.tsx`) deleted; rates always pp. Conversions keep one decimal. |
| `google/GoogleCampaigns.tsx` | Delta Spend / Delta ROAS via `change`, `deltaSortKey`, compact money; spend delta column 1.3fr, compare min widths +40px. |
| `ga4/Ga4Kpis.tsx` | 5 tiles on `change` (sessions and purchases count, revenue money, CVR and paid share rate). |
| `scripts/check-delta-paid.ts` (new) | 184 assertions, see below. Orchestrator: add `"check:delta-paid": "tsx --tsconfig scripts/tsconfig.json scripts/check-delta-paid.ts"` to package.json. |

Behaviour notes
- Bug fixed on the way: GA4 Paid CVR and Paid share passed a point difference to KpiTile `delta`, which drew it as a percent (0.5 pp read "0.5%"). Now a real `rate` (pp in both modes).
- Rates formerly relative on Meta (none were) and Google (Brand share, Search IS, lost IS, CTR, Brand leakage were already pp): now `kind: "rate"`, pp in both modes. Frequency (Meta) is a `ratio`; in abs mode it reads "0.31×".
- Zero baseline: pct chip hidden or n/a, abs chip shown (foundation rule). Missing comparison (no previous row) is n/a in tables, no chip in tiles.
- `HitRateTile` and `app/(app)/paid/meta/page.tsx` untouched; the check pins that the tile is still imported.

## Verification
- `npx tsc --noEmit`: 0 errors. `npm run build`: exit 0, 0 warnings (`scratchpad/cmpb_build.log`).
- `check:paid` 211/211, `check:delta` 177/177, `check:loading` 260/260.
- `check-delta-paid.ts` 184/184: renders PaidTile, CampaignsAcross, MetaKpis, MetaTrend, MetaCampaigns, DeltaCell, GoogleKpis, BrandSplit, GoogleCampaigns, Ga4Kpis in pct and abs (money, count, ratio, rate; compact cells; from zero; low volume n/a; no previous; compare off = no chips); spot-checked outputs, e.g. Google abs tiles: "CZK 2,000 | CZK 35,000 | 1.00× | 15 | CZK 16.67 | 9.5 pp"; sort keys order differently per mode; source pins (no PpChip, no relativeChange/pointChange or legacy `delta=` in owned files, deltaSortKey in all three campaign tables, no em dash).
- Not verified: real shell in a browser (needs login), phone width. Compact money + wider grids sized by arithmetic only; worth a look at the Meta/Google campaign tables with abs mode on a narrow window.

## Requests
1. Add the `check:delta-paid` npm script (above).
2. Optional: `lib/paid/math.ts` `relativeChange` / `pointChange` are no longer used by any Paid component (still exercised by `check-paid-math`); leave or delete later (not my file).
