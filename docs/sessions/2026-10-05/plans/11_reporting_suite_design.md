# Reporting Suite: implementation design

Target: One Eighty dashboard (`dashboard/`, Next.js 14.2 App Router, React 18.3, BigQuery marts, Neon Postgres, Vercel). Branch inspected: `cleanup/2026-10`.

---

## 0. Repo facts that shape this design

These are things I checked in the code that either limit the design or let it reuse what already exists.

1. **The access gate already exists and can be extended.** `lib/authz.ts` has `currentAccess()`, `isInternal()`, `requireInternalRole()` and `requireAdminRole()`. The role is re-read from Postgres on every JWT refresh (`lib/auth.ts:149-157`), so revoking someone takes effect immediately. `app/(app)/creative/layout.tsx` is a working example of a layout-level gate. There is no `middleware.ts`, on purpose (RB22), and this design adds none.
2. **`resolveClient()` assumes one client per page** (`lib/clients.ts:175`). Reports work across several clients, so they need their own client list and their own gate. Reports must never call `resolveClient`.
3. **`ClientCapabilities` has no WooCommerce flag** (`lib/clients.ts:31-40`). `has_woocommerce` is NULL rather than FALSE for non-Woo clients. Reports therefore read `ref.clients` themselves, treat NULL as FALSE, and derive a combined `shop` capability.
4. **`lib/bigquery.ts` `query()` only accepts scalar params** (`Record<string, string|number|boolean|Date>`). It has no array params, no `maximumBytesBilled`, no labels and no timeout. A new exported function adds these. The existing signature stays as it is.
5. **Nothing uses Recharts today.** It is in `package.json` at 2.15.4 (npm flags it as deprecated), but no file imports it. Every current chart is hand-written SVG (`components/ui/Sparkline.tsx` explains why). So Recharts is new weight for whichever route uses it. That is fine for a builder route that is client-heavy anyway, as long as it is code-split.
6. **The marts are views, not partitioned tables.** `mart_daily_kpis` (`infra/bigquery/213_client_ad_currency.sql:79`) holds shop, Meta, Google and `paid_spend` per `(client_id, date, currency)`. Ad spend is already converted into the client's currency there. The stg views remove duplicates with `ROW_NUMBER() OVER (PARTITION BY client_id, order_id ...)`, which limits how far a date filter can prune. The audit shows Woo clients have live rows in `mart_daily_kpis`, but the repo DDL has no Woo branch, so the live views and the repo have drifted.
7. **Data-quality facts the layer must show, not hide.** Specifically:
   - RawBark: COGS 0% (the mart forces it to 0), no Meta, so MER and CM3 are wrong.
   - Manami: revenue includes VAT.
   - Woo clients: revenue is overstated because the negative fee lines are not netted.
   - `ref.fx_rates` ends 2026-09-01 for every pair.
   - Google `purchase_value` counts all conversion actions, not only purchases.
8. **Postgres pattern.** Each feature creates its tables lazily with its own DDL and `ensureTable()` (`lib/goals/store.ts:86-117`). It is kept out of the shared `ensureSchema` so a DDL mistake cannot lock everyone out at sign-in.
9. **Tenancy doc rule.** "No data API routes (only `/api/auth/*`)" (TENANCY section 4). This design adds one internal-only read route and justifies the exception in section 3.2.
10. **Next 14 server actions run one at a time per client.** That rules them out for loading many widgets in parallel. They are still right for writes.

---

## 1. UX spec

### 1.1 Principles
- **Minimal UI text.** Labels are metric names exactly as the warehouse names them (`MER`, `aMER`, `CAC`, `CM3`). States are two or three words: "Not connected", "No data", "No cost data", "No FX Oct 2026". All detail goes into hover cards.
- **The URL is the state** (existing decision). Report-level filter overrides live in the query string, so a link reproduces exactly what the sender saw without saving anything.
- **Instant first.** Layout and display-only changes never touch the network. Data changes show the previous figures pulsing (the existing `PendingRegion` pattern) and never a blank spinner.
- **No data is not zero.** Every gap renders as an em-dash glyph or a broken line, with its reason on hover.

### 1.2 Entry point and gate
- A fourth icon on the product rail, "Reports" (`/reports`). It is only shown to accounts that pass `canUseReports()` (admin role plus an @oneeighty.cz email; see open question 1).
- The analytics sidebar is hidden on `/reports` (the same way Creative hides it). The reports layout draws its own left list panel.
- The client switcher in `AccountMenu` is hidden on `/reports`, because client selection belongs to each report.

### 1.3 Report list (`/reports`)
```
+------+--------------------------------------------------------------------------+
| rail |  Reports                                             [ + New report ]    |
|  o   |  [ Search...            ]   ( Mine ) ( Team ) ( Templates )              |
|  o   |--------------------------------------------------------------------------|
|  *   |  [pin] Portfolio weekly       Team:edit   MR   12 widgets    2h   [...]  |
|      |  [pin] Paid efficiency        Private     MR    6 widgets    1d   [...]  |
|      |        Pet vertical vs bench  Team:view   JK    8 widgets    3d   [...]  |
|      |        Retention mix          Team:edit   MR    5 widgets    9d   [...]  |
+------+--------------------------------------------------------------------------+
  [...] = Open, Duplicate, Rename, Pin, Visibility, Delete (soft)
```
- **New report** opens a small picker: Blank, Portfolio overview, Paid efficiency, Retention mix. Templates live in code (`lib/reports/templates.ts`).
- **Team** tab shows reports whose visibility is not private. **Templates** tab is read-only; opening one duplicates it into Mine.
- Rows are sorted by pinned first, then last opened by the viewer, then `updated_at`.

