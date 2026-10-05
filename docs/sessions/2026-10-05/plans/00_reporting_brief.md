# Reporting Suite: shared brief for every RS package

Read in this order before coding:
1. `00_agent_rules.md` (hard rules: own worktree, own files only, no em dash, BigQuery writes only in mart_qa with your package prefix, commit with Co-Authored-By line, report in `reports/<pkg>.md`).
2. `11_reporting_suite_design.md` (the design; your package is the WP with the same number in section 6.3).
3. `reports/rs0.md` and `dashboard/lib/reports/README.md` + `contracts.ts` + `types.ts` + `registry/types.ts` in your worktree: the contracts are BINDING. Implement against them; if a contract is wrong, do not change it silently, write it under "Requests to orchestrator" (small additive type changes in a file you own are fine).

Owner decisions (override the design's open questions):
- Access: admin AND agency roles on @oneeighty.cz; never the client role (`REPORTS_ROLES = ["admin","agency"]`).
- Display currency default CZK. Manami revenue VAT: caveat only. CM3 = mart definition (note: the mart's CM3 also subtracts fulfilment cost, see rs0 report; reproduce the mart definition exactly).
- Benchmarks: `ref.industry_benchmarks`, starts empty; region preference client market, then EU, then GLOBAL.
- Migrations: 250 `ref_industry_benchmarks`, 251 `ref_client_verticals`, 252 `ops_v_benchmark_issues`.
- No-value glyph is `n/a` (`NO_VALUE` in `lib/format.ts`), never a dash. Woo fee lines ARE netted now (migration 228 live), so drop the `woo_fees_not_netted` caveat. Woo COGS NULL on positive revenue => status `not_measured` ("No cost data"). FX rates reach 2026-10.
- Minimal UI text (copy policy in `12_cleanup_sprint_plan.md` section 4): labels and two or three word states, everything else in hover cards.

Environment:
- Worktree: `/Users/matej/Documents/_One Eighty/OE Second Brain/oe-dash-wt/<your-branch>/`. `dashboard/node_modules` is a symlink to the RS0 worktree's install (has react-grid-layout 2.2.4, recharts 2.x, zod). Do NOT run npm install/ci and do NOT edit package.json (RS0 owns deps; request changes).
- PATH: `/Users/matej/.local/node/bin`. Verification: `npx tsc --noEmit`, `npm run build`, `npm run check:reports`, `npm run check:capabilities`, `npm run check:paid` where relevant, grep gates. No dev-server login exists; skip visual checks.
- Other RS packages run in parallel in other worktrees; never edit files outside your list.
