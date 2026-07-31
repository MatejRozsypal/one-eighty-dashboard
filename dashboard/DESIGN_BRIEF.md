# One Eighty Dashboard — design brief for Claude Design

Paste this into Claude Design. It is self-contained.

---

## 0. Use the existing design system

Load the **One Eighty Design System** project first:
`https://claude.ai/design/p/3d48c21c-6494-43a4-85aa-c2a184a5f465`

Everything below builds on it. Do not invent new colors, type scales, radii or shadows — every value must come from `tokens/`. Reuse `Card`, `Badge`, `Eyebrow`, `Stat`, `Button`, `Icon`, `Logo` rather than drawing new equivalents.

Two notes on applying it here:

- The design system's copy is **Czech** because it was reconstructed from the marketing site. **This product's UI is in English** — labels, metric names, dates, number formatting. Metric names must match the warehouse column names exactly (`CM3`, `MER`, `aMER`, `CAC`, `AOV`), because they are what the SQL and the metrics dictionary call them.
- The brand guide says "content-forward, no sidebars." That rule is about the marketing site. This is the product, and the guide explicitly reserves **dark near-black surfaces and platform colors (Shopify / Meta / Google / Klaviyo) for "product/dashboard UI."** This is that context. A dark sidebar is on-brand here.

---

## 1. What this is

An internal analytics dashboard for **One Eighty**, a Prague performance-marketing agency running e-shops on Shopify and Shoptet.

Today the agency reads its numbers in Looker Studio, which is slow, ugly and impossible to brand. Behind it sits a real data warehouse (BigQuery) with a clean, well-modelled metrics layer. This dashboard replaces the Looker front end.

**Phase 1 — the thing being designed now:** internal only. One user: Matěj, a founder. He opens it every morning on a laptop, and checks it on his phone during the day.

**Phase 2 — design for it, don't build it yet:** the same product shown to clients, one client per login. So the layout must not assume the viewer can see every client.

**The competitive point.** Retention tools in this space show repeat rate, cohort LTV and email performance. None of them show **contribution margin** — because they can't see cost of goods or ad spend. This warehouse can. So the headline page is a **P&L**, not a retention snapshot. That is the whole reason for building instead of buying, and the design should make the margin stack the hero, not bury it under vanity revenue.

---

## 2. Screens to design

In priority order. **Screen 1 is the one that matters** — take it to a finished state before moving on.

### Screen 1 — Profitability (the headline page)

The full picture of whether a client is actually making money. Proposed structure, adjust if you find better:

**A. Control bar** (sticky under the header)
- Date range picker with presets: Last 7 / 28 / 30 / 90 days, Month to date, Year to date, Last 12 months. Ranges end **yesterday**, never today — today is always partial and would look like a crash.
- Comparison selector: Previous period / Previous year / None. Show the resolved comparison dates as text, so it's never ambiguous what "vs" means.
- Currency toggle: Native / CZK. **Design its disabled state too** — exchange rates for USD→CZK don't exist yet, so for now it's disabled with a reason on hover.
- A "data through" timestamp. Shop data lands same-day; ad platforms are always a day behind. This must be visible, not hidden in a tooltip — a number that looks like a 30% drop is usually just an incomplete last day.

**B. Headline row** — four large metric cards with sparklines
`Revenue` · `CM3` · `CM3 %` · `Paid spend`

**C. The margin stack** — the signature section, and the thing no competitor has

Show how revenue becomes profit, as a waterfall or stepped bar:

```
Revenue  →  − COGS  →  CM1  →  − Fulfilment  →  CM2  →  − Paid spend  →  CM3
```

Design constraint: **Fulfilment is currently a placeholder of zero.** Real shipping, packaging and payment-fee data isn't wired yet, so CM1 and CM2 are identical today. The design must show this honestly — a visibly empty or hatched step labelled as not-yet-measured — rather than a step of size zero that reads as "we have no fulfilment costs." When that data lands, the step fills in and nothing else changes.

**D. Acquisition economics** — a row of smaller stats
`MER` · `aMER` · `CAC` · `AOV` · `New vs returning orders`

