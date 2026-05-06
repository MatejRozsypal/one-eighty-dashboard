# Runbook 04 — The universal n8n workflow pattern

Every source workflow (`wf_shoptet`, `wf_ecomail`, `wf_shopify`, `wf_klaviyo`, etc.) follows the same shape. Build the first one carefully; subsequent ones are copy-paste-modify.

## The shape

```
[Trigger] → [Read ref.clients] → [Loop client] → [Get secret] → [API call]
   → [Tag with client_id] → [Insert raw.<table>] → [Log to ops.pipeline_log]
        → [Error branch: log failure + email]
```

## Nodes (in order)

### 1. Trigger
- **Type:** Schedule Trigger (cron) OR Webhook
- For batch sources (Shoptet, Ecomail, Klaviyo flows): **Schedule Trigger**, every hour or once per day
- For real-time sources (Shopify, Klaviyo events): **Webhook**

### 2. Read clients registry
- **Type:** Google BigQuery → Execute Query
- **Credential:** `sa-n8n-writer-key` (Service Account JSON pulled from Secret Manager)
- **Query:**
  ```sql
  SELECT client_id, slug, currency, timezone
  FROM `oneeighty-warehouse.ref.clients`
  WHERE status = 'active' AND has_<source> = TRUE
  ```
- Output: array of client rows

### 3. Loop over clients
- **Type:** Split In Batches (batch size 1)
- This makes every downstream node fire once per client

### 4. Get secret for this client
- **Type:** Google Cloud Secret Manager (community node) → Get Secret
- **Secret name (expression):**
  ```
  =<source>-{{ $json.slug }}-<key_name>
  ```
  Example for Shoptet: `=shoptet-{{ $json.slug }}-client-secret`
- One Get Secret node per credential the API needs (e.g. Shoptet needs client_id + client_secret + shop_url → 3 nodes; Ecomail needs api_key + region → 2 nodes)

### 5. Compute watermark (the "since" date)
- **Type:** Google BigQuery → Execute Query
- **Query (parameterized by client_id):**
  ```sql
  SELECT
    COALESCE(
      MAX(<date_column>),
      DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
    ) AS since_date
  FROM `oneeighty-warehouse.raw.<table>`
  WHERE client_id = '{{ $json.client_id }}'
    AND <date_column> >= DATE_SUB(CURRENT_DATE(), INTERVAL 24 MONTH)
  ```
- The `INTERVAL 24 MONTH` floor is critical for partition-pruned cost (~free)
- Output: `since_date`

### 6. API call
- **Type:** HTTP Request
- **Auth:** generic credential set up to use the secrets fetched in step 4
- **URL/params:** include `since_date` from step 5 for incremental pulls
- Use n8n's pagination support if the API returns paged results
- Retry on failure: 3 attempts, exponential backoff (built-in n8n option)

### 7. Normalize + tag with client_id
- **Type:** Function (or Code) node
- Parses API response into rows matching the BigQuery schema
- **Adds these columns to every row:**
  - `client_id` from the loop context
  - `ingested_at` = `new Date().toISOString()`
  - `payload_json` = the original API response object stringified

### 8. Insert into raw table
- **Type:** Google BigQuery → Insert
- **Table:** `oneeighty-warehouse.raw.<table>`
- **Mode:** "Insert" (batch load — free; do NOT use streaming insert except for Meta intraday)

### 9. Log success to ops.pipeline_log
- **Type:** Google BigQuery → Execute Query
- **Query:**
  ```sql
  INSERT INTO `oneeighty-warehouse.ops.pipeline_log`
    (run_id, workflow, client_id, source, started_at, finished_at, duration_seconds, status, rows_loaded, trigger)
  VALUES (
    '{{ $execution.id }}',
    '<workflow_name>',
    '{{ $json.client_id }}',
    '<source>',
    '{{ $execution.startedAt }}',
    CURRENT_TIMESTAMP(),
    TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), TIMESTAMP('{{ $execution.startedAt }}'), SECOND),
    'success',
    {{ $items().length }},
    '<trigger_type>'
  )
  ```

### 10. Error branch
- Connect "On Error" output of every API/BigQuery node to a single error-handling subflow:
  - Log to `ops.pipeline_log` with `status='failure'` and the error message
  - Send Email node → `matej@oneeighty.cz` with run URL

## Universal rules

1. **Never** put a credential value in a workflow node directly — always reference Secret Manager
2. **Never** use streaming insert except for Meta intraday (batch load is free)
3. **Always** include `payload_json` so we can audit/debug from raw without re-pulling
4. **Always** filter `ref.clients` by `has_<source>=TRUE` (not just `status='active'`) — clients without that source must be skipped silently
5. **Always** tag with `client_id` BEFORE the insert step — easier to debug than tracing a missing tag

## Naming convention

- Workflow file: `wf_<source>.json` exported from n8n → committed to `infra/n8n/`
- Workflow name in n8n UI: `wf_<source>` (matches filename)
- Schedule: documented in the workflow's notes field (top of n8n editor)

## How to add a new client to an existing workflow

You don't change the workflow at all. Three steps:

1. Insert a row into `ref.clients` with `has_<source>=TRUE`
2. Add the client's secrets to Secret Manager (named with the client's slug)
3. Wait for the next scheduled run (or trigger manually)

That's it. The loop in step 3 of the workflow picks up the new client automatically.

## How to test a workflow

1. **Disable the schedule** (toggle off in n8n UI)
2. Click **Execute Workflow** manually
3. Step through each node's output to confirm data flows
4. Check BigQuery: `SELECT * FROM raw.<table> WHERE client_id='<slug>' AND <date_col> >= CURRENT_DATE() LIMIT 10 (FORCING THE PARTITION FILTER)`
5. Re-enable the schedule once verified
