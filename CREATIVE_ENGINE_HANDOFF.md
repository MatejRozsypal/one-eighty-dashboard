# Creative Engine — handoff prompt

> Paste the block below as the first message of a fresh Claude Code session in this repository.
> Everything it needs is already committed. Nothing about the design or the data model is left to
> guess: it was settled over a full working session with Matt and is written down.

---

## The prompt

```
Build the Creative Engine: a Meta creative-analytics surface inside the One Eighty dashboard.

READ FIRST, IN THIS ORDER, AND DO NOT SKIP ANY:
1. CREATIVE_ENGINE_BRIEF.md            the specification. Authoritative on data model and rules.
2. docs/creative-engine/DEMO.html       the approved UI. Open it in the browser pane and use it.
3. runbooks/27_clickup_to_bigquery.md   the ClickUp sync, including what does not exist yet.
4. runbooks/28_meta_creative_assets.md  creative assets, ad copy, breakdowns.
5. ../../../agency/_processes/meta-creative-engine/SOP_master.md  and 07-analyzing.md
   the decision logic. Do not re-derive it, execute it.
6. ../../../_clients/manami/learnings/meta-ads.md
   the empirical record this whole product exists to serve. Read every line.
7. METRICS.md and CLAUDE_CODE_BRIEF_V4.md  the existing dashboard's conventions and traps.

WHAT TO BUILD
A route group at /creative inside the existing dashboard/ Next.js app. Not a separate Vercel
project: reuse auth, resolveClient() tenancy, the BigQuery client and the design tokens.
Five screens, exactly as DEMO.html shows them: Creatives, Concepts, Breakdown, Velocity,
Production ROI. Clients at launch: manami and venev.

BUILD IN THIS ORDER. Do not reorder. Each phase must work before the next starts.

Phase 1  Warehouse. Create every table in CREATIVE_ENGINE_BRIEF.md section 4.1 as migration
         files in infra/bigquery/. Follow the numbering and the style of
         009_create_raw_meta_ads.sql exactly: partition by date, cluster by client_id, and set
         require_partition_filter = TRUE. Add the stg views and the mart. Do not invent columns.

Phase 2  Meta ingestion. Extend infra/n8n/wf_meta_ads_to_bigquery.json with the extra insight
         fields, and add the creatives job, the asset mirror to GCS, and the two breakdown jobs.
         Runbook 28 has the field lists and the endpoints. Verify in BigQuery before moving on.

Phase 3  ClickUp sync. New n8n workflow per runbook 27. This is the phase everything depends on,
         and it is the one with no existing precedent in the repo, so read the runbook twice.

Phase 4  Screen 1, Creatives, with the ad detail panel and the Unmapped ads queue including
         write-back to ClickUp.

Phase 5  Screen 2, Concepts, with angle coverage.

Phase 6  Screen 4, Velocity.

Phase 7  Screen 3, Breakdown. It stays behind a feature flag until at least 60% of spend carries a
         concept tag, because before that it reads less than half the account and will mislead.

Phase 8  Screen 5, Production ROI. Needs the ClickUp cost field populated first, so it ships last.

RULES THAT ARE NOT NEGOTIABLE
- Nothing sorts by ROAS. Every table and chart sorts by spend.
- Every aggregate ROAS is shrunk toward the account mean: (n*observed + 25*mean)/(n+25).
  Show the raw value beside it, but sort and colour on the shrunk one.
- Rows under 10 purchases are greyed and hatched, never hidden.
- Tag breakdowns default to lifetime-to-date, not a 30-day window.
- Ad level never produces a scale or kill verdict. Only ad-set and concept level do.
- A kill cannot be logged without a learning note. Enforce it in Postgres, not just the UI.
- Percentages display as whole numbers everywhere except CTR, hook rate and hold rate.
- Follow METRICS.md: only summable components cross a join, every rate is recomputed after
  aggregation, and never average a _per_day column.

WHEN YOU ARE DONE WITH EACH PHASE
Verify against the real warehouse, not fixtures. Report what you actually saw. Do not deploy;
Matt deploys with `npx vercel --prod --yes` from the repo root when he is ready.

ASK BEFORE ASSUMING on anything the brief does not cover. Matt has already answered a long list of
design questions and the answers are in the brief. Do not re-ask them.
```