- **MER** = revenue ÷ paid spend (blended)
- **aMER** = first-time-customer revenue ÷ paid spend — the honest acquisition number
- **CAC** = paid spend ÷ new customer orders

**E. Revenue mix over time** — stacked area, new vs returning customer revenue

**F. Channel split** — Meta vs Google: spend, and efficiency per channel. Tag each with its platform badge. Some clients have only one channel; see the empty-state rules below.

### Screen 2 — Data Health (admin)

Boring on purpose, but it's what makes the numbers trustworthy.

- Per source (Shopify / Shoptet / Meta / Google / Klaviyo / Ecomail) per client: last date landed, expected freshness, OK / late / stale.
- Recent pipeline runs from a log table — timestamp, workflow, rows, status.
- **Registry drift warnings.** There are real, live examples to design against: the client registry says Dobias trades in CAD when every row is USD, and says Manami has no Google Ads when Google has been spending since October. These need a warning treatment that's serious without being alarming — they're data-quality issues, not outages.

### Screen 3 — App shell

- Left sidebar, dark (`--bg-inverse`). Logo, client switcher, nav. Green accent for the active item.
- Nav groups, mostly forward-looking: **Profitability** (Snapshot, Orders, Products) · **Marketing** (Paid, Email) · **Retention** (Cohorts, Repeat rate) · **Admin** (Data Health). Only Profitability → Snapshot and Data Health exist now; design the rest as visibly inactive so the shape of the product is legible.
- Header: current page, date range summary, user avatar / sign-out.

### Screen 4 — Mobile

Installs as a PWA to the iPhone home screen, so it must feel like an app, not a squeezed website.

- Sidebar collapses to a bottom tab bar or a drawer — your call, argue it.
- Metric cards stack one per row; sparklines stay.
- The margin waterfall needs a genuine mobile answer — a horizontal waterfall doesn't survive a 375px viewport. A vertical stepped list is probably right.
- Design the app icon and splash from the existing brand mark (`assets/logo/`). Don't redraw the mark.

---

## 3. Use these real numbers

Pulled live from the warehouse on 2026-07-30, last 30 days vs the 30 before. Use them verbatim — real data exposes layout problems that round fake numbers hide.

The two clients have deliberately opposite economics. **If the layout works for both, it works.**

### Dr. Dobias — USD, Shopify + Klaviyo + Meta
A mature, high-margin retention business. 79% of orders are repeat customers.

| Metric | Current | Previous | Change |
|---|---:|---:|---|
| Revenue | $204,974 | $190,257 | +7.7% |
| COGS | $41,910 | $38,771 | +8.1% |
| CM1 | $163,064 | $151,486 | +7.6% |
| **CM3** | **$153,479** | $143,937 | +6.6% |
| CM3 % | 74.9% | 75.7% | −0.8pp |
| Paid spend | $9,585 | $7,549 | +27.0% |
| — Meta | $9,585 | $7,549 | +27.0% |
| — Google | *no account* | *no account* | — |
| Orders | 1,346 | 1,274 | +5.7% |
| New / Returning orders | 281 / 1,065 | 281 / 993 | 0.0% / +7.3% |
| AOV | $152.28 | $149.34 | +2.0% |
| MER | 21.38× | 25.20× | −15.2% |
| aMER | 3.71× | 4.57× | −18.8% |
| **CAC** | **$34.11** | $26.86 | **+27.0%** |

There's a real story in this month worth designing for: **spend rose 27%, new customers didn't move at all, so CAC rose 27%.** Revenue still grew — carried entirely by returning customers. A dashboard that only shows revenue would call this a good month. It wasn't.

### Manami — CZK, Shoptet + Ecomail + Meta + Google
A growing, thin-margin acquisition business. 84% of orders are new customers.

