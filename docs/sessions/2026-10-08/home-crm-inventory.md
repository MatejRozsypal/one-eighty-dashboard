# Home / client health: data inventory

Date: 2026-10-08. Read-only SELECTs against `oneeighty-warehouse` and read-only ClickUp lookups (workspace 90151448219).
Branch: `home-crm-page`.

## Summary

Results against goals are fully available for the two clients with a plan (Ethia, Manami) and as plain month-to-date
actuals for the other three. Everything about the money between us and the client (contract terms, baseline,
profit share, fees, payments) is **not in the warehouse yet**: every agency-money object exists but is empty. ClickUp
holds the agreed retainer per client and an Invoice Tracker that stopped at 04/26.

| Object | Rows (2026-10-08) | Note |
|---|---|---|
| `ref.clients` | 5, all `status = 'active'` | dobias, ethia, manami, rawbark, venev |
| `mart.plan_pacing` | 4,195 | month and quarter rows for **ethia and manami only**; as of 2026-10-07 |
| `mart.plan_actuals_daily` | all 5 clients | through 2026-10-07 |
| `ref.contracts` | **0** | no retainer, no profit share %, no contract start |
| `ref.cm3_baseline` | **0** | no frozen baseline |
| `ref.client_monthly_costs` | **0** | so `mart_cm3_monthly.is_complete` can never be true |
| `mart.mart_cm3_monthly` | **0** | inner join on `ref.contracts`; also built from `stg_woo_orders` only |
| `mart.mart_profit_share_monthly` | **0** | joins `ref.contracts` and `ref.cm3_baseline` |
| `ops.profit_share_statements` | **0** | no statement ever generated |
| Payments | no object | no column anywhere in the warehouse records money received |

A column search over `region-eu.INFORMATION_SCHEMA.COLUMNS` for retainer, invoice, fee, profit share, baseline,
payment and billing found nothing beyond the objects above (and `mart_qa` copies).

ClickUp:

* Client Success > **Clients** (901522365067): one task per client with status (`steady`, `onboarding`, `churned`),
  `Retainer CZK`, `Billing Type` (Monthly Retainer, Project, Rev Share + Retainer), `Billing Day`, `Services`, and a
  relationship to the Invoice Tracker.
* Billing & Finance > **Invoice Tracker** (901522370596): `Invoice Amount`, `Profit share`, `Pohoda Invoice ID`,
  relationship `Client`. Only 4 tasks, all `04/26`, all `ready for accountant`. No paid status, no later months.

## Question by question

| # | Question | Source on the page | Freshness | Status |
|---|---|---|---|---|
| 1 | Client status | `ref.clients.status` + ClickUp Clients task status + Billing Type | registry live; ClickUp live per request | available |
| 2 | Are we generating results | `mart.plan_pacing` current month rows (revenue, CM3, aMER with the Goals status); ring = CM3 when targeted, else revenue. Without a plan: `mart.plan_actuals_daily` month to date. Plus month to date vs the same days last year (revenue %, CM3 difference) from the same daily actuals | as of 2026-10-07 | available; ring only for ethia, manami |
| 3 | Enough money after paying us | last complete month of `mart_profit_share_monthly`: CM3 minus `ref.contracts.retainer_czk` minus profit share | n/a | **n/a**: `ref.contracts` empty |
| 4 | Money generated for them | sum of `cm3_delta` (CM3 over the frozen baseline) over complete months with a baseline, `mart_profit_share_monthly` | n/a | **n/a**: `ref.contracts` and `ref.cm3_baseline` empty |
| 5 | Money received from them | none | n/a | **n/a**: no payments source (payments are in Pohoda, not connected). Shown instead: agreed retainer (contract, else ClickUp `Retainer CZK`) and the last invoice in the ClickUp Invoice Tracker |
| 6 | Performance fee (profit share) | latest `ops.profit_share_statements`, else latest complete month of `mart_profit_share_monthly`; beside it the profit share on the last ClickUp invoice | statements: none; invoices: 04/26 | contract figure **n/a**; invoiced figure only for clients with a 04/26 invoice |

## Per client

| | ethia | manami | venev | dobias | rawbark |
|---|---|---|---|---|---|
| Registry status | active | active | active | active | active |
| ClickUp status | steady | steady | steady | steady | onboarding |
| Billing Type (ClickUp) | Rev Share + Retainer | Rev Share + Retainer | Rev Share + Retainer | Monthly Retainer | Rev Share + Retainer |
| Retainer CZK (ClickUp) | 20,000 | 15,000 | 20,000 | 140,000 | 50,000 |
| Shop platform | woocommerce | shoptet | shopify | shopify | woocommerce |
| Currency | CZK | CZK | EUR | USD | CZK |
| Plan this month (Goals) | yes | yes | no | no | no |
| Revenue MTD | yes | yes | yes | yes | yes |
| CM3 MTD | yes | yes | yes | yes | **n/a** (no cost data, 7 of 7 days null) |
| aMER MTD | yes (plan) | yes (plan) | yes | yes | **n/a** (paid spend missing on 1 day) |
| Revenue vs last year | yes | yes | **n/a** (no revenue a year ago) | yes | yes |
| CM3 vs last year | yes | yes | **n/a** (no revenue a year ago) | yes | **n/a** (no cost data) |
| Contract terms (`ref.contracts`) | none | none | none | none | none |
| Contract CM3 (`mart_cm3_monthly`) possible at all | yes once contracted | **no**, WooCommerce only | **no** | **no** | yes once contracted |
| Last invoice (ClickUp) | none | 04/26: 15,000 + profit share 6,005 | none | 04/26 | none |

Also in ClickUp and not in the registry: **Horeka - 7agency** (steady). The page shows it as a card with the
ClickUp fields and no shop data. Churned ClickUp clients (Ninjabot, RevolutionIT) are left out.

## What would turn the n/a into numbers

1. Insert the current contract per client into `ref.contracts` (retainer, profit share %, contract start, media
   channels). This alone makes the profit share mart non-empty for WooCommerce clients.
2. Freeze the baseline months into `ref.cm3_baseline` and add the storage rows to `ref.client_monthly_costs`, so a
   month can be `is_complete`.
3. Decide how contract CM3 is computed for Shopify and Shoptet clients: `mart_cm3_monthly` reads `stg_woo_orders`
   only, so Manami, Venev and Dobias cannot get a profit share figure from the mart as built.
4. For money received: a payments feed from Pohoda (or a paid status and date on the Invoice Tracker, kept monthly).
