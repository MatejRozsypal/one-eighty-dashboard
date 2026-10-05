# Retention build brief (WR1 to WR5)

Spec: `03_design.md` in this folder. Owner approved the WHOLE design on 2026-10-05, including prod BigQuery deploys of the new objects and the changed views (the mart_qa-only rule is lifted for the migrations of your package, AFTER their regression passes), with these decisions:
- Manami `history_guard_days` = 180 (data starts 2024-05-06). Other clients 0.
- Manami product classification exactly as seeded in design 2.1 (5 ml and perfume bundles = full size; gift sets 249/252/412/415 = other; 153 = discovery; 409 = gift).
- "Slevovy kod - testery" orders: treat as normal paid orders for now (owner is asking the client).
- Validity and timing rules as in design 1.1, 1.3, 1.5 (same-day merge, revenue > 0, no complaints/refunds, 3-day sync lag).
- Experiment (section 5) is NOT part of this build.

MIGRATION RENUMBERING (other packages already use 255 and 256): design 255 -> **257** (`257_ref_retention.sql`), design 256 -> **258** (`258_rpt_customer_entry.sql`), design 257 -> **259** (`259_stg_customer_items_shoptet_label.sql`), design 258 -> **260** (`260_stg_shoptet_items_status.sql`). Update qa file names accordingly.

Scheduler: the owner has NOT yet created the console scheduled query `rpt_refresh_hourly`. Do not create scheduled queries. WR1 writes the final 3-line text (kpis, ad_launch, customer_entry CALLs) into its report.

General rules: `../00_agent_rules.md`, `../qa/21_fix_brief.md`.

## Update after WR1 (2026-10-05)
- `mart.rpt_customer_entry`, `mart.mart_retention_cohorts`, `ref.product_classes`, `ref.retention_settings`, `ops.v_unclassified_products` are LIVE in prod (migrations 257, 258). Read `../reports/wr1.md` for exact column names and numbers.
- Valid-order rule changed vs design 1.1: `revenue IS NULL OR revenue > 0` (old Dobias orders have no amount). Zero-revenue orders still excluded.
- `has_unmatched_line` is NOT a "missing classes" signal (846 Manami customers have an oil etc. in the first order); use `ops.v_unclassified_products`.
- Production-mode Manami reference numbers: discovery R_90 Jan to Jun 2026 = 12.1% (59 of 488), U_90 = 11.5%; discovery R_180 Oct 2025 to Mar 2026 = 9.6% (37 of 387), U_180 = 8.5%; all-customer R_365 non-early = 15.7% (111 of 709).
