# Creative thresholds entry, 2026-10-05

Where: dashboard.oneeighty.cz/settings?client=<id>, section "Creative Engine" (expand header, edit, Save). Each client saved, page reloaded, values read back.

## (A) Dobias cost assumptions (read only, not changed)
- OpEx % of revenue: 35
- Fulfilment / order: 20.5 USD
- Other CM1 / order (USD): empty (placeholder n/a)
- Last saved stamp: 2026-08-04, matej@oneeighty.cz
- 20.5 >= 20, so the "fulfilment ~20 USD or more" branch applied: kill ROAS 1.50, break-even ROAS 1.51.

## Field mapping
- targetRoas = "Target ROAS"
- kill ROAS = "Kill ROAS" (tooltip: below this every sale loses money)
- target CPA = "Target CPA (<currency>)"
- break-even ROAS = "Break-even ROAS"
- gross margin = "Gross margin %" (percent form: entered 80, 73, 68.4)
- read purchases = "Read at" (tooltip: purchases before a row is Read confidence, also shrinkage weight)
- directional purchases = "Directional at"
- kill gate multiple = NO FIELD EXISTS. Skipped for all clients. ("Test size", default 25, is a different thing: purchases a pack must reach before its verdict means anything. Left untouched.)

## Before / after (all other fields untouched: max interval 25, hook rate floor 20, hold rate floor 5, tier empty, no-touch days 14, test size 25, packs/month 2, hooks per body 6, net-new share 20, budgets blank/derived)
Before, all four clients: Kill ROAS, Target ROAS, Target CPA, Break-even ROAS, Gross margin all empty; Read at 25, Directional at 10 (defaults). Summary said "No thresholds set".

| Client | Kill | Target ROAS | Target CPA | Break-even | Gross margin % | Read at | Directional at | Verified after reload |
|---|---|---|---|---|---|---|---|---|
| dobias | 1.5 | 3 | 54 USD | 1.51 | 80 | 25 (unchanged) | 10 (unchanged) | yes |
| ethia | 1.7 | 2.5 | 550 CZK | 1.66 | 73 | 10 | 5 | yes |
| manami | 1.8 | 2.25 | 527 CZK | 1.46 | 68.4 | 15 | 6 | yes |
| venev | 1.9 | 2.1 | NOT SET | 1.89 | empty (as instructed) | 10 | 5 | yes |

## Skipped / needs a decision
1. Kill gate multiple (3): no such field in Settings for any client. Not entered. Probably lives elsewhere or is not yet exposed.
2. Venev target CPA 783: the Venev form is denominated in EUR ("Target CPA (EUR)"), the instruction said 783 CZK. Entering 783 would have meant 783 EUR (about 25x too high), and I did not want to guess an FX rate. Left empty. Dashboard summary for Venev now reads "Missing CPA". Needs either the EUR figure from the owner or confirmation of the conversion rate.
3. Dobias: Other CM1 cost per order is empty (n/a), so nothing to read.