### 1.4 Builder canvas (`/reports/[id]`), desktop, edit mode
```
+------+----------------------------------------------------------------------------------+
| rail | [Portfolio weekly  v] *          (View|Edit)   [Share]   [Refresh]   [...]       |
|      | [5 clients v] [Last 90 days v] [vs Prev year v] [CZK v] [Industry (o)]   * dirty |
|      |----------------------------------------------------------------------------------|
|      | +-- :: Revenue ----+ +-- :: MER --------+ +-- :: CAC --------+ +-- :: CM3 % ----+ |
|      | | 4.21M CZK        | | 3.42x            | | 612 CZK          | | 31.0%          | |
|      | | +12.4%  vs PY    | | -0.31x    I 3.1x | | +8.0%            | | -2.1 pp        | |
|      | +-----------------/+ +-----------------/+ +-----------------/+ +---------------/+ |
|      | +-- :: MER by client, weekly -----------+ +-- :: Spend vs MER ------------------+ |
|      | | 4x |      _/\_  manami                | | MER                                 | |
|      | | 3x |- - - - - - - - - - Industry      | |  |   o dobias                       | |
|      | | 2x | ___/  dobias                     | |  |- - - -+- - - Industry            | |
|      | |    +--------------------------- wk    | |  |  o manami      o rawbark^        | |
|      | | rawbark^  ethia: Meta only            | |  +---------------------- Spend      | |
|      | +--------------------------------------/+ +-----------------------------------/+ |
|      | +-- :: Clients ------------------------------------------------------------------+ |
|      | | Client    Revenue     MER    CAC     CM3 %   Meta ROAS   Google ROAS          | |
|      | | dobias    $412k       21.4x  $38     74.2%   4.1x        Not connected        | |
|      | | manami    1.1M CZK^   2.9x   710     36.8%^  2.2x        5.8x^                | |
|      | | rawbark   1.8M CZK    21.3x^ 612     No cost 0 Not conn. 9.7x^               | |
|      | +-------------------------------------------------------------------------------/+ |
|      |                          [ + ]   press /                                           |
+------+----------------------------------------------------------------------------------+
  ::  drag handle (header only)     /  resize corner     ^  caveat marker (hover)
  I   Industry benchmark (hover card)
```
- **View mode** (the default when opening someone else's report): no handles and no `+`. Clicking a widget title opens its config read-only.
- **Edit mode** shows a dotted 12-column grid behind the widgets, drag handles in widget headers, and resize handles bottom-right, right and bottom. `+` adds a widget at the first free slot. Pressing `/` anywhere opens the widget picker.
- **Widget header menu:** Edit, Duplicate, Use report filters on/off, Download CSV (phase 2), Remove.
- **Widget-level overrides** show as a small chip in the header (for example "12m" or "EUR") so a widget that differs from the report filters is visible at a glance.

### 1.5 Widget picker (popover at the `+` or `/`)
```
+---------------------------------------------+
| [#] KPI   [~] Line   [||] Bar               |
| [=] Table [1.] Ranked [.:] Scatter          |
+---------------------------------------------+
```
Six icons, each labelled with one word. Arrow keys move, Enter picks. Picking a type inserts a widget with its default size and opens the config drawer with the metric picker focused.

### 1.6 Config drawer (right side, 360px; a bottom sheet on mobile)
```
+-- Widget ------------------------------- x -+
| Type     [KPI][Line][Bar][Table][Rank][Sc]  |
| Metrics  [MER x] [CAC x] [+]                |
| Split    (By client)(Combined)(By vertical) |
| Grain    (Day)(Week)(Month)(Total)          |
| Filters  [x] Use report filters             |
|          [clients] [period] [compare] [ccy] |
| Industry [x]                                |
| Title    [auto: MER, CAC]                   |
+---------------------------------------------+
```
- The fields shown depend on the type:
  - Scatter: shows X, Y and optional Size slots instead of Metrics.
  - KPI: hides Grain (it is always total plus a sparkline at week grain).
  - Ranked: takes one metric plus Sort (desc/asc) and Limit.
- Display-only fields (title, sort, limit, stacked) never trigger a refetch.

### 1.7 Metric picker (combobox inside the drawer)
```
+-- [ Search metrics...  roas        ] ------+
| ACQUISITION                                |
|   MER              x   I                   |
| META                                       |
|   Meta ROAS        x   I                   |
| GOOGLE                                     |
|   Google ROAS      x   I   2 of 5 clients  |
+--------------------------------------------+
  x / $ / % / #   unit glyph       I   benchmark available
  "2 of 5 clients"  capability coverage for the selected clients (greyed when 0 of N)
```
- Groups appear in this order: Profitability, Acquisition, Retention, Meta, Google, Email (phase 2).
- Search matches label, id and aliases. For example "roas" finds Meta ROAS, Google ROAS and MER; "margin" finds CM1 % and CM3 %.
- Keyboard: type to filter, Up/Down to move, Enter to toggle, Backspace on an empty search removes the last chip, Esc to close.
- Hovering a row shows the full definition from the registry and `METRIC_DEFINITIONS`.
- A metric no selected client can compute stays visible but greyed, with a hover reason ("No selected client has Google Ads").

### 1.8 Client multi-select
```
+-- Clients --------------------------------+
| ( All active )  ( By vertical v )         |
| [x] dobias     USD  * shopify * meta      |
| [x] ethia      CZK  * woo * meta          |
| [x] manami     CZK  * shoptet * meta * g  |
| [x] rawbark    CZK  * woo * g             |
| [ ] venev      EUR  * shopify * meta      |
+-------------------------------------------+
```
- **"All active"** is stored as `{ mode: "all" }`, so future clients appear in saved reports automatically.
- **"By vertical"** is stored as `{ mode: "vertical", verticals: [...] }` and resolved through `ref.client_verticals`.
- The demo client is excluded. Platform dots reuse `PlatformBadge` colours. In the filter bar the chip reads "5 clients" or the single client's name.

### 1.9 Period, compare, currency, benchmark
- **Period:** reuse `components/controls/DateRangeControl.tsx` with the same presets (7d, 28d, 30d, 90d, mtd, ytd, 12m, all, custom). Ranges end yesterday.
- **Compare:** reuse `SegmentedControl` with Prev period / Prev year / None. The resolved comparison dates appear on hover.
- **Currency:** `CZK | EUR | USD | Native`. Native is only enabled when every selected client trades in the same currency; otherwise it is disabled with the hover "Mixed currencies". The default is CZK.
- **Industry:** a switch. When on, every widget whose metrics are benchmarkable draws the benchmark:
  - KPI: an "I 3.1x" line under the value.
  - Line: a dashed horizontal line (stepped if periods change).
  - Bar and ranked: a vertical marker.
  - Scatter: a dashed crosshair.
  - Table: an "Industry" row per vertical.
- Benchmark hover card:
```
+-----------------------------------+
| Industry median        3.1x       |
| pet_food, EU, 2025-07 to 2025-12  |
| Source: <source name>  [link]     |
| As of 2026-09-15                  |
| Revenue ex VAT; blended paid      |
+-----------------------------------+
```

### 1.10 Saved views (switching) and sharing
- **Switching.** The report title is a dropdown: pinned reports, recent reports, then "All reports". `Cmd/Ctrl+K` opens the same list as a command palette, and switching keeps the current URL filter overrides only when they apply. Each report is a named view (widgets, layout and default filters).
- **Saving.**
  - Layout and widget config autosave for editors (800ms debounce, optimistic version check).
  - Report-level filter changes only change the URL until "Save as default" (the dirty dot plus a `Cmd/Ctrl+S` shortcut).
  - "Save as new" duplicates the report.
- **Sharing.** Visibility is Private, Team can view, or Team can edit. "Copy link" copies the current URL including filter overrides. "Team" means everyone who passes the reports gate. Viewers can Duplicate.
- **Concurrency.** Optimistic versioning. If a save hits a version conflict, the client reloads the server copy and shows "Updated by JK, reloaded".

### 1.11 Keyboard map (shown with `?`)
| Key | Action |
|---|---|
| `/` or `N` | Add widget |
| `E` | Toggle edit mode |
| `Cmd/Ctrl+K` | Switch report |
| `Tab` / `Shift+Tab` | Move focus between widgets (reading order: y, then x) |
| Arrows (edit mode, widget focused) | Move one grid cell |
| `Shift+Arrows` | Resize one cell |
| `Enter` | Open widget config |
| `Cmd/Ctrl+D` | Duplicate widget |
| `Delete` / `Backspace` | Remove widget (with an Undo toast) |
| `Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z` | Undo / redo for layout and config, 50-step client history |
| `Cmd/Ctrl+S` | Save filters as report default |
| `Esc` | Close drawer or popover |

Moves and resizes are announced through an `aria-live` region ("MER moved to column 7, row 4"). Focus rings use `--focus-ring`.

### 1.12 Mobile and tablet
- **Below 768px:** read-only stack ordered by (y, x). KPI tiles go 2-up, every other widget is full width with a height set by type. The filter bar collapses into one chip ("5 clients, 90d, vs PY, CZK") that opens a bottom sheet. In edit mode the only actions are reorder (Move up/down in the widget menu) and the config bottom sheet; there is no drag. Charts keep their tooltips on tap.
- **768 to 1199px:** 6-column grid, generated by the grid library from the 12-column layout. Display only. Editing is disabled below 1200px in the MVP, so only one layout is persisted.
- **1200px and up:** 12 columns, full editing.

```
Mobile 375px
+-------------------------------+
| Portfolio weekly v            |
| [5 clients, 90d, vs PY, CZK]  |
+---------------+---------------+
| Revenue       | MER           |
| 4.21M CZK     | 3.42x         |
| +12.4%        | -0.31x  I3.1x |
+---------------+---------------+
| MER by client, weekly         |
|  (line chart, full width)     |
+-------------------------------+
| Clients (table, h-scroll)     |
+-------------------------------+
```

### 1.13 Grid and widget defaults
The grid is 12 columns, `rowHeight` 40px, 16px gutters, vertical compaction, and drag from the header handle only (so chart tooltips and table scrolling are unaffected).

| Type | Default w x h | Min w x h | Data |
|---|---|---|---|
| KPI | 3 x 3 | 2 x 3 | total + compare + week sparkline |
| Line | 6 x 7 | 4 x 5 | grain series, compare as thin dashed |
| Bar | 6 x 7 | 4 x 5 | grain or total per client, optional stacked |
| Table | 12 x 8 | 6 x 5 | rows clients (or buckets), cols metrics, deltas |
| Ranked | 4 x 7 | 3 x 5 | one metric, clients sorted, bars scaled to data range |
| Scatter | 6 x 8 | 4 x 6 | one point per client, X, Y, optional size |

**Series colours.** Add `--series-1` to `--series-6` and `--benchmark` to `styles/tokens/colors.css`. All are aliases of existing tokens:

| Token | Alias |
|---|---|
| `--series-1` | ink-900 |
| `--series-2` | growth-600 |
| `--series-3` | info |
| `--series-4` | warning-700 |
| `--series-5` | gray-400 |
| `--series-6` | growth-300 |
| `--benchmark` | gray-300, dashed |

A client keeps the same colour slot across every widget (its index in the alphabetical client list, mod 6). Beyond six series, dash patterns are added. Lines carry direct end-labels, so the legend is optional.

---

## 2. Semantic layer: metric registry and query compilation

### 2.1 Files
- **Pure files**, safe for the browser bundle because the pickers need them. They have no `server-only` imports and no project id:
  - `lib/reports/registry/types.ts`
  - `lib/reports/registry/components.ts`
  - `lib/reports/registry/metrics.ts`
  - `lib/reports/registry/caveats.ts`
  - `lib/reports/registry/capabilities.ts`
- **Server-only files:** `lib/reports/compile.ts`, `run.ts`, `evaluate.ts`, `resolve.ts`, `benchmarks.ts`, `clients.ts`.
- **`SEMANTIC_VERSION`** (an integer in `registry/types.ts`) is part of every cache key. Bump it whenever a formula changes.
- **Metric ids are a permanent contract.** `ref.industry_benchmarks.metric_id` and saved widget configs both refer to them. A rename means adding the new id and keeping the old one in `aliases` with `deprecated: true`.

### 2.2 Type definitions
```ts
// lib/reports/registry/types.ts
export const SEMANTIC_VERSION = 1;

export type MartId = "kpis" | "meta_campaign" | "email_campaign";
export type Grain = "day" | "week" | "month";
export type QueryGrain = Grain | "total";
export type Unit = "money" | "count" | "ratio" | "percent";
export type GoodWhen = "up" | "down" | "neutral";
export type MetricGroup = "profitability" | "acquisition" | "retention" | "meta" | "google" | "email";

/** Registry flags (has_*), plus two derived ones. */
export type Capability =
  | "shopify" | "shoptet" | "woocommerce" | "meta" | "googleAds"
  | "klaviyo" | "ecomail" | "ga4"
  | "shop"    // shopify || shoptet || woocommerce
  | "email";  // klaviyo || ecomail
export type CapExpr = Capability | { all: CapExpr[] } | { any: CapExpr[] };

export interface MartDef {
  id: MartId;
  /** dataset.table. PROJECT_ID is prefixed server-side in compile.ts only. */
  table: string;
  /** Always filtered with BETWEEN; the partition proxy. */
  dateColumn: string;
  /** Row currency column used for FX; null = no money columns. */
  currencyColumn: string | null;
  grains: Grain[];
  phase: 1 | 2;
}

export type ComponentId = `${MartId}.${string}`;

export interface ComponentDef {
  id: ComponentId;
  mart: MartId;
  /** Physical column. Must match /^[a-z_][a-z0-9_]*$/ (checked at module load). */
  column: string;
  /** Money components are emitted twice: __nat (client currency) and __disp (display currency). */
  money: boolean;
  requires: CapExpr;
  /** A summed 0 is "not measured" when this guard component is > 0 (COGS on positive revenue). */
  zeroIsMissingWhen?: ComponentId;
}

export interface Term {
  c: ComponentId;
  sign: 1 | -1;
  /** "gap": a null term nulls the metric. "zero": a null term counts as 0 (paid_spend inside CM3). */
  nullAs: "gap" | "zero";
}

export interface FormatSpec {
  style: "money" | "number" | "percent" | "ratio";
  decimals: number;
  /** Used when |value| < 10 (CPC, CPM in USD). Fixes the 0-decimal unit-cost bug for reports. */
  smallDecimals?: number;
  compact?: boolean;
}

export type CaveatId =
  | "revenue_incl_vat" | "returns_not_netted" | "woo_fees_not_netted"
  | "google_only_paid" | "google_all_conversions" | "platform_attributed"
  | "new_flag_window" | "period_share_not_rcr";

interface MetricBase {
  id: MetricId;
  label: string;
  group: MetricGroup;
  /** One line, shown on hover in the picker. */
  description: string;
  /** Key into lib/metrics.ts METRIC_DEFINITIONS, when one exists. */
  definitionKey?: string;
  unit: Unit;
  format: FormatSpec;
  goodWhen: GoodWhen;
  grains: Grain[];
  /** Extra requirement on top of the components' own. */
  requires?: CapExpr;
  benchmarkable: boolean;
  aliases?: string[];
  caveats?: CaveatId[];
  /** Low-volume marker for ranked lists and tables (DB2 rule). */
  minVolume?: { c: ComponentId; shareOfMax: number };
  phase: 1 | 2;
  deprecated?: boolean;
}

/** Signed sum of components: revenue, CM3 = revenue - cogs - paid_spend. */
export interface SumMetric extends MetricBase { kind: "sum"; terms: Term[] }

/** Always recomputed from summed components, never averaged. */
export interface RatioMetric extends MetricBase {
  kind: "ratio";
  numerator: Term[];
  denominator: Term[];
  /** 1000 for CPM. */
  scale?: number;
}

export type MetricDef = SumMetric | RatioMetric;

/** Derived at load time, never hand-written. */
export interface CompiledMetricMeta {
  components: ComponentId[];
  /** "display" when unit is money; otherwise "native" for per-client series and "display" for combined rollups. */
  fxMode: "display" | "native-per-client";
  requires: CapExpr; // components' requirements AND metric.requires
}
```

### 2.3 Component registry (phase 1 reads `mart_daily_kpis` only)
```ts
// lib/reports/registry/components.ts
export const MARTS = {
  kpis:           { id: "kpis", table: "mart.mart_daily_kpis", dateColumn: "date", currencyColumn: "currency", grains: ["day","week","month"], phase: 1 },
  meta_campaign:  { id: "meta_campaign", table: "mart.mart_meta_campaign_perf", dateColumn: "date", currencyColumn: "currency", grains: ["day","week","month"], phase: 2 },
  email_campaign: { id: "email_campaign", table: "mart.mart_email_campaign_perf", dateColumn: "send_date", currencyColumn: "currency", grains: ["week","month"], phase: 2 },
} as const satisfies Record<MartId, MartDef>;

const PAID: CapExpr = { any: ["meta", "googleAds"] };

// defineComponents() splits "mart.column", validates the identifier regex, and freezes the result.
export const COMPONENTS = defineComponents({
  "kpis.revenue":                      { money: true,  requires: "shop" },
  "kpis.net_sales":                    { money: true,  requires: "shop" },
  "kpis.new_customer_revenue":         { money: true,  requires: "shop" },
  "kpis.returning_customer_revenue":   { money: true,  requires: "shop" },
  "kpis.new_customer_net_sales":       { money: true,  requires: "shop" },
  "kpis.returning_customer_net_sales": { money: true,  requires: "shop" },
  "kpis.cogs":                         { money: true,  requires: "shop", zeroIsMissingWhen: "kpis.revenue" },
  "kpis.orders":                       { money: false, requires: "shop" },
  "kpis.new_customer_orders":          { money: false, requires: "shop" },
  "kpis.returning_customer_orders":    { money: false, requires: "shop" },
  "kpis.paid_spend":                   { money: true,  requires: PAID },
  "kpis.meta_spend":                   { money: true,  requires: "meta" },
  "kpis.meta_revenue":                 { money: true,  requires: "meta" },
  "kpis.meta_purchases":               { money: false, requires: "meta" },
  "kpis.meta_impressions":             { money: false, requires: "meta" },
  "kpis.meta_clicks":                  { money: false, requires: "meta" },
  "kpis.google_spend":                 { money: true,  requires: "googleAds" },
  "kpis.google_revenue":               { money: true,  requires: "googleAds" },
  "kpis.google_purchases":             { money: false, requires: "googleAds" },
  "kpis.google_impressions":           { money: false, requires: "googleAds" },
  "kpis.google_clicks":                { money: false, requires: "googleAds" },
  // phase 2
  "meta_campaign.link_clicks":         { money: false, requires: "meta" },
  "meta_campaign.add_to_cart":         { money: false, requires: "meta" },
  "email_campaign.sent":               { money: false, requires: "email" },
  "email_campaign.delivered":          { money: false, requires: "email" },
  "email_campaign.unique_opens":       { money: false, requires: "email" },
  "email_campaign.unique_clicks":      { money: false, requires: "email" },
  "email_campaign.revenue":            { money: true,  requires: "email" },
});
```
Columns that are deliberately left out:
- `unique_customers`: summing it across days does not give unique customers.
- `frequency_per_day` and the other `*_per_day` fields: they are already divided and cannot be re-aggregated.
- mart `cm1`, `cm2`, `cm3`: CM3 is rebuilt from components so the COGS guard applies.
- `mart_email_flow_perf`: it is a cumulative snapshot and is not safe over a period.

### 2.4 Initial metrics (30 in phase 1, 5 in phase 2)
```ts
// lib/reports/registry/metrics.ts
const t = (c: ComponentId, sign: 1 | -1 = 1, nullAs: "gap" | "zero" = "gap"): Term => ({ c, sign, nullAs });
const F = {
  money:    { style: "money", decimals: 0, compact: true },
  unitCost: { style: "money", decimals: 0, smallDecimals: 2 },
  x:        { style: "ratio", decimals: 2 },
  pct:      { style: "percent", decimals: 1 },
  pct2:     { style: "percent", decimals: 2 },
  n:        { style: "number", decimals: 0, compact: true },
} as const;
const MONEY_UP = { unit: "money", format: F.money, goodWhen: "up" } as const;
const COST     = { unit: "money", format: F.unitCost, goodWhen: "down" } as const;
const X_UP     = { unit: "ratio", format: F.x, goodWhen: "up" } as const;
const PCT_UP   = { unit: "percent", format: F.pct, goodWhen: "up" } as const;
const PCT_N    = { unit: "percent", format: F.pct, goodWhen: "neutral" } as const;
const COUNT_UP = { unit: "count", format: F.n, goodWhen: "up" } as const;
const SHOP_CAV: CaveatId[] = ["revenue_incl_vat", "returns_not_netted", "woo_fees_not_netted"];
const PAID_CAV: CaveatId[] = [...SHOP_CAV, "google_only_paid"];

// defineMetrics() fills id, grains (default all three), phase (default 1), and derives CompiledMetricMeta.
export const METRICS = defineMetrics({
  // Profitability
  revenue:     sum("Revenue", "profitability", [t("kpis.revenue")], { ...MONEY_UP, benchmarkable: false, caveats: SHOP_CAV, definitionKey: "Revenue" }),
  net_sales:   sum("Net sales", "profitability", [t("kpis.net_sales")], { ...MONEY_UP, benchmarkable: false, caveats: SHOP_CAV }),
  orders:      sum("Orders", "profitability", [t("kpis.orders")], { ...COUNT_UP, benchmarkable: false }),
  aov:         ratio("AOV", "profitability", [t("kpis.net_sales")], [t("kpis.orders")], { ...MONEY_UP, format: F.unitCost, benchmarkable: true, caveats: SHOP_CAV }),
  cogs:        sum("COGS", "profitability", [t("kpis.cogs")], { unit: "money", format: F.money, goodWhen: "down", benchmarkable: false }),
  cm1_pct:     ratio("CM1 %", "profitability", [t("kpis.revenue"), t("kpis.cogs", -1)], [t("kpis.revenue")], { ...PCT_UP, benchmarkable: true, caveats: SHOP_CAV, aliases: ["gross margin"] }),
  cm3:         sum("CM3", "profitability", [t("kpis.revenue"), t("kpis.cogs", -1), t("kpis.paid_spend", -1, "zero")], { ...MONEY_UP, benchmarkable: false, caveats: PAID_CAV, definitionKey: "CM3" }),
  cm3_pct:     ratio("CM3 %", "profitability", [t("kpis.revenue"), t("kpis.cogs", -1), t("kpis.paid_spend", -1, "zero")], [t("kpis.revenue")], { ...PCT_UP, benchmarkable: true, caveats: PAID_CAV, definitionKey: "CM3 %" }),

  // Acquisition
  paid_spend:  sum("Paid spend", "acquisition", [t("kpis.paid_spend")], { unit: "money", format: F.money, goodWhen: "neutral", benchmarkable: false, caveats: ["google_only_paid"], definitionKey: "Paid spend" }),
  mer:         ratio("MER", "acquisition", [t("kpis.revenue")], [t("kpis.paid_spend")], { ...X_UP, benchmarkable: true, caveats: PAID_CAV, definitionKey: "MER", minVolume: { c: "kpis.paid_spend", shareOfMax: 0.02 } }),
  amer:        ratio("aMER", "acquisition", [t("kpis.new_customer_revenue")], [t("kpis.paid_spend")], { ...X_UP, benchmarkable: true, caveats: [...PAID_CAV, "new_flag_window"], definitionKey: "aMER" }),
  cac:         ratio("CAC", "acquisition", [t("kpis.paid_spend")], [t("kpis.new_customer_orders")], { ...COST, benchmarkable: true, caveats: ["google_only_paid", "new_flag_window"], definitionKey: "CAC" }),
  new_customers: sum("New customers", "acquisition", [t("kpis.new_customer_orders")], { ...COUNT_UP, benchmarkable: false, caveats: ["new_flag_window"], aliases: ["first orders"] }),
  aov_new:     ratio("AOV new", "acquisition", [t("kpis.new_customer_net_sales")], [t("kpis.new_customer_orders")], { ...MONEY_UP, format: F.unitCost, benchmarkable: false, caveats: ["new_flag_window"] }),
  new_revenue_share: ratio("New revenue share", "acquisition", [t("kpis.new_customer_revenue")], [t("kpis.revenue")], { ...PCT_N, benchmarkable: false, caveats: ["new_flag_window"] }),

  // Retention (period-based; cohort RCR and LTV come in phase 2)
  returning_orders:        sum("Returning orders", "retention", [t("kpis.returning_customer_orders")], { ...COUNT_UP, benchmarkable: false, caveats: ["new_flag_window"] }),
  returning_order_share:   ratio("Returning order share", "retention", [t("kpis.returning_customer_orders")], [t("kpis.orders")], { ...PCT_N, benchmarkable: false, caveats: ["period_share_not_rcr", "new_flag_window"] }),
  returning_revenue_share: ratio("Returning revenue share", "retention", [t("kpis.returning_customer_revenue")], [t("kpis.revenue")], { ...PCT_N, benchmarkable: false, caveats: ["new_flag_window"] }),
  aov_returning:           ratio("AOV returning", "retention", [t("kpis.returning_customer_net_sales")], [t("kpis.returning_customer_orders")], { ...MONEY_UP, format: F.unitCost, benchmarkable: false }),

  // Meta (client currency via mart_daily_kpis)
  meta_spend:       sum("Meta spend", "meta", [t("kpis.meta_spend")], { unit: "money", format: F.money, goodWhen: "neutral", benchmarkable: false }),
  meta_roas:        ratio("Meta ROAS", "meta", [t("kpis.meta_revenue")], [t("kpis.meta_spend")], { ...X_UP, benchmarkable: true, caveats: ["platform_attributed"], minVolume: { c: "kpis.meta_spend", shareOfMax: 0.02 } }),
  meta_ctr:         ratio("Meta CTR", "meta", [t("kpis.meta_clicks")], [t("kpis.meta_impressions")], { unit: "percent", format: F.pct2, goodWhen: "up", benchmarkable: true }),
  meta_cpc:         ratio("Meta CPC", "meta", [t("kpis.meta_spend")], [t("kpis.meta_clicks")], { ...COST, benchmarkable: true }),
  meta_cpm:         ratio("Meta CPM", "meta", [t("kpis.meta_spend")], [t("kpis.meta_impressions")], { ...COST, scale: 1000, benchmarkable: true }),
  meta_cpa:         ratio("Meta CPA", "meta", [t("kpis.meta_spend")], [t("kpis.meta_purchases")], { ...COST, benchmarkable: true, caveats: ["platform_attributed"] }),
  meta_spend_share: ratio("Meta share of spend", "meta", [t("kpis.meta_spend")], [t("kpis.paid_spend")], { ...PCT_N, benchmarkable: false }),

  // Google
  google_spend: sum("Google spend", "google", [t("kpis.google_spend")], { unit: "money", format: F.money, goodWhen: "neutral", benchmarkable: false }),
  google_roas:  ratio("Google ROAS", "google", [t("kpis.google_revenue")], [t("kpis.google_spend")], { ...X_UP, benchmarkable: true, caveats: ["platform_attributed", "google_all_conversions"] }),
  google_ctr:   ratio("Google CTR", "google", [t("kpis.google_clicks")], [t("kpis.google_impressions")], { unit: "percent", format: F.pct2, goodWhen: "up", benchmarkable: true }),
  google_cpc:   ratio("Google CPC", "google", [t("kpis.google_spend")], [t("kpis.google_clicks")], { ...COST, benchmarkable: true }),

  // Phase 2: email (campaigns only; flows are cumulative snapshots) and Meta funnel
  email_revenue:       sum("Email campaign revenue", "email", [t("email_campaign.revenue")], { ...MONEY_UP, benchmarkable: false, caveats: ["platform_attributed"], phase: 2, grains: ["week","month"] }),
  email_open_rate:     ratio("Open rate", "email", [t("email_campaign.unique_opens")], [t("email_campaign.delivered")], { ...PCT_UP, benchmarkable: true, phase: 2, grains: ["week","month"] }),
  email_click_rate:    ratio("Click rate", "email", [t("email_campaign.unique_clicks")], [t("email_campaign.delivered")], { unit: "percent", format: F.pct2, goodWhen: "up", benchmarkable: true, phase: 2, grains: ["week","month"] }),
  email_rev_per_email: ratio("Revenue per email", "email", [t("email_campaign.revenue")], [t("email_campaign.sent")], { ...MONEY_UP, format: F.unitCost, benchmarkable: false, phase: 2, grains: ["week","month"] }),
  meta_atc_rate:       ratio("Meta add-to-cart rate", "meta", [t("meta_campaign.add_to_cart")], [t("meta_campaign.link_clicks")], { ...PCT_UP, benchmarkable: true, phase: 2 }),
});
```

### 2.5 Caveat rules
Caveat rules are computed per client from registry fields, never from a hardcoded client id.

```ts
// lib/reports/registry/caveats.ts
export const CAVEATS: Record<CaveatId, { short: string; applies: (c: ReportClient) => boolean }> = {
  revenue_incl_vat:       { short: "Revenue incl. VAT", applies: c => c.shopPlatform === "shoptet" },
  returns_not_netted:     { short: "Refunds not netted", applies: c => c.shopPlatform === "shopify" },
  woo_fees_not_netted:    { short: "Discount fee lines not netted", applies: c => c.shopPlatform === "woocommerce" }, // remove when the stg_woo_orders fix lands
  google_only_paid:       { short: "Meta not connected: spend is Google only", applies: c => !c.capabilities.meta && c.capabilities.googleAds },
  google_all_conversions: { short: "All Google conversion actions", applies: c => c.capabilities.googleAds },
  platform_attributed:    { short: "Platform-attributed", applies: () => true },
  new_flag_window:        { short: "New vs returning within history window", applies: () => true },
  period_share_not_rcr:   { short: "Order share, not cohort repeat rate", applies: () => true },
};
```
Rendering: the metric value gets a `^` marker. The hover lists the caveats that apply to that client and metric.

### 2.6 Request contracts (zod, `lib/reports/types.ts`)
```ts
const ClientSelection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("list"), ids: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).min(1).max(30) }),
  z.object({ mode: z.literal("vertical"), verticals: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).min(1).max(10) }),
]);
const PeriodSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("preset"), preset: z.enum(["7d","28d","30d","90d","mtd","ytd","12m","all"]) }),
  z.object({ kind: z.literal("custom"), from: IsoDate, to: IsoDate }),
]);
export const ReportFilters = z.object({
  clients: ClientSelection,
  period: PeriodSpec,
  compare: z.enum(["previous_period", "previous_year", "none"]),
  currency: z.enum(["native", "CZK", "EUR", "USD"]),
  benchmark: z.boolean(),
});
export const WidgetQuery = z.object({
  metrics: z.array(z.enum(METRIC_IDS)).min(1).max(8),
  grain: z.enum(["total", "day", "week", "month"]),
  split: z.enum(["client", "combined", "vertical"]),
  overrides: ReportFilters.partial().default({}), // absent key = inherit the report filter
});
export const WidgetView = z.object({
  type: z.enum(["kpi", "line", "bar", "table", "ranked", "scatter"]),
  title: z.string().max(80).optional(),
  sort: z.enum(["desc", "asc"]).optional(),
  limit: z.number().int().min(1).max(30).optional(),
  stacked: z.boolean().optional(),
  scatter: z.object({ x: z.enum(METRIC_IDS), y: z.enum(METRIC_IDS), size: z.enum(METRIC_IDS).optional() }).optional(),
});
export const WidgetConfig = z.object({ v: z.literal(1), query: WidgetQuery, view: WidgetView });
```
Only `query` plus the resolved filters affect the cache key and trigger a fetch. Changing `view` re-renders locally.

### 2.7 Resolution (`lib/reports/resolve.ts`)
1. **Merge filters.** Use the widget override where one is set, otherwise the report filter.
2. **Resolve clients.** `getReportClients()` gives active, non-demo clients, each with `ReportClient` fields: id, name, currency, shopPlatform, capabilities including woocommerce, shop, email, and vertical/region from `ref.client_verticals`. "all" becomes every active id. "vertical" goes through the vertical map. List ids are intersected with the active set, so unknown ids are dropped. The result is sorted.
3. **Resolve the period.** Presets go through `presetRange()` from `lib/period.ts`. Custom ranges are clamped to `to <= yesterday` and `from >= yesterday - 60 months` (the warehouse window), with a `range_clamped` warning. The comparison uses `comparisonRange()` (364-day shift for previous year).
4. **Resolve the currency.** If every selected client trades in one currency, "native" becomes that currency. If currencies are mixed, it becomes CZK with a `currency_coerced` warning.
5. **Apply limits** (from `lib/reports/limits.ts`):

| Grain | Max span |
|---|---|
| day | 400 days |
| week | 160 weeks |
| month | 60 months |
| total | 60 months |

   On top of that: buckets x series at most 1,500; at most 8 metrics per widget; at most 24 widgets per report. Breaking a limit returns `413` with a suggestion ("Use week grain").
6. **Check capabilities per (client, metric)** using `evalCapExpr(meta.requires, client.capabilities)`. A false result marks that cell `not_connected` and records which capabilities are missing ("Meta not connected"). Clients whose every cell is `not_connected` are left out of `@clientIds`, which saves bytes, but they still appear as series carrying that status.

### 2.8 Compilation: one parameterized query per widget
Rules:
- **No user text reaches the SQL.** The SQL is built only from registry constants: table names, column names and a fixed `BUCKET_SQL` map:
  - `day` gives `t.date`
  - `week` gives `DATE_TRUNC(t.date, ISOWEEK)`
  - `month` gives `DATE_TRUNC(t.date, MONTH)`
  - `total` gives `DATE '1970-01-01'`
- **User values only travel as typed params:** `@clientIds ARRAY<STRING>`, the date params `DATE`, `@displayCurrency STRING` (already enum-checked). Identifiers are checked against `/^[a-z_][a-z0-9_]*$/` when the registry loads.
- **One CTE per mart touched, then `FULL OUTER JOIN USING (client_id, period, bucket)`.** In phase 1 there is only `kpis`, so the query is one CTE.
- **SQL returns component sums only.** Every metric formula is evaluated in TypeScript from those sums, in one place, for per-client series, combined rollups and comparisons alike. This follows the "roll up in TypeScript" rule from METRICS and PROJECT_LOG, and keeps the SQL surface small.
- **Money components are emitted twice.**
  - `__nat`: only rows whose currency equals the client's registry currency. This matches the existing pages' `currency = client.currency` behaviour, and stray foreign-currency rows are counted.
  - `__disp`: every row converted per month into the display currency before summing.
- **FX is triangulated through CZK** in a `fx` CTE: a direct `X -> CZK` rate, a two-hop `X -> Y -> CZK` rate (for CAD via USD), and a CZK identity row. The factor is `src.to_czk / dst.to_czk`. Rows with no rate get NULL. The query counts those rows per bucket, and the evaluator then nulls the bucket's display money instead of letting `SUM` skip the missing rows quietly.
- **Comparison runs in the same query**, with a `period` tag (`cur` or `cmp`). The SQL variant without the comparison clause is chosen at compile time when the mode is none.

Example: Line widget, metrics `[mer, cac]`, clients manami, dobias, rawbark, week grain, last 90 days, compared with the previous year, CZK.
```sql
WITH fx_direct AS (
  SELECT month_start, from_currency AS ccy, rate AS to_czk
  FROM `oneeighty-warehouse.ref.fx_rates`
  WHERE to_currency = 'CZK'
    AND month_start BETWEEN DATE_TRUNC(@scanFrom, MONTH) AND DATE_TRUNC(@scanTo, MONTH)
),
fx AS (
  SELECT * FROM fx_direct
  UNION ALL
  SELECT a.month_start, a.from_currency, a.rate * d.to_czk          -- two-hop, e.g. CAD -> USD -> CZK
  FROM `oneeighty-warehouse.ref.fx_rates` a
  JOIN fx_direct d ON d.month_start = a.month_start AND d.ccy = a.to_currency
  WHERE a.to_currency <> 'CZK'
    AND a.from_currency NOT IN (SELECT ccy FROM fx_direct)
    AND a.month_start BETWEEN DATE_TRUNC(@scanFrom, MONTH) AND DATE_TRUNC(@scanTo, MONTH)
  UNION ALL
  SELECT m, 'CZK', NUMERIC '1'
  FROM UNNEST(GENERATE_DATE_ARRAY(DATE_TRUNC(@scanFrom, MONTH), DATE_TRUNC(@scanTo, MONTH), INTERVAL 1 MONTH)) AS m
),
kpis AS (
  SELECT
    t.client_id,
    IF(t.date BETWEEN @curFrom AND @curTo, 'cur', 'cmp')             AS period,
    DATE_TRUNC(t.date, ISOWEEK)                                      AS bucket,
    COUNT(*)                                                         AS n_rows,
    COUNTIF(t.currency <> c.currency)                                AS foreign_ccy_rows,
    COUNTIF(src.to_czk IS NULL OR dst.to_czk IS NULL)                AS fx_missing_rows,
    ARRAY_AGG(DISTINCT IF(src.to_czk IS NULL OR dst.to_czk IS NULL,
                          DATE_TRUNC(t.date, MONTH), NULL) IGNORE NULLS) AS fx_missing_months,
    SUM(IF(t.currency = c.currency, t.revenue, NULL))                AS revenue__nat,
    SUM(t.revenue * src.to_czk / dst.to_czk)                         AS revenue__disp,
    SUM(IF(t.currency = c.currency, t.paid_spend, NULL))             AS paid_spend__nat,
    SUM(t.paid_spend * src.to_czk / dst.to_czk)                      AS paid_spend__disp,
    SUM(t.new_customer_orders)                                       AS new_customer_orders
  FROM `oneeighty-warehouse.mart.mart_daily_kpis` AS t
  JOIN `oneeighty-warehouse.ref.clients` AS c USING (client_id)
  LEFT JOIN fx AS src ON src.month_start = DATE_TRUNC(t.date, MONTH) AND src.ccy = t.currency
  LEFT JOIN fx AS dst ON dst.month_start = DATE_TRUNC(t.date, MONTH) AND dst.ccy = @displayCurrency
  WHERE t.client_id IN UNNEST(@clientIds)
    AND (t.date BETWEEN @curFrom AND @curTo OR t.date BETWEEN @cmpFrom AND @cmpTo)
  GROUP BY client_id, period, bucket
)
SELECT * FROM kpis
ORDER BY client_id, period, bucket
```
```ts
params = { clientIds: ["dobias","manami","rawbark"], curFrom, curTo, cmpFrom, cmpTo, scanFrom, scanTo, displayCurrency: "CZK" }
types  = { clientIds: ["STRING"], curFrom: "DATE", curTo: "DATE", cmpFrom: "DATE", cmpTo: "DATE", scanFrom: "DATE", scanTo: "DATE", displayCurrency: "STRING" }
key    = sha256(JSON.stringify({ sv: SEMANTIC_VERSION, sql, params }))   // deterministic: sorted ids, sorted components
```

### 2.9 Evaluation (`lib/reports/evaluate.ts`)
1. **Build the bucket list in TypeScript** from the range and grain, so a missing bucket is a gap and never a skipped point. Partial first and last weeks or months are flagged as `partialBuckets`. Comparison buckets line up with current buckets by position.
2. **Apply row guards** for each (series, period, bucket):
   - `fx_missing_rows > 0`: every `__disp` value becomes null and the months are recorded.
   - `foreign_ccy_rows > 0`: add a caveat.
   - `zeroIsMissingWhen`: if the summed `cogs` is 0 while `revenue > 0`, `cogs` becomes null and the cell is `not_measured` ("No cost data"). This catches RawBark, whose mart coalesces COGS to 0.
3. **Choose native or display values.**
   - Per-client series: `fxMode === "native-per-client"` (ratio, percent, count) reads `__nat`. Money units read `__disp`.
   - Combined and vertical rollups: always read `__disp`, so every client is in one currency before summing.
4. **Evaluate terms.**
   - Sum metrics: the signed sum. A null term with `nullAs: "gap"` nulls the metric; a null `nullAs: "zero"` term counts as 0.
   - Ratio metrics: `SUM(num)/SUM(den) * scale`. A null or zero denominator gives null.
   - Totals sum the components across buckets first and then evaluate. They are never the sum or average of the bucket metric values.
5. **Rollups.** Combined adds component sums across included clients. Clients that are `not_connected` for a metric are left out, and the cell is noted "4 of 5 clients". If any included client is `fx_missing` or `not_measured`, the combined cell is null with that reason; it is never a partial total.
6. **Deltas.** Percent units use the difference in percentage points. Everything else uses `delta()` from `lib/period.ts` (null on a zero baseline). Direction and sentiment come from `goodWhen` through the existing `DeltaChip`.
7. **Status precedence:** `not_connected` > `fx_missing` > `not_measured` > `no_data` (capability present but the sum is null) > `ok`.

### 2.10 How each widget renders a missing capability or gap
| Widget | Rendering |
|---|---|
| KPI | Value is an em-dash glyph with a muted two-word status; the delta is hidden |
| Line | `connectNulls={false}`; a not-connected series is greyed in the legend with its reason and no line |
| Bar | No bar; a hatched placeholder with a status label |
| Table | Muted status text in the cell; sorts last in both directions |
| Ranked | Sinks below the ranked rows with its status |
| Scatter | Point omitted; footnote "rawbark: Meta not connected" |

### 2.11 Benchmarks (`lib/reports/benchmarks.ts`)
- **Loading.** `ref.industry_benchmarks` (rows with `is_active`) and `ref.fx_rates` are each read once, cached for 6 hours with tags `reports-ref` and `benchmarks`. These are reference reads shared by every widget; the fact query is still one per widget.
- **Matching**, for each benchmarkable metric and each vertical among the series' clients:
  1. Find candidates by `(vertical, metric_id)`, falling back to `vertical = 'all_ecommerce'`.
  2. Prefer `region` in this order: the client's region, then EU, then GLOBAL.
  3. Score by how many days overlap the current range. If nothing overlaps, take the latest `period_end` within 18 months before the range.
  4. Break ties by the latest `as_of`.
- **Money benchmarks** (AOV, CAC, CPC, CPM, CPA) are converted from the row's `currency` into the display currency using the FX rate for the `period_end` month. If there is no rate, the benchmark is hidden and the hover says why.
- **Staleness.** A benchmark whose `as_of` is more than 12 months old renders muted, with "Stale" in the hover.
- **Output.** Results go into `WidgetResult.benchmarks[]` with value, low, high, stat, source, sourceUrl, asOf, period, note and appliesTo (client ids).

### 2.12 Result shape
```ts
interface WidgetResult {
  key: string; generatedAt: string; cached: boolean;
  currency: string; grain: QueryGrain;
  current: DateRange; comparison: DateRange | null;
  buckets: string[]; partialBuckets: number[];
  series: Array<{
    id: string; label: string; slot: number; kind: "client" | "combined" | "vertical";
    caveats: CaveatId[];
    cells: Record<MetricId, {
      status: "ok" | "not_connected" | "no_data" | "not_measured" | "fx_missing";
      reason?: string;
      total: number | null; compareTotal: number | null; delta: number | null; deltaKind: "relative" | "pp";
      points?: Array<number | null>; comparePoints?: Array<number | null>;
      lowVolume?: boolean; coverage?: { included: number; of: number };
    }>;
  }>;
  benchmarks: BenchmarkMatch[];
  warnings: Array<{ code: "fx_missing"; months: string[] } | { code: "range_clamped" | "currency_coerced" }>;
}
```

---

## 3. API design

### 3.1 Access control (server-side, defence in depth)
Add to `lib/authz.ts`:
```ts
export const REPORTS_ROLES: Role[] = ["admin"];          // owner decision; agency is a one-line change (open question 1)
const INTERNAL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAIN ?? "oneeighty.cz")
  .split(",").map(d => d.trim().toLowerCase());

export function canUseReports(a: Access | null): a is Access {
  if (!a || !REPORTS_ROLES.includes(a.role)) return false;
  return INTERNAL_DOMAINS.includes(a.email.split("@")[1]?.toLowerCase() ?? "");
}
export async function requireReportsAccess(): Promise<Access>      // pages and layouts: redirect("/snapshot") and console.warn [authz]
export async function reportsAccessOrNull(): Promise<Access | null> // route handlers: caller returns 404
export async function assertReportsAccess(): Promise<Access>       // server actions and lib functions: throw "Not authorised."
```
Where the gate is enforced:
1. `app/(app)/reports/layout.tsx` calls `requireReportsAccess()`. Every page under it is covered, including pages added later.
2. Each page calls it again, cheaply.
3. `app/api/reports/query/route.ts` calls `reportsAccessOrNull()` before parsing the body or touching any cache. It returns 404, not 403, so the route's existence is not revealed.
4. Every server action in `app/(app)/reports/actions.ts` calls `assertReportsAccess()` first.
5. `lib/reports/run.ts`, `lib/reports/store.ts` and `lib/reports/clients.ts` each call `assertReportsAccess()` internally. A future page for client-role users that imports them by mistake then fails closed.
6. Rail and nav hiding is presentation only.

Session cost: each check calls `getServerSession`, and the `jwt` callback then looks the user up in Postgres (pool `max: 3`). Ten parallel widget requests mean ten small Postgres lookups. That is acceptable. If it shows up in latency, add a 30-second in-memory memo keyed by the token `jti`.

Auditing: write one `access_log` row per report open, with `clientId: null` and `detail: "report:<id> clients=<ids>"`. `AccessEntry.clientId` is already nullable.

### 3.2 Read path: route handler (deliberate exception to "no data API routes")
`POST /api/reports/query`
- `export const runtime = "nodejs"; dynamic = "force-dynamic"; maxDuration = 30;`
- Body: `{ reportId?: string, filters: ReportFilters, query: WidgetQuery }`. When `reportId` is present, view permission on that report is checked too.
- Flow:
  1. Gate (404 on failure).
  2. zod parse (400 with issues).
  3. `getReportClients()`.
  4. `resolveWidget()` (413 when over a limit).
  5. `compileWidget()`.
  6. `runCached()`.
  7. `getBenchmarks()` if enabled.
  8. `evaluateWidget()`.
  9. `Response.json(result, { headers: { "Cache-Control": "private, no-store" } })`.
- Error mapping:

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid` | Body failed validation |
| 404 | (none) | Not authorised, or report not visible to this user |
| 413 | `too_large` | Range or point limit exceeded |
| 422 | `over_budget` | BigQuery "bytes billed" limit exceeded |
| 504 | `timeout` | Query timed out |
| 500 | `warehouse_error` | Permission and other BigQuery errors, re-thrown and never shown as an empty state (existing rule) |

- **Why a route and not a server action:** Next 14 dispatches server actions from a client one at a time, so a 10-widget report would load in sequence. **Why not RSC streaming only:** the builder has to refetch a single widget without re-rendering the page.
- **Why this is safe:** internal-only gate, returns 404 to everyone else, no per-record ids that touch tenant data, strict zod plus registry whitelist. Document it in TENANCY section 4 as the single exception.

### 3.3 Write path: server actions (`app/(app)/reports/actions.ts`)
Every action follows the same steps: `assertReportsAccess()`, zod parse, check ownership or edit permission, call the store, `revalidatePath("/reports")` where the list changes. They return `{ ok, message?, version? }`.
- `createReport({ name, templateKey? })` returns `{ id }`.
- `renameReport(id, name)`, `duplicateReport(id)` returns `{ id }`, `deleteReport(id)` (soft delete), `restoreReport(id)`.
- `setVisibility(id, "private" | "team_view" | "team_edit")`. Owner only.
- `saveReportFilters(id, expectedVersion, filters)`.
- `saveLayout(id, expectedVersion, items: Array<{ id, x, y, w, h }>)`. One transaction.
- `addWidget(id, expectedVersion, { type, config, x, y, w, h })`, `updateWidget(id, expectedVersion, widgetId, config)`, `removeWidget(id, expectedVersion, widgetId)`.
- `pinReport(id, pinned)`, `touchOpened(id)` (fire and forget).
- `refreshReportData()`. Calls `revalidateTag("reports")`, rate-limited to one call per 60 seconds per user.

Permission rule: canView means owner, or visibility is not private. canEdit means owner, or `team_edit`. Only the owner can change visibility or delete.

### 3.4 Caching
| Layer | Key | TTL / policy |
|---|---|---|
| Browser (per tab) | `result.key` in a module-level LRU (100 entries) | For the tab's lifetime. Instant back-and-forth while editing. Stale-while-revalidate on refetch. |
| In-flight dedupe (per lambda) | compiled key, a `Map<key, Promise>` | Until settled |
| Server data cache | `unstable_cache(run, ["rpt", SEMANTIC_VERSION, key], { revalidate, tags: ["reports", "bq"] })` | 15 min if `range.to >= yesterday - 2`; 1 h if it ends within the last 7 days; 6 h if older |
| BigQuery query cache | automatic | Best effort. Often unavailable on views over streaming-inserted raw tables. |
| Reference data | `getReportClients` 5 min, `getBenchmarks`/fx 6 h | tags `reports-ref`, `benchmarks` |

- The gate runs before any cache read. Cached results are role-independent (internal only) and never cached in the CDN or the browser HTTP cache (`private, no-store`).
- `unstable_cache` is still an "unstable" API in Next 14. `run.ts` wraps it behind one function so it can be swapped for an in-memory LRU, or Next 15 `"use cache"`, without touching callers.

### 3.5 Cost guardrails
- **`maximumBytesBilled`** on every reporting query. Env `REPORTS_MAX_BYTES_BILLED`, default 2 GiB. Exceeding it fails the job, which maps to 422 `over_budget`. Calibrate with the dry-run script; at about $6.25 per TiB on demand, even 1,000 widget queries a day at 100 MB is roughly 0.1 TiB, under $1 a day.
- **`jobTimeoutMs: 20000`.** `labels: { app: "dashboard", feature: "reports", widget_type, user: sha1(email).slice(0,8) }` for `INFORMATION_SCHEMA.JOBS` cost breakdowns.
- **A date predicate on the mart `dateColumn` in every CTE**, asserted by the compiler (it throws if any mart CTE lacks one). Only selected client ids, since raw tables are clustered by `client_id` and the stg `ROW_NUMBER` windows partition by `client_id`, so client filters do push down.
- **Span and point limits** from section 2.7. At most 24 widgets per report. The browser allows at most 6 concurrent widget requests.
- **Clients `not_connected` for every metric are left out of `@clientIds`.**
- **`scripts/check-reports.ts`** (`npm run check:reports`) does three things:
  - (a) Evaluator fixture assertions.
  - (b) For every phase-1 metric and every grain at 90d, 12m and 60m across all clients, a BigQuery dry run (`dryRun: true`) printing `totalBytesProcessed`. It fails above 50% of the budget.
  - (c) An `INFORMATION_SCHEMA.COLUMNS` check that every registry component exists in the live view. This catches the live-versus-repo DDL drift noted for Woo.

### 3.6 Latency targets
| Interaction | Target |
|---|---|
| Drag, resize, reorder | 60 fps, zero network; save debounced 800 ms |
| Display-only change (type, title, sort, limit) | < 50 ms, no fetch |
| Widget data, warm server cache | p95 < 300 ms end to end |
| Widget data, cold (views over stg dedupe) | p50 < 2 s, p95 < 4 s |
| Report open, 8 widgets, warm | first widget < 800 ms after navigation, all < 1.5 s |
| `/reports/[id]` first-load JS | < 200 KB gz (react-grid-layout eager; Recharts loaded per chart widget) |

If cold p95 is above 3.5 s after the MVP ships, use the phase-2 option: an hourly materialised `mart.rpt_client_daily` table (see open question 5). Also check whether the Node BigQuery client at the installed version supports `jobCreationMode: "JOB_CREATION_OPTIONAL"` (short query mode); if it does, enable it for roughly 300 ms less job overhead.

---

## 4. Persistence

### 4.1 Postgres (Neon), lazy DDL in `lib/reports/store.ts`
This follows the `lib/goals/store.ts` pattern: its own `ensureTable()`, never added to the shared `ensureSchema`, and race errors 23505, 42P07 and 42710 are treated as success. Emails are stored lower-cased by the app.
```sql
CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  owner_email     TEXT NOT NULL,
  visibility      TEXT NOT NULL DEFAULT 'private'
                  CHECK (visibility IN ('private', 'team_view', 'team_edit')),
  filters         JSONB NOT NULL,                 -- ReportFilters, zod-validated on read and write
  schema_version  SMALLINT NOT NULL DEFAULT 1,    -- config migrations
  version         INTEGER NOT NULL DEFAULT 1,     -- optimistic concurrency, bumped on every write
  template_key    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT NOT NULL,
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS reports_owner_idx
  ON reports (owner_email, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS reports_team_idx
  ON reports (updated_at DESC) WHERE deleted_at IS NULL AND visibility <> 'private';

CREATE TABLE IF NOT EXISTS report_widgets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('kpi', 'line', 'bar', 'table', 'ranked', 'scatter')),
  config      JSONB NOT NULL,                     -- WidgetConfig { v, query, view }
  x           SMALLINT NOT NULL CHECK (x BETWEEN 0 AND 11),
  y           SMALLINT NOT NULL CHECK (y BETWEEN 0 AND 999),
  w           SMALLINT NOT NULL CHECK (w BETWEEN 1 AND 12),
  h           SMALLINT NOT NULL CHECK (h BETWEEN 2 AND 24),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_widgets_fits_grid CHECK (x + w <= 12)
);
CREATE INDEX IF NOT EXISTS report_widgets_report_idx ON report_widgets (report_id);

