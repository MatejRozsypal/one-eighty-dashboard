# Brief for QA round 1 fix packages (QF1 to QF8)

1. Read `../00_agent_rules.md` (hard rules), then `20_triage_plan.md` (this folder): your package section in "2. Work packages" is your spec, the findings table in "1." gives root causes. Read the QA reports `qa-a.md`, `qa-b.md`, `qa-c.md` for repro details of your findings.
2. Worktree `/Users/matej/Documents/_One Eighty/OE Second Brain/oe-dash-wt/<your-branch>/`, based on `main` (prod). `dashboard/node_modules` is symlinked: do not install. Node at `/Users/matej/.local/node/bin`. Edit only the files your package owns; requests go in your report.
3. Owner decisions applied for this round (defaults from the plan, section 3):
   - D2 hook rate: numerator `video_views` (3-second plays, actions[video_view]); video ads classified per ad over the whole period; same definition in Paid, Creative and Reports. Funnel steps above 100% render n/a.
   - D3 Snapshot spend gap: leading gap only (ratios n/a "Missing days" + one Notice "Ad spend from <date>."), interior NULL days untouched.
   - D4 Goals: attainment over targeted months only + "Target covers N of M months".
   - D5 stale products feed: UI hides Buying plan actions when the snapshot is older than 30 days + one Notice line. Ingest restart is separate.
   - D1 materialisation (QF3): build and test fully in `mart_qa` and prepare the n8n workflow INACTIVE; do NOT create prod objects or activate anything (owner OK pending).
   - Reports CM3 must equal Snapshot CM3 (QF1).
4. Verification without a login: tsc, build, relevant `npm run check:*`; BigQuery read-only via MCP (ToolSearch "select:mcp__806eaa04-ee09-44e1-96f5-cc6b219356af__execute_sql_readonly"); throwaway harness routes are allowed but must be deleted before committing.
5. Commit on your branch with the Co-Authored-By line from your own attribution reminder. Do not push or merge. Report to `../reports/<package-id>.md` (findings covered, what changed, verification results, requests). Final message max 10 lines. No em dashes anywhere.
