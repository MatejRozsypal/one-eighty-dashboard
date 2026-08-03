# Restore `wf_klaviyo_to_bigquery` after the 2026-08-03 incident

## What happened

To avoid waiting six hours for the next scheduled run, the schedule was
temporarily changed to `*/5 * * * *`. That workflow takes longer than five
minutes, so runs overlapped and stacked until the n8n instance stopped serving
HTTP entirely. The host still answers ping and accepts TCP in ~20ms; HTTP never
returns.

This was an unforced error. The correct move was to wait for the 22:20 UTC run,
or to ask for one manual "Execute Workflow" click in the UI. Never change the
schedule of a live workflow to force a run.

## The problem with just restarting

`*/5 * * * *` is stored in n8n's database. A restart does **not** clear it — the
instance comes back and immediately starts stacking runs again.

**So after restarting, the first action must be in the UI:**

1. Open `wf_klaviyo_to_bigquery`
2. Toggle it **Inactive**

Only then is it safe to work on.

## Restoring the correct state

`RESTORE_klaviyo_live.json` is the intended workflow definition: 27 nodes, all
branches wired, `dataMode` removed from every BigQuery node, and the schedule
back to `20 */6 * * *`.

```bash
set -a; . ~/.oneeighty/n8n.env; set +a
curl -X PUT -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" \
  --data @infra/n8n/RESTORE_klaviyo_live.json \
  "$N8N_BASE_URL/api/v1/workflows/hdHdtEz8v0IPUPmE"
```

Then re-activate the workflow in the UI.

Alternatively, do it by hand: open the schedule trigger and set the cron to
`20 */6 * * *`. That alone stops the stacking; the node changes are already
saved.

## Note on the instance timezone

n8n here runs in **America/New_York**, not UTC. `20 */6 * * *` fires at
00:20/06:20/12:20/18:20 local, which is 04:20/10:20/16:20/22:20 UTC. A cron
written assuming UTC will fire four hours off.

## Backup

`backup_live_klaviyo_20260803_180247.json` is the workflow exactly as it was
before any of this — 18 nodes, missing branches, original schedule. Use it only
to get back to the pre-change state; it does not contain the fix.
