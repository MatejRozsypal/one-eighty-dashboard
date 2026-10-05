# WP8 report: Inventory, Settings, Data Health, Admin, Auth, Chat, app shell

Branch `wp8-ops-pages`, worktree `oe-dash-wt/wp8-ops-pages`, one commit `3c8766e` on top of `376392e` (WP1 merge). Frontend only. No warehouse writes, no `mart_qa` objects, nothing to deploy to prod.

## What changed
- **Inventory** (`inventory/page.tsx`, `catalogue`, `buying`, `components/inventory/*`, `lib/inventory/model.ts`, `lib/queries/inventory.ts`):
  - Each page guards with `pageAvailability(client, "/inventory...")` and renders `NotConnected` ("Shopify not connected."). A connected client with no rows gets `NoData`. `NoStockData.tsx` deleted.
  - `TrustBar` now shows the Notice "Stock as of {date}." only when the snapshot is older than 7 days. It keeps "Cost known for X% of SKUs" and the negative-stock count. The velocity footnote is cut.
  - Footnotes cut. Bucket definitions (At risk, Overstocked, Dead) moved to InfoTips. ABCD and sell-through definitions moved to DataTable `info`. Per day and Order formulas moved to `info`. The unpriced-SKU note moved to a tooltip on Cash required.
  - Eyebrows, scope labels and "Click a heading to sort" removed. Section headings are now "Cash in stock", "Catalogue" and "Suggested order".
  - Exception evidence strings in `model.ts` cut to one short line each. `formatCover` returns `NO_VALUE`. Table placeholders use `Value`/`NoValue` instead of the em dash.
- **Settings** (`settings/page.tsx`, `actions.ts`, `components/settings/*`, `lib/goals/store.ts`, `lib/users/settings.ts`):
  - `SettingsSection.description` is now a plain string rendered as an (i) InfoTip beside the title. It is no longer a paragraph.
  - Descriptions kept as tooltips: access log, cost assumptions, Creative Engine, Goals. Dropped: Team, Add team member, People with access, Invite someone.
  - Creative field hints became per-field InfoTips. Goal metric blurbs became InfoTips on the column headers. Role notes became option `title` attributes.
  - Hex banners use `bg-notice-negative`. Input placeholders use `NO_VALUE`. Error strings shortened per the 04 tags.
  - The demo banner is a `Notice` "Demo client: read only.". The load error no longer exposes the raw error text or a schema hint.
- **Data Health** (`health/page.tsx`, `lib/queries/health.ts`):
  - P1-11: one shop row per client. The platform is Shopify, then Shoptet, then WooCommerce. `mart_daily_kpis.revenue` already includes the Woo branch, so the Woo row is judged on the latest revenue date.
  - Google Ads row: unchanged logic. It appears when the registry flag is on or Google spend exists in the data. A `woocommerce` platform dot was added.
  - `KNOWN_CAVEATS` is no longer imported or rendered. The export in `lib/metrics.ts` is untouched.
  - ClickUp card is just the badge. The page no longer prints `clickup.problem`, which names an env var and Secret Manager.
  - The freshness footnote became an InfoTip. Drift rows use the field label ("Google Ads mismatch") and drop "warehouse" and "Read-only". The pipeline-log note is cut to "Pipeline log not readable.".
- **Chat** (`lib/chat/history.ts`, `components/chat/*`): the seeded holding reply is "Coming soon.". Client-specific and Czech suggested prompts removed. Composer messages shortened. The "Kept in this browser only" footnote is cut. The empty-state heading is "Assistant".
- **Admin / Auth / shell**:
  - Admin form strings shortened.
  - Sign-in is logo, Google button and password form only, with an sr-only h1. No marketing copy. Error and change-password pages are one line each.
  - `layout.tsx` and `manifest.ts` meta descriptions removed. Auth logic is untouched.
- Em dashes removed from every owned file, comments included.

## Live ops verification (read-only BigQuery)
- Live `ops` view columns, via `INFORMATION_SCHEMA.COLUMNS`:
  - `v_feed_health`: client_id, feed_key, source, table_ref, status, severity, last_ingested_at, staleness_hours, max_staleness_hours, rows_last_24h, checked_at.
  - `v_gads_coverage`: customer_id, account_name, account_currency, client_id, has_gads, gads_currency, last_transfer_date, days_since_transfer, first_stats_date, last_stats_date, status.
  - `v_pipeline_alerts`: client_id, feed_key, severity, status, message, staleness_hours, last_ingested_at.
- `health.ts` reads none of these, because the frontend service account has no `ops` grant. It reads `mart_daily_kpis` and `mart_email_campaign_message_perf`, which is unchanged and unaffected by the WP2 `feed_sla` work.
- Latest dates per client from `mart_daily_kpis` over 60 days: ethia has shop 2026-10-04 and meta 2026-10-03, no Google. rawbark has shop 2026-10-04 and google 2026-10-03, no Meta. The new Woo row therefore renders OK for both.

## Verification
- `npx tsc --noEmit`: exit 0.
- `npm run build`: exit 0.
- Grep gates on owned files (the em dash, `border-dashed`, `bg-[#`, client-name, `toLocaleString()` and `pageEyebrow(` patterns): all 0.
- Dev-vocabulary gate: no UI strings left. Remaining hits are SQL strings (`mart_*` table names in `health.ts` and `inventory.ts`) and code comments.
- Hex in `app/layout.tsx` and `app/manifest.ts` are `themeColor` / manifest colours, not Tailwind classes. Left as is.
- Word count (scratchpad `extract.py` pointed at the worktree, owned files only, all candidate strings):
  - Before: 2,646. After: 1,429.
  - Largest drops: Settings page 523 to 258, Health page 236 to 89, Buying plan 306 to 89, Catalogue page 74 to 12.
  - These counts include tooltip text, so visible-on-page words are lower again.
- Visual check on the dev server: NOT done (cannot log in). Orchestrator to check:
  - Settings sections: the (i) inside the `<summary>` must open the tooltip without toggling the section, and the tooltip must not be clipped.
  - Rawbark, Ethia and Venev inventory URLs show "Shopify not connected.". Dobias shows "Stock as of 2026-05-19." and the three inventory pages.
  - Health has a WooCommerce row for Ethia and RawBark.

## Requests to orchestrator
1. `app/api/chat/route.ts` (not in the WP8 owner list) still returns the old `HOLDING_REPLY` ("This function is in progress. Please wait for further information from Matt. Thank you! (emoji)"). Change it to "Coming soon." to match `lib/chat/history.ts`.
2. `lib/creative/clickup.ts` (WP7) `problem` strings name `CLICKUP_API_TOKEN` and Secret Manager. Health no longer renders them, but they may show elsewhere.
3. Two small one-line states are not on the closed Notice list, so they need the lead's OK:
   - "Quantities only, not orders." on the Buying plan. It is a bordered row with the Incomplete badge and an InfoTip, not a `Notice`.
   - "Demo client: read only." on Settings. It is a `Notice`.
4. `lib/clients.ts` drift `consequence` strings are shown on Health. They mention "CM3" and "Google Ads cards", which is acceptable for an internal page. `lib/clients.ts` is not owned by WP8.
5. WP9: `KNOWN_CAVEATS` now has 0 callers on Health. Confirm there are no other callers before deleting it.