CREATE TABLE IF NOT EXISTS report_user_state (
  user_email      TEXT NOT NULL,
  report_id       UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  pin_position    SMALLINT NOT NULL DEFAULT 0,
  last_opened_at  TIMESTAMPTZ,
  PRIMARY KEY (user_email, report_id)
);
```
Notes:
- `gen_random_uuid()` is built into PostgreSQL 13 and later; Neon runs 15 or newer.
- Writes that touch several rows (`saveLayout`, `addWidget`, `duplicateReport`) go through `withTransaction()` in `store.ts`, using `pool().connect()` from `lib/users/db.ts`. Each starts with `UPDATE reports SET version = version + 1, updated_at = NOW(), updated_by = $u WHERE id = $id AND version = $expected AND deleted_at IS NULL RETURNING version`. Zero rows returned means a conflict.
- A widget config that fails zod on read renders a "Widget outdated" state with Remove and Reset. It never crashes the report.
- Only the 12-column layout is persisted. Narrower breakpoints are derived.

### 4.2 BigQuery DDL (`infra/bigquery/227_ref_industry_benchmarks.sql`, `228_ref_client_verticals.sql`)
`sa-frontend-reader` already has READER on `ref`, so no new grants or authorized datasets are needed.
```sql
-- 227_ref_industry_benchmarks.sql
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.industry_benchmarks` (
  benchmark_id     STRING  NOT NULL,              -- e.g. 'pet_food-mer-2025h2-src1'
  vertical         STRING  NOT NULL,              -- matches ref.client_verticals.vertical, or 'all_ecommerce'
  region           STRING  NOT NULL,              -- 'CZ' | 'CEE' | 'EU' | 'US' | 'GLOBAL'
  metric_id        STRING  NOT NULL,              -- registry id: 'mer', 'meta_ctr', 'cac', ...
  period_start     DATE    NOT NULL,
  period_end       DATE    NOT NULL,
  stat             STRING  NOT NULL,              -- 'median' | 'mean' | 'p25' | 'p75'
  value            NUMERIC NOT NULL,              -- percents as fractions (0.012), ratios as x (3.1), money in `currency`
  value_low        NUMERIC,                       -- optional interquartile band
  value_high       NUMERIC,
  currency         STRING,                        -- required for money metrics, NULL otherwise
  source           STRING  NOT NULL,              -- shown on hover
  source_url       STRING,
  as_of            DATE    NOT NULL,              -- when we captured it; shown on hover
  definition_note  STRING,                        -- e.g. 'revenue ex VAT; blended paid'
  sample_note      STRING,
  note             STRING,
  is_active        BOOL    NOT NULL DEFAULT TRUE,
  entered_by       STRING  NOT NULL,
  entered_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
CLUSTER BY vertical, metric_id
OPTIONS (description = 'Manually maintained industry benchmarks for the Reports suite. One row per vertical x metric x period x source. Never invent values; cite source and as_of.');

-- Template only, no real values:
-- INSERT INTO `oneeighty-warehouse.ref.industry_benchmarks`
--   (benchmark_id, vertical, region, metric_id, period_start, period_end, stat, value, currency,
--    source, source_url, as_of, definition_note, entered_by)
-- VALUES ('<id>', '<vertical>', 'EU', 'mer', DATE '<start>', DATE '<end>', 'median', <value>, NULL,
--         '<source>', '<url>', DATE '<as_of>', '<definition>', '<email>');
```
```sql
-- 228_ref_client_verticals.sql
CREATE TABLE IF NOT EXISTS `oneeighty-warehouse.ref.client_verticals` (
  client_id     STRING NOT NULL,                  -- ref.clients.client_id
  vertical      STRING NOT NULL,                  -- snake_case, from the agreed taxonomy (open question 2)
  sub_vertical  STRING,
  region        STRING NOT NULL,                  -- primary market for benchmark matching
  valid_from    DATE   NOT NULL,
  valid_to      DATE,                             -- NULL = current
  note          STRING,
  updated_by    STRING NOT NULL,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
OPTIONS (description = 'Client to vertical mapping for benchmark matching. At most one open row (valid_to IS NULL) per client.');
```
`229_ops_v_benchmark_issues.sql` (phase 2, feeds Data Health) flags:
- money metrics with no currency
- `period_end < period_start`
- duplicate active rows for the same (vertical, region, metric, period, stat, source)
- `as_of` older than 12 months
- active clients with no open vertical row
- clients with more than one open vertical row

