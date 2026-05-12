# TODO — Facebook + Instagram completion

Pending work parked while we prioritize Shopify (Dobias), Klaviyo (Dobias), and Meta-for-Dobias. **All listed items are non-blocking for the dashboard MVP**: Meta Ads and Shopify already give Profitability, Shop Performance, FB Ads, and partial Email. IG media + IG account insights are nice-to-have; FB organic is lowest priority.

---

## 1. IG account insights — `wf_instagram_to_bigquery`

**Status:** Media branch ✅ flowing (~100 rows landed). Account insights branch ❌ failing with Meta error `(#10) Application does not have permission for this action`.

**Likely cause:** Generated System User token is missing `instagram_manage_insights` for the account-level (`/insights`) endpoint specifically (works fine for media-level which is why media branch succeeded).

**To resolve:**
1. business.facebook.com → Settings → Users → System Users → `oneeighty-warehouse` → **Generate New Token**.
2. Tick all 7 scopes — verify `instagram_manage_insights` AND `read_insights` are both ticked.
3. Generate → update `meta-manami-access-token` in Secret Manager (new version).
4. In n8n: re-activate the 4 disabled nodes (`Watermark account insights`, `Fetch account insights`, `Transform account insights`, `BQ: insert account insights`).
5. Execute Workflow → should land.

**If still erroring after token regen:** check token's actual scopes via Graph API Explorer `debug_token?input_token=<TOKEN>&access_token=<TOKEN>`. If `instagram_manage_insights` is in the list but endpoint still rejects, the IG account may be a Personal/Creator account rather than Business — only Business accounts get full Insights API access.

---

## 2. FB organic posts — `wf_facebook_organic_to_bigquery`

**Status:** ❌ Failing on `Fetch posts` with Meta error `(#10) This endpoint requires the 'pages_read_engagement' permission or 'Page Public Content Access' feature`.

**Cause 1 — missing scope:** Same root as #1 — the regenerated token didn't actually save `pages_read_engagement`. Verify via `debug_token`.

**Cause 2 — "new Pages experience" requirement:** Even with the scope present, Page-level endpoints require a **Page Access Token**, not a User/System User token. We hit this during sample collection (sample #3 errored with this exact reason).

**To resolve (after confirming scopes are present):**
1. Add a new HTTP Request node `Get Page Access Token` between `Decode secrets` and `Watermark posts`:
   - URL: `=https://graph.facebook.com/{{ $('Decode secrets').item.json.api_version }}/{{ $('Decode secrets').item.json.fb_page_id }}?fields=access_token`
   - Query param: `access_token` = `={{ $('Decode secrets').item.json.access_token }}`
2. In `Fetch posts`, change the `access_token` query param value from `{{ $('Decode secrets').item.json.access_token }}` to `{{ $('Get Page Access Token').item.json.access_token }}`.
3. Execute Workflow.

---

## 3. FB Page Insights — deferred from initial DDL

**Status:** Never built. `read_insights` scope wasn't grantable cleanly during sample collection.

**To resolve:**
1. Verify token has `read_insights` (after IG account insights fix above this should already be in place).
2. Create new DDL file `infra/bigquery/011a_create_raw_facebook_page_insights.sql` for the table (similar long-format to `raw_instagram_account_insights`).
3. Add a second branch to `wf_facebook_organic_to_bigquery` for `/<page_id>/insights?metric=page_impressions,page_post_engagements,page_video_views`.
4. Use the same Page Access Token from #2 above.

---

## 4. IG media — pagination cap

**Status:** ✅ Working but capped at 100 media items (the `limit` param in the Fetch URL).

**To resolve when needed:** Re-enable pagination in `Fetch media` HTTP node. Use **Response Contains Next URL** mode with expression `{{ $response.body.paging.next }}` and stop condition `{{ !$response.body.paging.next }}`. Limit pages fetched to 50 (safety).

---

## Effort estimate

- #1 + #2 + #4 together: ~30 min once you sit down (most of the work is token regeneration and node activation).
- #3: ~1 hour (new DDL + workflow branch + test).
