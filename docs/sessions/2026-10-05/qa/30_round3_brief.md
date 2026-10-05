# Round 3 fix brief

Same rules as `21_fix_brief.md` in this folder (worktree from `main`, own files only, no install, verify without login, commit, do not push, report in `../reports/<id>.md`, no em dashes). Inputs: `qa2-a.md`, `qa2-b.md`, `qa2-c.md` (round 2 results; PARTIAL and NEW items are your scope), `20_triage_plan.md` (context and original file ownership). Before editing a file, grep which round-3 package owns it below; if it is not yours, request instead.

Ownership:
- r3-analytics: `app/(app)/{snapshot,goals,growth,orders,products,unit-economics,inventory,customers,cohorts,repurchase,email,health}/**`, `components/dashboard/**` (except Funnel.tsx), `components/inventory/**`, `components/goals/**`, `lib/queries/{pnl,goals,growth,yoy,orders,products,unitEconomics,lifetime,cohorts,cohortGrid,gaps,journey,repeatTiming,health,inventory,email}.ts`, `lib/format.ts`, `lib/goals/**`, `lib/inventory/**`.
- r3-paid-creative: `app/(app)/paid/**`, `components/paid/**`, `lib/queries/{paidMeta,paidGoogle,paidGa4,paidOverview,creative}.ts`, `lib/paid/**`, `app/(app)/creative/**`, `components/creative/**`, `lib/creative/**`, `components/dashboard/Funnel.tsx`.
- r3-reports: `app/(app)/reports/**`, `components/reports/**`, `lib/reports/store.ts`, `lib/reports/templates.ts`, `app/api/reports/**`, `scripts/check-reports*.ts`.
- r3-perf: `lib/bigquery.ts`, `lib/clients.ts`, `lib/users/db.ts`, `lib/auth.ts`, `lib/authz.ts`, `app/(app)/layout.tsx`, `components/controls/**`, `components/shell/**`, `components/ui/**`, `app/globals.css`, `scripts/check-loading.ts`.