Unknown `metric_id` values are flagged by the app, which knows the registry ids, on the Data Health page.

---

## 5. Library choices

### 5.1 Drag and resize: react-grid-layout (chosen)
| | react-grid-layout | dnd-kit | gridstack.js |
|---|---|---|---|
| Model | Controlled React state `{i,x,y,w,h}`; maps 1:1 to `report_widgets` | Primitives only (sensors, collision); no grid, no resize | Imperative DOM engine, framework-agnostic |
| Resize | Built in (react-resizable), multiple handles, min/max | Build it yourself | Built in |
| 2D packing / compaction | Built in (vertical compaction, collision) | Build it yourself | Built in |
| Responsive breakpoints | `Responsive` + derived layouts | Build it yourself | One-column mode, breakpoint options |
| React 18 / Next 14 | Peer React >= 16; client component; works in StrictMode; `WidthProvider` measures on mount (use `measureBeforeMount`) | Excellent, hooks-first | Mutates the DOM React owns; needs refs and `useEffect` sync, StrictMode double-mount care, portals per widget |
| Accessibility | No keyboard move or resize out of the box | Best in class (keyboard sensor, announcements) | Limited |
| Bundle (approx., min+gz) | about 20 to 25 KB with react-draggable and react-resizable | about 12 to 18 KB core+sortable, plus whatever grid/resize code gets written | about 25 to 30 KB plus CSS |
| Fit for "Notion/ClickUp board of resizable cards" | Direct fit | Good for Notion-style vertical block lists, poor for 2D resize | Fits, but fights React |

