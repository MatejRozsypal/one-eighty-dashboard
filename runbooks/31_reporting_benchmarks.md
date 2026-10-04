# 31. Reporting benchmarks and client verticals

Feeds the Reports product (`/reports`): the benchmark line and hover card next to a client's own
metric, and the "vertical" split. Two hand-fed reference tables:

| Table (prod name) | Role | Created by |
|---|---|---|
| `ref.industry_benchmarks` | One row per vertical x region x metric x period x stat x source | `infra/bigquery/250_ref_industry_benchmarks.sql` |
| `ref.client_verticals` | Which vertical and region each client belongs to, with validity dates | `infra/bigquery/251_ref_client_verticals.sql` |
| `ops.v_benchmark_issues` | Data quality view over both (phase 2, Data Health) | `infra/bigquery/252_ops_v_benchmark_issues.sql` |

**Status (2026-10-05): the DDL is written and was tested in `mart_qa` (prefix `rs10_`). Nothing
in this file has been run in prod.** Both tables start EMPTY on purpose. With no rows the Reports
product simply shows no benchmarks, it does not break. `sa-frontend-reader` already has READER
on `ref`, so no grants are needed.

## The rules (read these before adding anything)

1. **Never invent a value.** A row exists only if you can point at a source: a published report,
   a vendor benchmark page, a platform's own benchmark tool, or our own measured cross-client
   figure. "About right" and "I remember it was around 3" are not sources.
2. **`source` and `as_of` are required.** `source` is what the hover card shows (name of the
   publisher and the report title). `as_of` is the day YOU captured it. Put the link in
   `source_url` when there is one.
3. **Write down how the source defines the metric** in `definition_note`: revenue with or
   without VAT, blended or per-channel spend, attribution window, "all conversions" or purchases
   only. External MER, CAC and ROAS are defined differently from ours (`METRICS.md`, "Reporting
   registry"). If the definition differs from ours in a way that matters, say it there. If you
   cannot tell how the source defines it, do not enter the row.
4. **One row per source.** Two sources for the same metric are two rows, never an average of
   them. The app picks one by the matching rules below.
5. **Region preference is the client's market, then EU, then GLOBAL** (owner decision
   2026-10-05). Enter a regional row when the source is regional (`CZ`, `CEE`, `EU`, `US`) and
   `GLOBAL` only when the source says it is worldwide.
6. **Use the fallback `all_ecommerce`** for a source that covers e-commerce as a whole. It is used
   when a client's own vertical has no row for that metric.
7. **Units are fixed** (see the metric table). Percents are fractions: 1.2 % is `0.012`. A value
   of 45 for CM1 % is wrong (`ops.v_benchmark_issues` flags it as `percent_not_fraction`).
8. **Never edit a value to correct history.** To replace a row, set the old one `is_active =
   FALSE` and insert the new one. To fix a typo in a row you just entered, `UPDATE` it.
9. **`entered_by` is your email.** No secrets, no client-confidential numbers from another
   client's account. Benchmarks are public or purchased industry figures.

## Benchmarkable metrics (`metric_id`)

Ids come from `dashboard/lib/reports/registry/ids.ts` and are a permanent contract. Only these
are flagged `benchmarkable` in the registry; a row for any other id is ignored by the app and
reported on Data Health.

| `metric_id` | Meaning | Store as | `currency` |
|---|---|---|---|
| `aov` | Net sales / orders | money | required |
| `cm1_pct` | (Revenue - COGS) / revenue | fraction | NULL |
| `cm3_pct` | CM3 / revenue, mart definition (also minus fulfilment and paid spend) | fraction | NULL |
| `mer` | Revenue / paid spend (Meta + Google) | ratio x | NULL |
| `amer` | New-customer revenue / paid spend | ratio x | NULL |
| `cac` | Paid spend / new-customer orders | money | required |
| `meta_roas` | Meta revenue / Meta spend | ratio x | NULL |
| `meta_ctr` | Meta clicks / impressions | fraction | NULL |
| `meta_cpc` | Meta spend / clicks | money | required |
| `meta_cpm` | Meta spend per 1000 impressions | money | required |
| `meta_cpa` | Meta spend / purchases | money | required |
| `google_roas` | Google revenue / Google spend | ratio x | NULL |
| `google_ctr` | Google clicks / impressions | fraction | NULL |
| `google_cpc` | Google spend / clicks | money | required |
| `email_open_rate`, `email_click_rate`, `meta_atc_rate` | Phase 2, ids reserved | fraction | NULL |

