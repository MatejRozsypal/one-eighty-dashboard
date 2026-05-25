# Dobias Data Infrastructure — Handoff Proposal

**Prepared for:** Peter Dobias
**Prepared by:** Matěj Rozsypal (One Eighty)
**Date:** 2026-05-25

---

## TL;DR

You're asking to take the analytics infrastructure One Eighty built and run it inside Dr. Dobias's own organization. **This is a real engineering project — not a copy-paste task — and it cannot be delivered by end of this week.** A realistic phased timeline puts the running system in your hands in **5–6 weeks** of focused work, working within Matěj's 10-hour-per-week availability.

The system has 65+ source files, 16 SQL views, 7 ingestion workflows, 17 operational runbooks, integrates 5 data platforms, and runs 5 dashboard pages with ~50 documented business metrics. Building this took an order of magnitude more than 10 hours.

Two paths forward:

1. **Migrate it to your environment** (proposed below): 5-6 weeks at 10h/week. After handoff you need someone (internal hire or external contractor) to maintain it.
2. **Keep One Eighty running it** as a managed service: zero migration time, you get the same dashboards, we handle ops at an agreed monthly rate. Fastest path to value.

---

## What was built (so the scope is concrete)

| Component | Count | What it does |
|---|---:|---|
| BigQuery SQL DDL files | 16 | Define every table + view across raw, stg, mart layers |
| n8n ingestion workflows | 7 | Pull data from Shopify, Klaviyo, Meta Ads, Instagram, Facebook, on cron schedules |
| Runbooks (step-by-step procedures) | 17 | One-off operations: backfills, secret setup, app provisioning |
| Python helper scripts | 2 | Bulk-data transforms (Shopify orders/products) |
| Mart-layer business views | 12 | Pre-aggregated metrics tables Looker reads from |
| Documented business metrics | ~50 | CM1/2/3, Y1 LTGP, AOV split, aMER, CAC, ROAS, etc. — all in METRICS.md |
| Engineering commits to date | 34 | Git history of every change with reasoning |

This is real production infrastructure — not a spreadsheet exercise.

---

## Phased timeline

Working assumption: **Matěj has 10 hours per week available** for this project. Each phase is a complete checkpoint — at any phase boundary, the work is paused-safe.

### Phase 0 — This week (remaining ~2h)
**Goal:** Align scope + costs before any code moves.
- Confirm with Peter: deliverable scope, ownership of GCP billing, who maintains
- Send him this document + architecture diagram
- Get sign-off on phased timeline and commercial model
- **Deliverable:** signed-off plan, no code changes

### Phase 1 — Week of June 1 (10h): GCP Foundation
**Goal:** A working GCP project owned by Dr. Dobias.
- New GCP project `dobias-warehouse` (Peter as owner, billing on Dobias card)
- Enable BigQuery, Secret Manager, IAM
- Provision service accounts (writer + reader)
- Transfer all Dobias-specific secrets: Shopify OAuth credentials, Klaviyo API key, Meta access tokens, ad account IDs
- Document access for handover
- **Deliverable:** Empty but configured GCP project Peter owns

### Phase 2 — Week of June 8 (10h): BigQuery + Backfills
**Goal:** All historical data loaded into Peter's warehouse.
- Run 16 BigQuery DDL files (raw, stg, mart datasets — Dobias-only, Manami logic stripped)
- Initial backfills via runbooks:
  - Shopify orders (24 months, ~75k orders, via Bulk Operations API)
  - Shopify products + COGS (215 variants)
  - Klaviyo campaign reports (24 months, 408 email campaigns)
  - Klaviyo flow reports (24 months, 44 flows)
  - Meta Ads (12 months, ~5k campaign-day rows)
- Verify row counts and recent values match Shopify/Klaviyo/Meta dashboards
- **Deliverable:** Warehouse with 24 months of historical data, ready to query