Why react-grid-layout:
- It is the only option where the persisted data model, resizing and compaction come built in and stay React-controlled. Undo/redo, optimistic saves and keyboard moves are just state updates.
- Its weak spot, keyboard support, is closed by `useGridKeyboard` (about 120 lines). It moves the focused item's x or y (or w and h with Shift), runs the library's own compaction through `utils.compact`, and announces the change through `aria-live`.
- Pin the current 1.5.x line. If the v2 TypeScript rewrite is stable at implementation time (check `npm view react-grid-layout version peerDependencies`), it is acceptable: the x/y/w/h model is the same.
- Import its CSS from `app/(app)/reports/layout.tsx` and restyle the handles and placeholder with tokens in `app/(app)/reports/grid.css`.
- Only the widget header drags (`draggableHandle=".widget-drag"`). Editing is disabled below 1200px.

### 5.2 Charting: Recharts, upgraded to v3, route-split
- **Reuse Recharts.** It already covers line, bar, scatter, `ReferenceLine`/`ReferenceArea` for benchmarks and bands, gaps through `connectNulls={false}`, and the `ResponsiveContainer` with `debounce` that the grid's resize needs.
- **Upgrade 2.15.4 to `^3`.** npm marks 2.x as unmaintained. v3's peer range includes React 18. Since nothing imports Recharts today, the migration costs nothing.
- **Load it per chart widget** with `next/dynamic(() => import("./LineWidget"), { ssr: false })`. A report of KPIs and tables never downloads it, and Analytics routes are untouched.
- **KPI tiles and ranked lists stay as hand-written SVG/HTML**, reusing `Sparkline`. The codebase's stated rule is that Recharts is only for charts whose interactivity earns its weight.
- **Tables reuse `components/ui/DataTable.tsx`.** It is already sortable and resizable, with nulls sorted last.
- **No data-fetching library.** `useWidgetData` is about 100 lines covering the LRU, abort, a concurrency of 6, and stale-while-revalidate. This avoids adding SWR or TanStack Query.