---

## What was decided, so the next session does not relitigate it

| Question | Answer |
|---|---|
| Join key | Meta `ad_id` written into the ClickUp `Creative ID` field. Dashboard writes it back, humans do not copy IDs |
| Concept definition | Persona × Angle × Offer. Exactly one angle, exactly one persona per concept. Ads inherit and cannot override |
| Hook variants | Same concept, same body. Hierarchy is Persona → Concept → Body → Hook variant (one Meta ad) |
| Funnel stage | TOF / MOF / BOF. `RT` was removed from the SOP |
| Decision grain | Ad level for leading indicators, ad-set and concept level for money verdicts. Explicitly separated |
| Production cost | Ad level, from per-asset estimates in settings, manually overridable. Internal time counts |
| Ad-level metric | Revenue and ROAS only, no contribution margin. CM enters at concept level and above |
| Creative assets | Mirrored to a GCS bucket. Meta's URLs expire and cannot be stored |
| Ad copy | From `adcreative`, not ClickUp |
| Velocity unit | The pack, not the ad |
| Ad Library, Google banners | Out of scope for v1 |
| Owner of the Monday model | Lukáš |
| Clients at launch | manami, venev |

## Open questions Matt still has to answer

1. **Test-pack concurrency.** The learnings file says one live test pack at a time. The Velocity
   maths assumes it. Confirm it is deliberate: if two packs can run concurrently, ads per pack halves.
2. **Target ROAS calibration.** Three independent signals now say 2,50 is set too high for current
   AOV: the account's best ad set posts a CPA 14% better than target while its ROAS lands in the
   iterate zone; the account has zero ads clearing 2,50 at Read confidence; and the blended lifetime
   figure is 2,04. Review before the tool starts issuing iterate verdicts on things that work.
3. **UGC rates.** The pay-model enum is specified. The actual numbers are not.
4. **`max_ci_halfwidth`.** Defaulted to 0,25. It decides how often the tool says "not separable"
   instead of answering. Set once per client and do not move it to get a preferred answer.

## Known defects in the source systems, to fix before or during Phase 3

- **Venev's ad pipeline has two Concept relationship fields.** `05c15839-5c8c-4e43-98d5-39f5e4c4e994`
  is named plainly `Concept` and points at **Manami's** concept list (`901523916078`).
  `bcf4d0be-3b8c-46b6-975c-c3958fb5c77c` named `VEN: Concept` is the correct one
  (`901524795828`). Delete the stale field or the sync will silently attach Venev ads to Manami
  concepts. Runbook 27 pins the correct IDs.
- **`Creative ID` holds the literal string `"Creative ID"`** on all 65 Manami tasks. It is a
  placeholder, not data. Treat any value equal to the field name as null.
- **Status hygiene.** Almost every task sits at `live`, including ads killed in March. This does not
  corrupt the numbers, because delivery is read from Meta, but it makes the pipeline view useless.
- **Manami's own CPA figures are internally inconsistent.** The learnings file states a 527 Kč median
  CPA and a 215 Kč per-ad floor described as 0,5 × CPA, which implies 430 Kč. The demo uses the
  stated 215 and 860 figures because they match what PACK6 actually launched with. Ask Matt which
  is authoritative before hard-coding either.

## State of this branch

```
claude/meta-ads-analytics-system-e6c194

CREATIVE_ENGINE_BRIEF.md              the specification
CREATIVE_ENGINE_HANDOFF.md            this file
docs/creative-engine/DEMO.html        the approved UI, open it in the browser pane
runbooks/27_clickup_to_bigquery.md    ClickUp sync design and gaps
runbooks/28_meta_creative_assets.md   assets, copy, breakdowns

../../../agency/_processes/meta-creative-engine/SOP_master.md   edited: TOF/MOF/BOF, section 4.4
../../../agency/_processes/meta-creative-engine/06-publishing.md edited: naming, Creative ID step
```

Nothing has been deployed. No warehouse object has been created. No n8n workflow has been touched.
The SOP edits are the only changes outside this directory.
