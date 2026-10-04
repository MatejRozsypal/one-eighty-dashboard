# Live warehouse DDL snapshot

Snapshot date: **2026-10-04** (queried 15:00 to 16:00 UTC, project `oneeighty-warehouse`, region EU).

This directory is a read-only mirror of what is actually deployed. It exists because the repo DDL had drifted from
the live warehouse: the WooCommerce branches, `ops.v_*`, `mart_customer_daily`, `mart_profit_share_monthly` and the
`ref.*` tables were live only. **Any view change starts from the file here, not from `infra/bigquery/2xx_*.sql`.**
Every new migration (228 and up) must cite the `live/` file it changes in its header.

## What is in here

| Pattern | Count | Source |
|---|---|---|
| `stg.<view>.sql` | 31 | `INFORMATION_SCHEMA.VIEWS` of dataset `stg`, wrapped in `CREATE OR REPLACE VIEW` |
| `mart.<view>.sql` | 39 | same, dataset `mart` |
| `ops.v_*.sql` | 3 | same, dataset `ops` (`v_feed_health`, `v_gads_coverage`, `v_pipeline_alerts`) |
| `ref.<table>.sql` | 14 | `INFORMATION_SCHEMA.TABLES.ddl` of every base table in `ref` |
| `ops.<table>.sql` | 5 | same, every base table in `ops` |
| `scheduled_query.refresh_feed_freshness.sql` | 1 | the hourly scheduled query that fills `ops.feed_freshness` (verbatim) |
| `scheduled_queries.md` | 1 | list of scheduled queries and DTS transfer configs |

Not covered: `raw`, `raw_google_ads`, `raw_meta_*`, `analytics_*`, `mart_qa` and other datasets, and view definitions
that reference views from those datasets are exported as they are.

## Normalisation (so that a re-export produces no diff)

1. `view_definition` is written verbatim after the line ``CREATE OR REPLACE VIEW `oneeighty-warehouse.<dataset>.<view>` AS``,
   trailing whitespace trimmed, one `;` appended, one trailing newline.
2. The em dash (U+2014) is replaced with `-` (house rule: no em dash anywhere). It occurs only in three SQL comments
   (`mart_creative_asset`, `mart_customer_lifetime` twice), so the replacement does not change behaviour.
3. Table DDL is `INFORMATION_SCHEMA.TABLES.ddl` verbatim, trailing newline only.

## Regenerate

Run from the repo root. Needs the `bq` CLI authenticated for `oneeighty-warehouse` (read-only role is enough).

```bash
cd infra/bigquery/live
bq query --project_id=oneeighty-warehouse --nouse_legacy_sql --format=json --max_rows=1000 '
SELECT table_schema, table_name, view_definition
FROM `oneeighty-warehouse`.`region-eu`.INFORMATION_SCHEMA.VIEWS
WHERE table_schema IN ("stg", "mart", "ops") ORDER BY 1, 2' > /tmp/views.json

bq query --project_id=oneeighty-warehouse --nouse_legacy_sql --format=json --max_rows=1000 '
SELECT table_schema, table_name, ddl
FROM `oneeighty-warehouse`.`region-eu`.INFORMATION_SCHEMA.TABLES
WHERE table_schema IN ("ref", "ops") AND table_type = "BASE TABLE" ORDER BY 1, 2' > /tmp/tables.json

python3 - <<'PY'
import json
for r in json.load(open("/tmp/views.json")):
    s, t, v = r["table_schema"], r["table_name"], r["view_definition"].rstrip().rstrip(";")
    body = f"CREATE OR REPLACE VIEW `oneeighty-warehouse.{s}.{t}` AS\n{v};\n"
    open(f"{s}.{t}.sql", "w").write(body.replace(chr(0x2014), "-"))
for r in json.load(open("/tmp/tables.json")):
    open(f'{r["table_schema"]}.{r["table_name"]}.sql', "w").write(r["ddl"].rstrip() + "\n")
PY
git diff --stat .   # empty = the repo matches the warehouse
```

Notes:
- A view that was dropped live leaves a stale file behind: compare `ls` against the view list.
- The scheduled query text comes from `INFORMATION_SCHEMA.JOBS_BY_PROJECT` (newest job carrying the label
  `dts_config_id=6a928d0e-0000-2e90-a9a8-f4f5e80cace4`) or from `bq show --transfer_config`, see `scheduled_queries.md`.
- The snapshot was produced without the `bq` CLI (not installed on the workstation) through the BigQuery MCP
  connector with the same two queries; the transformation above is what was applied.

## Known live oddities worth a ticket (not fixed here)

- `ref.product_costs` is documented as "RECORD ONLY" and no view reads it; WP3 adds a dormant join.
- `ref.clients.has_woocommerce` was added without a default (NULL for non-Woo clients); fixed by migration 231.
- The live `ops.v_*` views and the `ref.feed_sla*` tables had no repo DDL before this snapshot.