---

## 6. Phased build plan

### 6.1 MVP (about 1 week) scope
- Report list, builder canvas (desktop editing, mobile read-only stack), all six widget types.
- The 30 phase-1 metrics from `mart_daily_kpis`, splits (client, combined, vertical), comparisons, CZK/EUR/USD normalisation through the CZK pivot, gap statuses and caveats.
- Benchmarks DDL plus overlay and hover. The table may be empty at launch; the UI simply hides the overlay.
- Saved reports with team visibility, three templates, keyboard map, autosave with version check.
- Gate, query route, caching, guardrails, check script.

### 6.2 Later
- **Phase 2:**
  - Multi-mart metrics: email campaigns and the Meta funnel.
  - Text/heading block.
  - CSV export per widget.
  - Warming the server cache from the page render.
  - Benchmark staleness and missing-vertical checks on Data Health (`229_ops_v_benchmark_issues.sql`).
  - Stated client costs in CM (open question 3).
  - Materialised `rpt_client_daily` if latency needs it.
  - Per-breakpoint layouts with tablet editing.
  - Widget copy between reports.
- **Phase 3:**
  - Cohort metrics (cohort RCR, Y1 LTV), once Woo customer marts exist.
  - GA4 and Google campaign-level metrics, once those marts exist.
  - Scheduled email digests, annotations, PDF export.

