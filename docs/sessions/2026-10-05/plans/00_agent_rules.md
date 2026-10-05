# Rules for every implementer agent (read first, follow exactly)

Owner: Matej (One Eighty). Orchestrator assigns you ONE package. Stay inside it.

## Where you work
- Your own git worktree under `/Users/matej/Documents/_One Eighty/OE Second Brain/oe-dash-wt/<your-branch>/`, on your own branch (already checked out). Base = `cleanup/2026-10`.
- Never switch branches, never touch other worktrees or `one-eighty-dashboard-repo/` (the integration checkout), never `git push`, never merge.
- Commit on your branch when done (small logical commits are fine). Every commit message ends with the line:
  the Co-Authored-By line from your own system attribution reminder (your actual model)
- Edit ONLY the files your package owns. If you need a change in a file you do not own, do not edit it: write it under "Requests to orchestrator" in your report.
- node/npm/npx/vercel live in `/Users/matej/.local/node/bin` (prepend to PATH). Frontend worktrees have `dashboard/node_modules` symlinked; do not run `npm install`/`npm ci` (it would write through the symlink). If a dependency is missing, report it.

## BigQuery (project `oneeighty-warehouse`, EU)
- Tools: ToolSearch "select:mcp__806eaa04-ee09-44e1-96f5-cc6b219356af__execute_sql_readonly,mcp__806eaa04-ee09-44e1-96f5-cc6b219356af__execute_sql,mcp__806eaa04-ee09-44e1-96f5-cc6b219356af__get_table_info,mcp__806eaa04-ee09-44e1-96f5-cc6b219356af__list_table_ids".
- Reads: anything, but always with partition filters and small scans.
- WRITES ARE ALLOWED ONLY IN DATASET `mart_qa`, and only objects prefixed with your package id (e.g. `mart_qa.wp3_stg_woo_orders`, `mart_qa.pa2_client_brand_terms`). Never CREATE/REPLACE/ALTER/INSERT/UPDATE/DELETE/MERGE in `raw`, `raw_google_ads`, `ref`, `stg`, `mart`, `ops`, `analytics_*`. Never run DTS transfers, scheduled queries, n8n executions or anything that changes prod. Prod deployment of your SQL happens later, by the orchestrator, after the owner approves.
- Always start a view change from the LIVE definition (`SELECT view_definition FROM \`oneeighty-warehouse.<dataset>\`.INFORMATION_SCHEMA.VIEWS WHERE table_name = ...`), not from repo DDL: the repo has drifted (WooCommerce branches exist only live).
- Regression protocol (for any change to an existing view): candidate in `mart_qa.<pkg>_<view>`, compare against prod with EXCEPT DISTINCT both directions on `TO_JSON_STRING(t)`, `date < CURRENT_DATE()`. Unaffected clients must be 0 rows. Affected clients: explain the diff exactly. Record the queries and results in your report.

## Migration file numbering (avoid collisions)
- Cleanup sprint: 228 to 239. Paid redesign: 240 to 249. Reporting suite: 250 to 259. Use the exact numbers your package prompt gives you.
- Each migration file starts with a header comment: purpose, live view it was based on (date), affected clients, regression result, deploy order.

## Writing style (owner's hard rules)
- Never use the em dash character (U+2014) anywhere: code, comments, UI text, SQL, docs, commit messages, reports. Use a period, comma, colon or hyphen.
- UI text: minimal. Follow the copy policy in `12_cleanup_sprint_plan.md` section 4.
- Do not invent brand facts, numbers or benchmarks.
- No secrets in files, commits or reports.

## Report
- Write `/private/tmp/claude-501/-Users-matej-Documents--One-Eighty-OE-Second-Brain/0c0e05a0-ccdc-42e6-aecc-187108a3fbca/scratchpad/reports/<package-id>.md`: what changed (files, commits), verification done with results, mart_qa objects created, what is ready for prod deploy (exact ordered statements/files), open issues, requests to orchestrator.
- Final message: 10 to 15 line summary.
