# Runbook 05 — Ecomail n8n Workflow → BigQuery (Manami)

Click-by-click for converting your existing **Ecomail → Google Sheets** workflow into
**Ecomail → BigQuery**. Full spec lives in [`infra/n8n/wf_ecomail.md`](../infra/n8n/wf_ecomail.md).

---

## Prereqs

- [x] `ref.clients` has `manami` row with `has_ecomail=TRUE`.
- [x] Secret Manager has `ecomail-manami-api-key`, `ecomail-manami-region`.
- [x] `Ecomail` HTTP Header Auth credential exists in n8n (key: api-key value).
- [x] `BQ Service Account` credential exists in n8n, wired to `sa-n8n-writer-key`.
- [ ] BQ tables match the new DDL (next step does this).

---

## Step 1 — Reset the BQ schema (one-time)

The original DDL used wrong field names (`recipients`, `delivered`, `unique_opens`, …)
that don't match Ecomail's actual API response. Tables are empty so we drop+recreate.

In BigQuery Console:

1. Run the empty-check inside `infra/bigquery/005a_drop_raw_ecomail.sql` first — every count must be 0.
2. Run `infra/bigquery/005a_drop_raw_ecomail.sql` (the DROP statements).
3. Run `infra/bigquery/005_create_raw_ecomail.sql` to recreate with correct schema.
4. Sanity check:
   ```sql
   SELECT table_name FROM `oneeighty-warehouse.raw.INFORMATION_SCHEMA.TABLES`
   WHERE table_name LIKE 'raw_ecomail_%';
   ```
   Expect three rows: `raw_ecomail_campaigns`, `raw_ecomail_automations`, `raw_ecomail_lists`.

⚠️ The new lists table is named `raw_ecomail_lists` (was `raw_ecomail_subscribers`).

---

## Step 2 — Clone & clean the n8n workflow

In n8n:

- [ ] Open `Ecomail → Google Sheets (Automations)` → menu → **Duplicate**.
- [ ] Rename the duplicate to `wf_ecomail_to_bigquery`. Make sure the **toggle is OFF** (inactive).
- [ ] Delete these dead/orphaned nodes from the duplicate:
  - `Transform lists` (terminates in `[]`, never fires)
  - `GET lists1` (orphaned dev artifact)
- [ ] Re-wire the lists branch:
  - Add a wire **`Every 6 hours` → `GET lists`**.
  - Add a wire **`GET lists` → `Extract list IDs`**.
  - Delete the **`GET lists2`** node (now redundant — `GET lists` feeds the chain directly).

After this, the cron should fan out to three branches: campaigns, pipelines, lists.

---

## Step 3 — Replace transform code (4 nodes)

For each of the four nodes below, open it in n8n and paste the new code from
[`infra/n8n/wf_ecomail.md`](../infra/n8n/wf_ecomail.md):

- [ ] `Transform campaigns` → "Transform campaigns" block
- [ ] `Transform pipeline stats` → "Transform pipeline stats" block
- [ ] `Merge pipeline info + stats` → "Merge pipeline info + stats" block
- [ ] `Transform snapshots` → "Transform snapshots (lists)" block

All four now inject `client_id='manami'`, `ingested_at` (now ISO), and `payload_json` (full original response).

---

## Step 4 — Swap Sheets nodes for BigQuery nodes

For each of the three `Sheets: upsert ...` nodes, **delete it** and add a new
**Google BigQuery → Insert** node in the same place.

Settings (same for all three):

- **Credential:** `BQ Service Account`
- **Project:** `oneeighty-warehouse`
- **Dataset:** `raw`
- **Mode:** **Map Automatically** ← critical
- **Append**, batch load (NOT streaming)

| Replace this Sheets node | With BigQuery Insert into |
|---|---|
| `Sheets: upsert campaigns`   | `raw.raw_ecomail_campaigns`   |
| `Sheets: upsert automations` | `raw.raw_ecomail_automations` |
| `Sheets: upsert lists`       | `raw.raw_ecomail_lists`       |

The Filter node before `Sheets: upsert automations` stays — keep it.

---

## Step 5 — First run (backfill)

- [ ] Save the workflow.
- [ ] Click **Execute Workflow** (NOT activate yet). Watch each branch turn green.
- [ ] Verify in BigQuery:
  ```sql
  SELECT 'campaigns' AS t, COUNT(*) AS rows, COUNT(DISTINCT campaign_id) AS ids
  FROM `oneeighty-warehouse.raw.raw_ecomail_campaigns`
  WHERE DATE(sent_at) BETWEEN '2023-01-01' AND CURRENT_DATE()
  UNION ALL
  SELECT 'automations', COUNT(*), COUNT(DISTINCT pipeline_id)
  FROM `oneeighty-warehouse.raw.raw_ecomail_automations`
  WHERE snapshot_date = CURRENT_DATE()
  UNION ALL
  SELECT 'lists', COUNT(*), COUNT(DISTINCT list_id)
  FROM `oneeighty-warehouse.raw.raw_ecomail_lists`
  WHERE snapshot_date = CURRENT_DATE();
  ```
  All three rows should have `rows >= 1`. Paste the output back to me.
- [ ] Pick a recent campaign in Ecomail UI, grab its ID from URL, run the validation query in `wf_ecomail.md` "Validation against Ecomail UI".
- [ ] **Activate** the workflow.

---

## Step 6 — Tell me the row counts

After the first run, paste the result of the SQL in Step 5 here. I'll diff against
your Looker email numbers and confirm parity, then we move to Meta.

---

## Gotchas

- `require_partition_filter=TRUE` on all three tables — every query needs a `WHERE` on the partition column or BQ rejects it.
- Pipeline stats endpoint is `/pipelines/{id}/stats` (NOT `/all-stats` — that 404s).
- `sent_at` arrives as a 14-digit `YYYYMMDDHHMMSS` string. The transform parses it.
- `/campaigns/all-stats/` returns `{stats: {<id>: {...}}}` — an object keyed by ID, not an array.
- Auto-map mode on BQ Insert nodes — manual mapping was the Shoptet failure mode.
- Currency is per-list, not per-campaign. We currently hardcode `'CZK'` in the campaigns transform — fine while Manami has only one Ecomail list, revisit if she adds another.
