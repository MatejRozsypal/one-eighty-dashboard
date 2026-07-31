# Claude Code Brief V4 — start here

Written 2026-07-31 at the end of a long dashboard session. Supersedes V3 for
anything about the frontend; V3 is still the reference for warehouse history
before this session. `PROJECT_LOG.md` has the chronological detail.

---

## 1. Where things are

- **Live:** https://dashboard.oneeighty.cz
- **Repo:** `main` — everything below is pushed and deployed.
- **Frontend:** `dashboard/` — Next.js 14 App Router, React 18, Tailwind.
- **Warehouse:** BigQuery `oneeighty-warehouse`, datasets `raw` / `stg` / `mart` / `ref` / `ops`.
- **App database:** Neon Postgres on Vercel (`DATABASE_URL`). Holds **only**
  app users and client cost settings — never warehouse data.

### Deploying

```bash
npx vercel --prod --yes    # from the REPO ROOT, not dashboard/
```

The Vercel project's **Root Directory is `dashboard`**. It was unset until this
session, which meant every git-push build died in 4 seconds looking for `app/`
at the repo root. That had never surfaced because all previous production
deploys were run by CLI from inside `dashboard/`, which uses the local cwd.

⚠️ **Git-push auto-deploy is not confirmed working.** After fixing the root
directory, later pushes produced no Vercel deployment at all — the GitHub
webhook did not fire. Every deploy this session was done by CLI. Worth
investigating; until then, always deploy explicitly after pushing.

---

## 2. Open question, waiting on Matěj

**Fulfilment cost rates.** Agreed in principle: a per-order fulfilment cost
should exist so CM2/CM3 are real. Established during the discussion:

- Shopify **does not expose what you paid the carrier**. `total_shipping` is
  what the *customer paid you* — revenue, not cost. Actual label cost only
  exists if buying through Shopify Shipping, and then it lives in payouts /
  balance transactions, not on the order. With a 3PL it is not in Shopify at all.
- So it must be a **stated rate**, not a measurement.
- Matěj's own objection — cross-country shipping costs more than local — is the
  reason **not** to write a flat value onto every order: `$3 × N orders` is
  identical whether computed per row or per aggregate, so materialising it adds
  no information while implying per-order precision it does not have, and every
  rate change then needs a backfill.
- `shipping_country` / `shipping_province` **are already on Shopify orders**, so
  a rate per zone is available for free and varies with the thing that varies.
  Shoptet has no address at all, so Manami gets one rate (or a CZK/EUR proxy).

**Proposed and not yet built:** `ref.client_shipping_costs` with
`client_id, zone, cost_per_order, effective_from`. Marts join on
`shipping_country` with a `DEFAULT` fallback. Effective dating matters — without
it, raising a rate silently restates last year's CM3.

**Still needed from Matěj:** the rates (flat, or per US / CA / rest), the date
they take effect, and whether to apply them retroactively.

---

## 3. Never verified at runtime — check these first

These are built, typechecked and deployed, but **nobody has ever exercised
them**. Local dev has neither BigQuery credentials nor OAuth, so they could not
be tested here.

1. **Password sign-in, password reset, forced password change.** The entire
   credentials path. `app_users` exists in Postgres and one `agency` user was
   created, but no one has signed in with a password.
2. **Saving Cost assumptions in `/admin`**, and therefore whether the EBITDA
   card appears once an OpEx rate is entered.
3. **Cohort heatmap** rendered with real data — shade steps and column widths.
4. **Column dragging** in tables.

---

## 4. What changed this session

### Warehouse (all deployed)

| Migration | View | Note |
|---|---|---|
| 013 | `ref.fx_rates` +USD→CZK | 50 months, ČNB. Unlocked the CZK toggle. |
| 209 | `mart_orders` | Now unions Shoptet. Reconciles to the cent. |
| 210 | `mart_customer_cohort_grid` | cohort × month-offset × market. |
| 211 | `mart_unit_economics` | order-line, first-time vs returning. |
| 212 | `mart_customer_payback` | 30/90-day LTGP per new customer. |