### Phase 3 — Week of June 15 (10h): n8n Migration + Ongoing Sync
**Goal:** Live, autonomous data ingestion.
- Provision dedicated n8n instance (on Hostinger or Peter's preferred host)
- Import + edit 5 workflows for Dobias-only:
  - Shopify (every 3h)
  - Klaviyo campaigns + flows (every 6h)
  - Meta Ads (every 30 min)
  - Instagram organic (every 6h)
- Configure credentials in n8n
- Set up failure alerts (e.g., to Peter's email or ClickUp)
- Run for 48h to verify all crons fire and data flows
- **Deliverable:** Self-updating warehouse, no manual work needed

### Phase 4 — Week of June 22 (10h): Looker Dashboards
**Goal:** Peter's executive dashboards live.
- New Looker Studio reports in Peter's Google Workspace
- Connect data sources to Peter's BigQuery
- Recreate 5 dashboard pages:
  - Profitability (CM stack, EBITDA estimate)
  - Shop Performance (SKU, product, product_line split)
  - Email Marketing (campaigns + flows for both Ecomail & Klaviyo)
  - Meta Ads (campaign + ad performance)
  - Customer Lifetime (LTGP, Y1 LTGP, cohort analysis)
- Add ~25 Looker calc fields per METRICS.md
- Configure correct data-source bindings (no pre-divided ratios bound directly)
- **Deliverable:** Full dashboard suite running on Peter's data

### Phase 5 — Week of June 29 (10h): Testing + Knowledge Transfer
**Goal:** Verified, documented, handed off.
- End-to-end verification: every key number matches its source platform
- Hand off documentation: METRICS.md, PROJECT_LOG.md, all 17 runbooks
- 90-min live walkthrough with Peter (and whoever he designates to maintain)
- Punchlist resolution
- Final commit + push to a Dobias-owned GitHub repo
- **Deliverable:** Peter (or his designate) can operate the system independently

### Total: ~50 hours over 5–6 weeks at 10h/week.

---

## The ongoing maintenance question (important)

Once delivered, this system needs someone to:
- Monitor n8n workflow failures (~weekly check, occasionally needs intervention)
- Handle Meta token refreshes (every 60 days)
- Update Looker dashboards when business questions evolve
- Add new metrics or data sources as needed
- Debug data discrepancies when they surface

**Dr. Dobias does not currently have anyone in-house for this.** Two options:

### Option A — Dobias hires (internal or contractor)
- Cost: market rate for a data engineer / analytics engineer (rough US benchmark: $80–150/hr contractor; or part-time hire $50–80k/yr)
- Pro: full control
- Con: hiring delay, ramp time, ongoing payroll

### Option B — One Eighty manages as a service
- Cost: agreed monthly retainer (to be quoted)
- Includes: monitoring, alerting, monthly health check, support tickets, quarterly review meeting
- Pro: zero ramp time, the team that built it maintains it
- Con: ongoing dependency on agency relationship

**Recommendation:** start with Option B for at least 6 months post-handoff. Gives Peter time to evaluate whether to hire. We can transition to Option A later without losing knowledge.

---

## What the "end of week" expectation costs

If we attempt to compress this into 5 days at 10h max:
- We skip phase 0 alignment → scope creeps, redo work
- We skip verification → wrong numbers in production
- We skip documentation → no one but Matěj can maintain it
- We skip backfills → only forward-looking data, no historical view

The system would technically "exist" but would be unreliable, undocumented, and a liability. I strongly recommend the 6-week plan over the 5-day attempt.

---

## Decision points for Peter (in order)

1. **Is this scope correct?** (Dobias-only, full migration, you own it.)
2. **Phased 6-week timeline acceptable?** Or do you want to invest in additional engineering hours to compress?
3. **Maintenance after delivery — Option A or B?**
4. **GCP billing — your account or transitionally on One Eighty's with reimbursement?**

---

## Architecture diagram (see DOBIAS_ARCHITECTURE.md)

The accompanying architecture diagram shows what the running system looks like end-to-end. Worth 5 minutes — gives a sense of the scope of what was built and what's being handed over.