Columns you fill: `benchmark_id` (unique, readable, for example `<vertical>-<metric>-<period>-<src>`),
`vertical`, `region`, `metric_id`, `period_start`, `period_end` (the period the SOURCE covers),
`stat` (`median`, `mean`, `p25`, `p75`), `value`, optional `value_low` and `value_high` (an
interquartile band, must bracket `value`), `currency`, `source`, `source_url`, `as_of`,
`definition_note`, optional `sample_note` (sample size, who is in it), `note`, `entered_by`.
`is_active` and `entered_at` have defaults.

## Add a benchmark row

Run in the BigQuery console (project `oneeighty-warehouse`, location EU). Fill every
`<placeholder>` with a real, sourced value. This block is a template, not data.

```sql
INSERT INTO `oneeighty-warehouse.ref.industry_benchmarks`
  (benchmark_id, vertical, region, metric_id, period_start, period_end, stat, value,
   value_low, value_high, currency, source, source_url, as_of, definition_note, sample_note,
   note, entered_by)
VALUES ('<vertical>-<metric>-<period>-<src>', '<vertical>', '<EU>', '<metric_id>',
        DATE '<yyyy-mm-dd>', DATE '<yyyy-mm-dd>', 'median', <value>,
        NULL, NULL, NULL,                       -- band and currency, see the table above
        '<publisher and report title>', '<url or NULL>', DATE '<capture date>',
        '<how the source defines the metric>', NULL, NULL, '<your email>');
```

Then check (see "Check after every change" below). Several rows at once: one INSERT with several
`VALUES` tuples.

### Replace or retire a row

```sql
-- Retire (keeps history, the app ignores inactive rows):
UPDATE `oneeighty-warehouse.ref.industry_benchmarks`
SET is_active = FALSE
WHERE benchmark_id = '<benchmark_id>';
```

Then insert the new row with a new `benchmark_id`. Do not DELETE unless the row was a mistake you
entered a minute ago.

## Client verticals

`ref.client_verticals` maps a client to a vertical and a primary region. Rules:

- At most one open row (`valid_to IS NULL`) per client. The open row is current.
- To change a client's vertical: close the old row (`valid_to` = last day it applied) and insert
  the new row (`valid_from` = the next day). Never overwrite the vertical in place.
- `vertical` is lower snake_case and must equal the `vertical` you use in
  `ref.industry_benchmarks`, or the row can never match.
- `region` is the client's primary market for benchmark matching: `CZ`, `CEE`, `EU`, `US` or
  `GLOBAL`.
- A client with no open row is shown as the "Unassigned" vertical and only matches
  `all_ecommerce` benchmarks. That is a valid state, not an error, but Data Health lists it.

```sql
-- Add (template):
INSERT INTO `oneeighty-warehouse.ref.client_verticals`
  (client_id, vertical, sub_vertical, region, valid_from, valid_to, note, updated_by)
VALUES ('<client_id>', '<vertical>', NULL, '<CZ>', DATE '<yyyy-mm-dd>', NULL, '<why>', '<your email>');

-- Change a client's vertical: close, then insert.
UPDATE `oneeighty-warehouse.ref.client_verticals`
SET valid_to = DATE '<last day>', updated_by = '<your email>', updated_at = CURRENT_TIMESTAMP()
WHERE client_id = '<client_id>' AND valid_to IS NULL;
-- then the INSERT above with valid_from = the next day.
```

### Vertical taxonomy (DRAFT, owner decision still open)

**This list is a proposal, not a decision.** The owner has not agreed a taxonomy (design section
8, question 2). Nothing is seeded. The proposal below uses only what the repo says each client
sells; the names follow the examples in the design. Confirm or rename, then seed.

| client_id | Proposed `vertical` | Proposed `sub_vertical` | Proposed `region` | What the repo says |
|---|---|---|---|---|
| `dobias` | `pet_supplements` | `dog_supplements` | `US` | "Holistic dog nutritional supplements & education", markets US and Canada with a 70/30 budget split (`_clients/dobias/brain_dobias.md`). `ref.clients.country` is `CA`. |
| `ethia` | `skincare` | `acne_sensitive_skin` | `CZ` | Natural skincare sold on WooCommerce; the VoC personas are adult acne and sensitive skin, product is a serum (`_clients/ethia/personas/_index.md`). |
| `manami` | `fragrance` | `natural_perfumery` | `CZ` | "Natural perfumery & aromatherapy, Czech e-commerce" (`_clients/manami/brain_manami.md`). |
| `rawbark` | `pet_food` | `dog_granules` | `CZ` | Sells custom-built granules from fresh meat, 91 % of net sales over the last 12 months; shampoos and canned food in broth are the rest (`_clients/rawbark/audit/rawbark-eshop-business-audit-2026-09-26.md`). |
| `venev` | `skincare` | `natural_cosmetics` | `CEE` | "Natural cosmetics / beauty-tech skincare, vegan, cruelty-free"; SK is 87 % of revenue, CZ 3.3 % (`_clients/venev/brain_venev.md`). `ref.clients.country` is `CZ`. |