### Frontend

New pages: **Unit economics** (Profitability). Rebuilt: cohort grid with metric
selector + market filter, Growth YoY with a seasonal projection, Paid funnel,
revenue composition, acquisition economics as cards, order mix, email flows.
Sortable + resizable tables everywhere via one `DataTable`. Mobile shell
reworked (notch-safe black bar, title as page switcher, sticky rounded
shoulder). Auth roles, admin screen, client cost settings.

---

## 5. Bugs found this session, and how

Read this section before writing any new aggregate.

**A per-customer average that was per-day.** `mart_customer_payback` reported
Manami at 2,607 CZK of 30-day gross profit per customer against a sub-1,000 CZK
AOV. The `per_customer` CTE omitted `customer_key` from its `GROUP BY`, so it
grouped by cohort *date*; the outer `COUNTIF` counted dates, not customers.
Every average was inflated ~4×. **Matěj caught it by arithmetic, not by tooling
— 2,607 CZK of gross profit implies three full-margin orders in 30 days.**
Nothing in the pipeline objected. Sanity-check every new per-entity average
against a figure already trusted.

**A live lockout.** The auth bootstrap keyed on the users table being *empty*.
It stopped being empty when the first account was created as `agency` — from
then, nobody could bootstrap and the only account that existed could not reach
user management. Now keyed on **no active admin**, and the claim *writes* the
row so the rule closes behind whoever uses it.

**Tailwind opacity on `var()` colours emits nothing.** `border-negative/35`,
`border-warning/40`, `bg-growth-500/20` were all dead classes — the error and
warning cards had been drawing invisible borders. Colours now go through a
`token()` helper in `tailwind.config.ts` returning `color-mix()` when an opacity
is requested. **Do not add a colour to that config as a bare `"var(--x)"`.**

**The ČNB rates file has two tables.** Per-month averages first, then cumulative
January-to-N under a near-identical header. Parsing the second gives 22.568
where the truth is 23.400 — wrong by ~1% and entirely plausible.

**A seasonal projection that invented growth.** Growth's YoY projection first
averaged the share-of-year from every prior complete year. Dobias's 2024 share
(28%) and 2025 (47%) differ because the Canadian store was separate until the
March 2026 merge — averaging them projected ~24% growth for a business whose
Jan–Jun was flat. Now uses the **most recent** complete year only.

---

## 6. Known data gaps the dashboard reports honestly

- **No refund data anywhere.** Return rate and return-adjusted margin are
  impossible. One job unlocks both: refetch the Shopify orders backfill with
  `totalRefundedSet`. It would also fix net sales being ~3% overstated.
- **`ref.fx_rates` expires monthly and fails silently** as a padlocked currency
  toggle. Runbook 23. Nobody automated it.
- **Inventory is one stale snapshot** (2026-05-19, Dobias only, 215 SKUs). The
  whole cash/inventory metric family is unavailable.
- **Klaviyo daily flow series stops 2026-06-20**, Dobias only — the runbook-20
  backfill was never wired to an ongoing sync. Flow figures are cumulative.
- **Klaviyo subscriber growth** blocked on a segment mirroring the master list.
- **GA4 not connected at all.** `/channels` says so.
- **Shoptet has no address in its payload**, so Manami has no country anywhere —
  market splits fall back to transacting currency, labelled as such.

---

## 7. Conventions worth not relearning

- **"No data" is never zero.** Nulls render as em dashes with a reason; unmeasured
  cost steps draw hatched, not zero-height.
- Rates are **recomputed from summed components**, never averaged from daily
  ratios (10–30% wrong — METRICS.md).
- Mart columns are already aggregates; **re-aggregating them fails** once
  BigQuery inlines the view. Roll up in TypeScript instead.
- The URL is the state — range, comparison, currency, client all live in search
  params, and nav links carry the query string.
- `--header-h` couples the sticky header and control bar; don't hardcode offsets.