### 6.3 Work packages
Each package owns its files exclusively. Shared files are assigned to exactly one package. "Strong" means architecture or security reasoning and needs a strong model. "Routine" means components or styling following the given contracts.

| WP | Model | Depends on | Files (all under `dashboard/` unless noted) | Done when |
|---|---|---|---|---|
| **WP0 Contracts and deps** | Strong | none (first, half a day) | `package.json`, `package-lock.json` (add `react-grid-layout`, plus its types if on 1.x; bump `recharts` to ^3; add `check:reports` script); `lib/reports/types.ts`; `lib/reports/registry/types.ts`; `lib/reports/registry/ids.ts` (`METRIC_IDS` tuple); `lib/reports/limits.ts`; `lib/reports/contracts.ts` (function signatures for resolve, compile, run, evaluate and store); `lib/reports/fixtures.ts` (a WidgetResult for every status, both splits, with and without benchmarks) | `tsc` passes; fixtures typecheck against the contracts |
| **WP1 Semantic layer** | Strong | WP0 | `lib/reports/registry/components.ts`, `metrics.ts`, `caveats.ts`, `capabilities.ts`; `lib/reports/resolve.ts`; `lib/reports/evaluate.ts`; `lib/reports/benchmarkMatch.ts`; `scripts/check-reports-eval.ts` | Fixture assertions pass: ratio from summed components; combined across currencies; FX bucket nulling; COGS zero guard; not_connected exclusion and coverage; pp vs relative deltas; partial buckets |
| **WP2 Compiler and runner** | Strong | WP0 | `lib/reports/compile.ts`; `lib/reports/run.ts` (unstable_cache wrapper, in-flight dedupe, TTL policy, error mapping); `lib/bigquery.ts` (add a `queryJob()` export with array param `types`, `maximumBytesBilled`, `labels`, `jobTimeoutMs`, `dryRun`; leave `query()` unchanged); `scripts/check-reports.ts` | Dry run of every metric and grain within budget; column check green against the live warehouse; the compiler asserts a date predicate per CTE; snapshot test of compiled SQL text |
| **WP3 Gate, reference data, API** | Strong | WP0 (codes against contracts; integrates WP1 and WP2) | `lib/authz.ts` (`REPORTS_ROLES`, `canUseReports`, `requireReportsAccess`, `reportsAccessOrNull`, `assertReportsAccess`); `lib/reports/clients.ts` (reads `ref.clients` with `has_woocommerce` plus `ref.client_verticals`, excludes demo, 5 min cache); `lib/reports/benchmarks.ts`; `app/api/reports/query/route.ts` | Client-role and agency sessions get 404; a bad body gets 400; matches Snapshot for one client and range on revenue, MER and CAC |
| **WP4 Persistence and actions** | Routine (moderate) | WP0 | `lib/reports/store.ts` (DDL, `withTransaction`, CRUD, permission helpers); `lib/reports/templates.ts`; `app/(app)/reports/actions.ts` | Version conflict returns `{ ok:false, code:"conflict" }`; every action fails without access; soft delete and restore work |
| **WP5 Shell integration** | Routine | WP0 | `lib/products.ts` (add `reports`, `productsFor(role)`); `components/shell/ProductRail.tsx` (icon, role prop); `components/shell/MobileTopBar.tsx`; `components/shell/Sidebar.tsx` (return null for reports); `components/shell/AccountMenu.tsx` (hide client switcher on reports); `app/(app)/layout.tsx` (pass role) | Rail shows Reports only for allowed users; other products unchanged |
| **WP6 Canvas** | Routine (moderate) | WP0 | `components/reports/canvas/ReportCanvas.tsx`, `WidgetFrame.tsx`, `MobileStack.tsx`, `useGridKeyboard.ts`, `useLayoutHistory.ts`, `useAutosave.ts`; `app/(app)/reports/grid.css` | Drag, resize and keyboard move/resize at 60 fps; undo/redo; autosave calls an injected `onSave`; stacked layout below 768px |
| **WP7 Widgets** | Routine | WP0 (renders `fixtures.ts`) | `components/reports/widgets/KpiWidget.tsx`, `LineWidget.tsx`, `BarWidget.tsx`, `TableWidget.tsx`, `RankedWidget.tsx`, `ScatterWidget.tsx`, `BenchmarkHover.tsx`, `CellStatus.tsx`, `chartTheme.ts`, `format.ts` (FormatSpec to string with `smallDecimals`; does not edit `lib/format.ts`); `styles/tokens/colors.css` (`--series-1..6`, `--benchmark`) | Every fixture renders every status; Recharts loaded only through `next/dynamic`; no hex literals |
| **WP8 Pickers and filter bar** | Routine (moderate) | WP0, registry ids (WP1 metadata can be stubbed) | `components/reports/pickers/MetricPicker.tsx`, `ClientPicker.tsx`, `WidgetTypePicker.tsx`, `WidgetConfigPanel.tsx`; `components/reports/ReportFilterBar.tsx` (reuses `DateRangeControl` and `SegmentedControl` unchanged); `lib/reports/url.ts` (filter overrides to and from search params: `clients`, `preset`, `from`, `to`, `compare`, `ccy`, `bench`) | Keyboard-complete combobox; capability coverage hints; URL round-trip |
| **WP9 Pages and state** | Routine (moderate; integration) | WP3, WP4, WP6, WP7, WP8 | `app/(app)/reports/layout.tsx` (gate, grid CSS import, list panel); `app/(app)/reports/page.tsx`; `app/(app)/reports/[reportId]/page.tsx`; `app/(app)/reports/loading.tsx`; `components/reports/ReportClient.tsx`; `components/reports/useWidgetData.ts`; `components/reports/ReportSwitcher.tsx`; `ShareMenu.tsx`; `ReportListPanel.tsx`; `ReportListTable.tsx`; `ShortcutSheet.tsx` | Full flow works end to end; 8-widget report meets the warm targets |
| **WP10 Warehouse and docs** | Routine | none | `infra/bigquery/227_ref_industry_benchmarks.sql`; `228_ref_client_verticals.sql`; `229_ops_v_benchmark_issues.sql` (phase 2); `runbooks/30_reporting_benchmarks.md` (how to add benchmark and vertical rows, taxonomy, never invent values); `TENANCY_ISOLATION_ASSESSMENT.md` addendum (the query route exception); `METRICS.md` "Reporting registry" section; `PROJECT_LOG.md` entry | DDL applied (by Matej or a Cloud Shell run); runbook explains the INSERT flow |