Decisions the owner has to make on this draft:

1. **`skincare` vs `cosmetics`** for Ethia and Venev. The draft puts both in one vertical so a
   benchmark can compare them. Split if a source distinguishes them.
2. **Dobias region.** There is no `CA` code. `US` is proposed because 70 % of budget is US; a
   CA-only source would have to go in `GLOBAL` or a new code (adding a code means changing the
   allowed list here, in 252 and in `lib/reports/limits.ts`).
3. **Venev region.** `CEE` is proposed because SK is 87 % of revenue and there is no `SK` code.
   `CZ` would match `ref.clients.country` but not the sales.
4. **Granularity.** `sub_vertical` is informational today (matching uses `vertical` only).
5. **`valid_from`** for each row (first day the mapping should apply; benchmarks are matched by the
   report period, so an early date is harmless).

## How the app matches (so you know what a row will do)

For each benchmarkable metric and each vertical among the report's clients:

1. Candidates are rows for `(vertical, metric_id)`, falling back to `all_ecommerce`.
2. Prefer the client's region, then `EU`, then `GLOBAL`.
3. Prefer the period that overlaps the report range most. If none overlaps, take the latest
   `period_end` within 18 months before the range.
4. Ties: the latest `as_of`.
5. Money rows are converted from `currency` into the display currency with `ref.fx_rates` for the
   month of `period_end`. No rate: the benchmark is hidden and the hover says why.
6. `as_of` older than 12 months: shown muted with "Stale" in the hover.

## Check after every change

```sql
-- 1. The row you just added (should return exactly it):
SELECT benchmark_id, vertical, region, metric_id, stat, value, currency, source, as_of
FROM `oneeighty-warehouse.ref.industry_benchmarks`
WHERE entered_by = '<your email>' AND DATE(entered_at) = CURRENT_DATE();

-- 2. Problems in either table (needs 252 deployed; empty result = clean, except
--    client_without_vertical warnings until the verticals are seeded):
SELECT * FROM `oneeighty-warehouse.ops.v_benchmark_issues` ORDER BY severity, issue_code;

-- 3. Every active client has exactly one open vertical row:
SELECT c.client_id, COUNT(v.client_id) AS open_rows
FROM `oneeighty-warehouse.ref.clients` c
LEFT JOIN `oneeighty-warehouse.ref.client_verticals` v
  ON v.client_id = c.client_id AND v.valid_to IS NULL
WHERE c.status = 'active'
GROUP BY 1 HAVING open_rows != 1;
```

Before 252 is deployed, check 1 and 3 plus a manual look at units (percent as fraction, money has
a currency) are enough.

`ops.v_benchmark_issues` flags: money metric without currency, currency on a non-money metric,
percent not stored as a fraction, `period_end` before `period_start`, a band that does not
bracket the value, an unknown `stat` or `region`, duplicate active rows (same vertical, region,
metric, period, stat and source), a reused `benchmark_id`, `as_of` older than 12 months, a
benchmark vertical no client uses, an active client with no vertical, a client with more than one
open vertical, an inverted vertical window, an invalid region or non-snake-case vertical, and a
`client_id` that is not in `ref.clients`. It cannot flag an unknown `metric_id`: the app does that
on Data Health.

## Upkeep

- Benchmarks go stale. Review the table every quarter: retire rows whose source is superseded,
  add the new edition, look at the `stale_as_of` warnings.
- When a client is onboarded, add its `ref.client_verticals` row the same week (the
  `client_without_vertical` warning is the reminder).
- When a new metric becomes `benchmarkable` in the registry, add its id to the table above and to
  the two id lists in `252_ops_v_benchmark_issues.sql` if it is money or a percent.

## Deploy (order, NOT executed, needs owner OK)

1. `infra/bigquery/250_ref_industry_benchmarks.sql`
2. `infra/bigquery/251_ref_client_verticals.sql`
3. (phase 2) `infra/bigquery/252_ops_v_benchmark_issues.sql`

All three are idempotent. Run each file top to bottom in the BigQuery console, or from Cloud
Shell with `bq query --use_legacy_sql=false < <file>`. After the owner confirms the taxonomy, seed
`ref.client_verticals` with the INSERT template above.
