# RS4 report: Persistence and actions (design WP4)

Branch `rs4-store`, worktree `oe-dash-wt/rs4-store`, commit `39de06e` on top of `d727748` (Merge rs0-contracts). Frontend/library only. No warehouse access, no mart_qa objects, nothing to deploy in BigQuery. Postgres tables are created lazily on first use.

## What changed

| File | Content |
|---|---|
| `dashboard/lib/reports/store.ts` | Design 4.1 DDL with its own `ensureTable()` (goals pattern, 23505/42P07/42710 treated as success, failures not cached). `withTransaction()` on `pool().connect()`. `createReportStore(deps)` implements the whole `ReportStore` contract; module-level exports bind it to the real pool. Pure helpers `isOwner`, `canView`, `canEdit`, `reportPermissions`, `clientsDetail`. Shared zod: `ReportId`, `ExpectedVersion`, `NewWidgetInput`, `LayoutItems`. |
| `dashboard/lib/reports/templates.ts` | `TEMPLATES`, `getTemplate`, `listTemplates`: Blank (no widgets), Portfolio overview (4 KPI, weekly line, revenue by client bar, table), Paid efficiency (4 KPI, 2 lines, scatter, table), Retention mix (4 KPI, line, stacked bar, ranked, table). Phase-1 ids only; every config goes through `WidgetConfig.parse` at import. |
| `dashboard/app/(app)/reports/actions.ts` | The 14 actions of design 3.3 / `ReportActions`, `"use server"`, each starting with `await assertReportsAccess()`. |
| `dashboard/scripts/check-reports-store.ts` | 283 checks against an in-memory fake of the query function. |

## Design points

- **One atomic guarded UPDATE per write.** Every versioned write starts with `UPDATE reports SET version = version + 1 ... WHERE id AND deleted_at IS NULL AND ($expected IS NULL OR version = $expected) AND (owner OR team_edit) RETURNING version`. Zero rows triggers one read (`classify`) that returns `not_found` (missing, deleted, or private and not yours: existence is not revealed), `forbidden` (visible but not allowed: "Read only" / "Owner only") or `conflict` with the current server `version`. No check-then-act gap. Delete, restore and visibility are owner-only in the SQL itself.
- **Multi-row writes** (`saveLayout`, `addWidget`, `updateWidget`, `removeWidget`, `createReport`, `duplicateReport`) run in `withTransaction`; the versioned UPDATE goes first (row lock serialises editors and the 24-widget count), and any logical failure throws an internal `TxAbort` that rolls back and is returned as the failure. `saveLayout` is a single `UPDATE ... FROM unnest(...)`; a widget id that does not belong to the report aborts the whole layout.
- **Renaming, visibility and delete take no version token** (the contract has none): they bump the version unconditionally, so an editor's older token then conflicts. Documented in the file.
- **Reads never crash:** a stored widget config failing `WidgetConfig` returns `config: null` with `rawConfig` kept (design: "Widget outdated"); stored filters failing `ReportFilters` fall back to `DEFAULT_REPORT_FILTERS` with a console warning.
- **Store unavailable** (no DATABASE_URL or DDL failure): reads return `[]`/`null`, writes throw `Error("Report store is not available.")`; actions turn that into `{ ok:false, code:"invalid", message:"Could not save" }`. The access error `"Not authorised."` is never swallowed.
- **Pin order:** pinned first, pinned ones by `pin_position` (appended on pin, kept on re-pin), then last opened, then `updated_at`. This refines the contract text (pinned, last opened, updated_at) so `pinPosition` has a meaning.
- `touchOpened` upserts `last_opened_at` and writes one `access_log` row `report:<id> clients=<all | ids | vertical:...>` via `recordAccess` (clientId null, event `view`); failures are swallowed, the gate is not.
- `createReport` accepts an optional `filters`; the action does not pass it (design 3.3 signature), so templates supply filters.
- `refreshReportData`: `revalidateTag("reports")`, one call per user per 60 s via a per-lambda Map (a brake, not a hard quota); returns `{ ok:true, version:0 }` because `ActionResult` requires a version.

## Verification (all with a temporary `assertReportsAccess` stub appended to `lib/authz.ts`, reverted before commit)

- `npx tsc --noEmit`: exit 0.
- `npm run build`: exit 0 (`scratchpad/rs4_build.log`).
- `npx tsx --tsconfig scripts/tsconfig.json scripts/check-reports-store.ts`: **283/283 passed**. Covers: permission matrix (owner, team_view, team_edit, case-insensitive email); all 15 store functions throw `"Not authorised."` and run zero statements without access; all 14 actions start with `assertReportsAccess()` (source gate) and the file has only async exports; version conflict returns `{ ok:false, code:"conflict", version: <server> }` and changes nothing; forbidden vs not_found classification; owner-only ops refused for a team_edit editor; rollback on unknown layout id, over-cap add (24), missing widget; soft delete keeps the row, hides it from get/list, restore owner-only and refused on a live report; duplicate (viewer ok, private not_found, 120-char name cap, widgets copied as new rows); pin order, per-user state, no version bump; access_log detail format; templates (valid configs, phase-1 ids only, in grid, above minimum size, no overlap, no shared filter references); no em or en dash in the four files.
- `npm run check:reports`: 207/207 (RS0 contract checks, unchanged).
- Not run: `npm run check:capabilities`, `check:paid` (untouched code).

## What this does NOT prove

The fake interprets each tagged statement the way the SQL is meant to behave; it does not execute the SQL text. The DDL and the 15 statements have not run against a real Postgres (none available, no credentials). Before relying on it, run the app once against a Neon branch DB and do create, add widget, stale save, delete, restore. Points worth a look on that first run: `unnest($2::uuid[], $3::int[] ...)` in `saveLayout`, the `CASE WHEN $3::boolean` insert in `pinReport`, and `COUNT(*)::int`.

## Dependencies on other packages

- `assertReportsAccess` is NOT in this base (`lib/authz.ts` untouched). `store.ts` and `actions.ts` import `assertReportsAccess` from `@/lib/authz` by the contract name, so **tsc and build fail on this branch alone** until RS3 lands. Verified green with a throwaway stub. Merge order: RS3 before or with RS4.
- `store.ts` also imports `recordAccess` from `lib/users/accessLog.ts` and `pool`, `sql`, `userStoreConfigured` from `lib/users/db.ts` (existing, unchanged).

## Requests to orchestrator

1. Merge RS3 (`assertReportsAccess`) with or before RS4; otherwise the integrated build breaks.
2. RS0 owns `package.json`: add `"check:reports-store": "tsx --tsconfig scripts/tsconfig.json scripts/check-reports-store.ts"`.
3. RS3: each write runs `assertReportsAccess()` twice (action plus store), each a `getServerSession` plus a Postgres user lookup (pool max 3). If autosave latency shows it, memoise inside `assertReportsAccess` per request (React `cache()`), as design 3.1 suggests.
4. WP9: `StoreResult` conflict carries `version`; the page should reload the server copy and show "Updated by <updatedBy>, reloaded". Template picker should use `listTemplates()` from `lib/reports/templates.ts` (pure, browser-safe, imports only contracts, limits, types). Deleted reports are restorable by id but there is no "list deleted" function (not in the contract); add one if the UI needs a Trash view.
5. Add a real-Postgres smoke test to the QA checklist (see "What this does NOT prove").
