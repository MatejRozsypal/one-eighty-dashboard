# Runbook 18 — Multi-tenant cleanup: registry-driven currency (+ other `client_id` branches)

**Status:** planned (not started). Sequenced *after* the 2026-06-21 Dobias email sync fix.
**Goal:** remove every `CASE WHEN client_id = '<x>'` branch from the stg/mart SQL so onboarding
a new client is a registry/data change, never a code change.

## Why

The n8n ingestion layer is already client-agnostic (loops `ref.clients`, per-client secrets,
registry-driven `klaviyo_conversion_metric_id`). The transform/mart layer is not — it carries
per-client branches that each new client would force us to extend.

Root cause for the currency branches specifically is a **data problem masked by code**:
`ref.clients.currency` for Dobias = `CAD`, raw Klaviyo/Shopify rows are tagged `CAD`, but the
analytical currency is `USD` (the "Canada → USD via ref.fx_rates" migration). Downstream views
hand-patch it back with `CASE WHEN client_id='dobias' THEN 'USD'`.

## Inventory of `client_id` hardcodes (audit 2026-06-21)

| Location | Branch | Category |
|---|---|---|
| `200_create_stg_views.sql:108` (`stg_klaviyo_campaigns`) | `client_id='dobias' → 'USD'` | currency |
| `200_create_stg_views.sql:188` (`stg_klaviyo_flows`) | `client_id='dobias' → 'USD'` | currency |
| `203_add_google_spend_to_mart.sql:88,104` | `manami→CZK / dobias→USD` | currency |
| `200_create_stg_views.sql:338,341` (`stg_shopify_order_items`) | `client_id='dobias'` Human/Canine regex | product_line |

> Order-level FX conversion in `stg_shopify_orders` (CAD→USD via `ref.fx_rates`) is driven by the
> **order's presentment currency**, not `client_id` — leave it alone. It's already agnostic.

## Plan — currency (primary)

1. Add `reporting_currency STRING` to `ref.clients` = the single analytical currency per client.
   Set `dobias='USD'`, `manami='CZK'`. (Keep `currency` as legacy/presentment default, or migrate
   callers off it.)
2. Update n8n transforms to write `reporting_currency` into raw, OR — cleaner — stop trusting raw's
   currency tag downstream and source it in stg via `JOIN ref.clients USING(client_id)`.
3. Rewrite the 4 currency branches above to read `c.reporting_currency`. Delete the `CASE WHEN
   client_id=…` expressions entirely.
4. Verify: Dobias email/Google/Shopify scorecards still read USD; Manami still CZK; a hypothetical
   third client with only a registry row resolves currency with no code change.

## Plan — product_line (secondary, Dobias-only today)

Move the Human/Canine SKU regex out of `stg_shopify_order_items`. Options: a `ref.product_line_rules`
table keyed by `client_id` (regex + label), or a per-client config column. Low priority — only Dobias
has the concept — but same principle: config, not a `CASE` in SQL.

## Related open item — flows ongoing sync

Separate from currency, but same "think-ahead" bucket: `stg_klaviyo_flows` SUMs non-overlapping
timeframe windows, so flow ongoing sync can't reuse the campaign rolling-window pattern without a
calendar-month period-key redesign of the backfill + stg. See runbook 15 note. Do before relying on
live (non-backfill) flow numbers for any client.

## Acceptance

`grep -rn "client_id *= *'" infra/bigquery` returns **0** currency branches (product_line optionally
deferred). Onboarding doc reduces to: add `ref.clients` row + secrets + run history backfill.