| Metric | Current | Previous | Change |
|---|---:|---:|---|
| Revenue | 284,168 Kč | 221,722 Kč | +28.2% |
| COGS | 81,545 Kč | 71,296 Kč | +14.4% |
| CM1 | 202,623 Kč | 150,426 Kč | +34.7% |
| **CM3** | **105,826 Kč** | 65,495 Kč | +61.6% |
| CM3 % | 37.2% | 29.5% | +7.7pp |
| Paid spend | 96,797 Kč | 84,932 Kč | +14.0% |
| — Meta | 83,517 Kč | 64,981 Kč | +28.5% |
| — Google | 13,280 Kč | 19,951 Kč | −33.4% |
| Orders | 279 | 219 | +27.4% |
| New / Returning orders | 235 / 42 | 177 / 42 | +32.8% / 0.0% |
| AOV | 1,018.52 Kč | 1,012.43 Kč | +0.6% |
| MER | 2.94× | 2.61× | +12.6% |
| aMER | 2.22× | 1.91× | +16.2% |
| **CAC** | **411.90 Kč** | 479.84 Kč | **−14.2%** |

Note the ranges the design has to absorb: **CM3% of 37% next to 75%. MER of 2.9× next to 21.4×.** Neither is an error. Don't design gauges or progress bars with a fixed maximum — they will be wrong for one of these two clients.

---

## 4. Rules the design must encode

These are analytical requirements, not preferences. Each exists because getting it wrong makes the dashboard lie.

**1. Rising is not the same as good.**
Revenue up is good. COGS up is not. CAC up is not. Ad spend up is neither — it depends. The delta chip must separate *direction* (which way it moved — the arrow) from *sentiment* (whether that's good news — the color). Metrics with no inherent good direction render in muted gray, not green. On the Dobias card above, CAC +27.0% must read as **red**, and it sits directly beside Revenue +7.7% in green.

**2. "No data" and "zero" are different, and must look different.**
Dobias has no Google Ads account. Google spend is not `0 Kč` — it's *unknown*, and rendering zero claims we checked and found nothing. Design an explicit empty treatment. Same for Klaviyo subscriber growth, which has no data at all yet because a backfill is still blocked.

**3. Percentage points, not percent, for rates.**
CM3% moving 75.7 → 74.9 is **−0.8pp**, not −1.1%. Design the label accordingly; the distinction matters to anyone reading a margin.

**4. Every number is monospace with tabular figures.**
A brand rule that happens to also be a functional one — digits must occupy identical width or columns jitter between refreshes.

**5. Every metric card names its source.**
A platform badge, as on the reference tool. It's how you tell whether a figure is Shopify's truth or Meta's self-reported attribution — which matters enormously, because Meta over-attributes.

**6. Nothing is a fixed-max gauge.** See the ranges above.

---

## 5. States to design

Not decoration — these are the states this data actually produces.

- **Loading.** BigQuery takes 2–5 seconds on wide ranges. Skeletons, not a spinner blocking the page.
- **Empty** — source not connected for this client.
- **Empty** — connected but no data yet (backfill pending).
- **Partial** — last day incomplete because ad platforms report a day behind.
- **Error** — query failed or timed out.
- **Comparison off** — no delta chips anywhere; the layout must not collapse.
- **Mixed currency warning** — Dobias has a handful of stray CAD orders among USD ones. Summing them is meaningless; the design needs somewhere to say so.

---

## 6. Explicitly out of scope

Don't design these — it invites building features the warehouse can't feed:

- AI chat / "Ask" panel
- Report builder, saved reports, templates
- Anything writing back to the warehouse (the service account is read-only by design)
- Alerts and notifications
- Email flow-map visualisation

---

## 7. Deliverable

1. **Screen 1 (Profitability), desktop** — finished, using the real Dobias numbers.
2. **Screen 1 with the Manami numbers** — same layout, proving it holds for a 37%-margin, 2.9× MER business.
3. **Screen 1, mobile** at 375px.
4. **Screen 2 (Data Health)**, desktop.
5. **App shell** — sidebar, header, nav, client switcher, with the empty/inactive nav items visible.
6. **A states sheet** — the metric card in each state from §5.

For each screen, note which design system tokens and components you used, and flag anything where you had to invent something the system doesn't cover — those gaps are worth knowing about before they get built.