**Week plan**
| Day | Work |
|---|---|
| 1 | WP0 in the morning. Then WP1, WP2, WP4, WP5, WP7, WP8 and WP10 in parallel. |
| 2 to 3 | WP1, WP2 and WP4 finish; WP3 and WP6 start once WP0 is in; WP7 and WP8 continue. |
| 3 to 4 | WP9 integration. Run `check:reports` against the live warehouse. |
| 5 | QA and deploy (`npx vercel --prod --yes` from the repo root). |

**QA checklist**
- Client-role and agency accounts: the page redirects, the route returns 404, actions throw.
- RawBark: MER shows the `google_only_paid` caveat; CM3 shows "No cost data".
- Dobias USD in a CZK report converts correctly.
- October 2026 shows "No FX Oct 2026" until `ref.fx_rates` is refreshed.
- Combined MER equals a hand-written SQL check.
- Benchmark hover shows source and date.
- 375px layout works; keyboard-only flow works.

---

## 7. Risks

1. **Data quality makes cross-client views mislead.**
   - Manami revenue includes VAT.
   - Woo revenue is overstated by about 7.5% (RawBark) and 1.3% (Ethia) from the un-netted fee lines.
   - RawBark has no COGS and no Meta.
   - Dobias Meta spend is missing from Dec 2025 to Mar 2026.
   - `fx_rates` ends 2026-09.

   *Mitigation:* the caveat markers, COGS guard and FX nulling in sections 2.5 and 2.9. Fixing these upstream (fee lines, FX refresh, Woo customer marts) is warehouse work outside this build, but it directly improves report credibility.
2. **Live views differ from the repo DDL** (the Woo branch exists live but not in the repo). *Mitigation:* the column check in `check:reports` runs against the live views; the compiler only uses registry columns.
3. **Cold latency.** Views over the stg dedupe windows may not prune by date, so a cold widget can take 2 to 4 s. *Mitigation:* layered caching, stale-while-revalidate UI, and the measured trigger for a materialised table.
4. **Benchmark comparability.** External sources define MER, CAC and ROAS differently (VAT, attribution, blended or channel). *Mitigation:* the required `definition_note`, the hover card, staleness muting, and benchmarks allowed only on metrics flagged `benchmarkable`. The table is manual and will go stale without an owner; Data Health checks come in phase 2.
5. **Security surface.** This is the first multi-client data endpoint. *Mitigation:* the gate is enforced in five places (layout, page, route, actions and inside the lib functions), 404 responses, the zod and registry whitelist, no user identifiers in SQL, and the TENANCY addendum. The residual risk is a future developer reusing `lib/reports/*` on a client page; the internal asserts make that fail closed.
6. **`unstable_cache` behaviour on Vercel** (an unstable API, Data Cache entry limits). *Mitigation:* a single wrapper in `run.ts` with an LRU fallback. Results are small (under 200 KB).
7. **Registry flag drift** (for example `has_ga4` is false everywhere). A wrong flag shows "Not connected" while data exists. *Mitigation:* `detectRegistryDrift` already exists; extend its use on Data Health. Reports trust the registry by design.
8. **Concurrent edits** to team-editable reports. *Mitigation:* optimistic version check with reload. Last writer wins only after an explicit reload.
9. **Google `purchase_value` counts all conversion actions.** *Mitigation:* the `google_all_conversions` caveat on Google ROAS.

---

## 8. Open questions for the owner (these change the build)

1. **Who exactly gets Reports: `admin` only, or also `agency`-role staff on @oneeighty.cz?** This changes `REPORTS_ROLES` and rail visibility. The design defaults to admin only, per the decision as stated.
2. **Vertical taxonomy, regions and first benchmark sources.** Which verticals (for example `pet_food`, `pet_supplements`, `fragrance`, `skincare`, `cosmetics`) and which sources should be entered first? Should matching prefer CZ/CEE or EU figures? This changes the `ref.client_verticals` seed, the region fallback order and the runbook.
3. **Which CM3 should Reports show?** The mart definition, as Goals and the profit-share contracts use it, or Snapshot's version that subtracts the fulfilment and other CM1 costs stated in Settings? The second needs the Postgres `client_settings` values passed into the query as an array-of-struct param.
4. **Default display currency, and Manami VAT.** Is CZK the default for cross-client reports, and should Manami's VAT-inclusive revenue be estimated ex-VAT (for example, divided by 1.21) for comparisons and benchmarks, or only flagged? Estimating adds an adjustment component to the semantic layer.
5. **May reports read from an hourly materialised table** (`mart.rpt_client_daily`, refreshed by a scheduled query) if cold latency misses target? This departs from the "views only, instant edits" warehouse rule, in exchange for a sub-second cold load.

---

### Critical Files for Implementation
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/authz.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/bigquery.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/period.ts
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/infra/bigquery/213_client_ad_currency.sql
- /Users/matej/Documents/_One Eighty/OE Second Brain/one-eighty-dashboard-repo/dashboard/lib/reports/registry/metrics.ts (new; the semantic layer core)