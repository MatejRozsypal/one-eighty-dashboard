# Runbook 24 — Make the Ecomail sync registry-driven

## Why

`wf_ecomail_to_bigquery` was the last recurring sync not driven by
`ref.clients`. Every other one asks the registry who to fetch for:

```sql
FROM `ref.clients` WHERE status='active' AND has_shopify=TRUE
```

Ecomail instead had `const CLIENT_ID = 'manami'` in three transform nodes and a
single shared n8n credential holding Manami's API key. So the claim that
"adding a client is one INSERT" was true for Shopify, Meta, Klaviyo, Instagram
and Facebook — and false for Ecomail.

That matters now: **Venev is configured with `email_platform = 'ecomail'`.**
Activating it would have brought in its orders and ads and silently left its
email data behind, with nothing reporting a gap.

## What changed

`infra/n8n/wf_ecomail_to_bigquery_v2_registry.json` is the rebuilt workflow,
following the same shape as `wf_klaviyo_to_bigquery`:

```
Every 6 hours
  → Read active Ecomail clients      (BQ: status='active' AND has_ecomail=TRUE)
  → Loop over clients                (splitInBatches, size 1)
  → Get api_key                      (Secret Manager: ecomail-<slug>-api-key)
  → Decode secrets                   (base64 → { client_id, slug, currency, api_key })
  → the three original branches, unchanged
  → BQ: insert lists → back to Loop over clients
```

Each `GET` now sends `key: {{ api_key }}` from the looped client instead of
using the shared credential, and `CLIENT_ID` is read from the loop.

## Prerequisite — one secret per client

The workflow reads `ecomail-<slug>-api-key`. Manami's key currently lives only
inside the n8n credential, so it has to be copied into Secret Manager first or
the v2 workflow fetches nothing.

```bash
PROJECT=oneeighty-warehouse
echo -n "<MANAMI_ECOMAIL_API_KEY>" | gcloud secrets create ecomail-manami-api-key \
  --data-file=- --project=$PROJECT
```

Repeat per client with an Ecomail account. `sa-n8n-writer` already holds Secret
Accessor at project level, so no per-secret grant is needed.

## Import and verify

**The existing workflow is untouched and still running.** The v2 is a separate,
inactive workflow, because the n8n API cannot trigger a run — nothing here has
been executed, only structurally validated (no duplicate ids, no broken
connection references, no unreachable nodes).

1. n8n → Workflows → **Import from File** → the v2 JSON. It arrives inactive.
2. Attach the Google credential to `Read active Ecomail clients`, `Get api_key`
   and the three `BQ: insert *` nodes — credentials are not carried in an
   export.
3. **Execute Workflow** manually. With one active Ecomail client it should
   behave exactly like the old one.
4. Reconcile before switching over:

```sql
SELECT client_id, COUNT(*) AS rows, MAX(ingested_at) AS last_ingest
FROM `oneeighty-warehouse.raw.raw_ecomail_campaigns`
GROUP BY client_id ORDER BY client_id;
```

Manami's row count must not drop and a second `client_id` must appear once
another client is active.

5. Only then: deactivate `wf_ecomail_to_bigquery`, activate the v2, and rename
   it to the original name.

## Rollback

Deactivate v2, reactivate the original. Nothing about the old workflow, its
credential, or the tables it writes was modified.
