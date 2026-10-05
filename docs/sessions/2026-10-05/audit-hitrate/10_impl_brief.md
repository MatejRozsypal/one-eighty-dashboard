# Implementation brief: Meta engine audit follow-up (ME1 to ME4)

Source of truth: `03_audit.md` in this folder (changes C1 to C10, SOP edits E1 to E10, decisions D1 to D6). Owner decisions (2026-10-05):
- D1 YES: the dashboard winner (lifetime purchases >= N AND shrunk ROAS >= target) is the official "creative winner"; the SOP three-part rule becomes "graduation". Owner notes they run fewer scaling campaigns now and may revise the whole SOP later, so keep SOP edits minimal and clearly marked.
- D2: 14-day evaluation period with per-period purchase floor N. D3: store both 7d_click and 1d_view, decide on 7d click, truthful label.
- D4: relative hook/hold floors per client (p25 of genuine video ads, trailing 180 days, min 15 ads, fallback 20% / 5%), diagnostic only.
- D5: Settings is the source of truth, mirrored into a per-client KPI file in the Second Brain repo (Manami 2.25, Dobias 3.00 as saved). D6: reference line = client's own trailing 12-month hit rate (no fixed 5%).
Also do without asking: C1 (is_video = video starts >= 30% of impressions OR video asset), C3 (one winner test, one anchor = stored 365-day prior everywhere; green tile only for read winners, "promising" tone for directional; rename scorecard tile "Winners with delivery in period"; Production "Net-new hit rate" uses hitRate() on the launch cohort filtered to Net New or is renamed), C4 (hit rate independent of targetCpa; fix CPA currency label), C6 (show refreshed_at; suppress tile delta while maturing), C7 (hit rate by launch context new ad set vs existing; pack-level hit rate), C8 (Ethia asset ingest), C9 (winner must be >= 14 days old), C10.

Column contract between ME1 (warehouse) and ME3 (dashboard) for `mart.rpt_ad_launch` (additive, same names kept): `is_video` (fixed semantics per C1), `video_start_share` FLOAT64, `adset_first_date` DATE, `is_new_adset` BOOL (ad's first delivery within 2 days of its ad set's first delivery), `adset_id` already present. ME3 codes against this contract and treats missing columns as not ready.

General rules: `../00_agent_rules.md` (worktrees, ownership, no em dashes, BigQuery writes only in mart_qa with your prefix unless your package says prod is approved, commit with your own Co-Authored-By line, do not push), verification without login per `../qa/21_fix_brief.md`.
