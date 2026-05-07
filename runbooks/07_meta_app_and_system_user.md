# Runbook 07 — Meta App + System User + Token (Manami)

End-to-end click sequence to get Meta Ads + Instagram organic + Facebook organic data flowing into BigQuery. Multi-tenant ready: this same setup repeats for any future Meta-using client by changing the slug.

**Time estimate:** 30–45 minutes for setup + 10 minutes for sample collection.

**Prereqs:**
- [x] Full access (Admin) on Manami's Business Manager — confirmed.
- [x] Manami's Ad Account, Facebook Page, Instagram Business account exist in the BM.

---

## Step 1 — Create the Meta App (~5 min)

1. Go to https://developers.facebook.com → **My Apps** → **Create App**.
2. Use case: **Other** → **Next**.
3. App type: **Business** → **Next**.
4. Fill:
   - App name: `One Eighty Analytics`
   - App contact email: `matej@oneeighty.cz`
   - Business portfolio: select **Manami's Business Manager**.
5. Click **Create App** → enter your Facebook password if prompted.
6. You'll land on the app dashboard. **Stay in Development mode** — we never push to Live.

Note: don't add any "Use cases" / Products on the app dashboard. We don't need any of them; the System User path bypasses the typical OAuth flow.

7. **Settings → Basic** — note these two values, you'll need them later:
   - **App ID:** numeric (e.g. `1234567890`)
   - **App Secret:** click **Show** → enter your password → copy

---

## Step 2 — Create the System User (~3 min)

1. Open https://business.facebook.com → top-left → switch to **Manami's Business Manager**.
2. Left sidebar → **Settings (gear icon)** → **Users → System Users**.
3. **Add** → name `oneeighty-warehouse` → role **Admin** → **Create System User**.

(Admin is required because we need to assign the Ad Account + Page + Instagram. Employee role can't do that.)

---

## Step 3 — Assign assets to the System User (~5 min)

Still in **System Users**, with `oneeighty-warehouse` selected:

1. **Add Assets** → **Ad Accounts**:
   - Pick Manami's ad account.
   - Permission: **View Performance** (read-only) — that's all we need.
   - Save.
2. **Add Assets** → **Pages**:
   - Pick Manami's Facebook Page.
   - Permission: **Analyze**.
   - Save.
3. **Add Assets** → **Instagram Accounts**:
   - Pick Manami's IG Business account.
   - Permission: **View insights and content**.
   - Save.

Note the asset IDs as you go — you'll need them in Step 6:
- **Ad Account ID:** the number prefixed with `act_` (e.g. `act_1234567890`)
- **Facebook Page ID:** numeric
- **Instagram Business Account ID:** numeric (NOT your IG username)

You can also fetch these later via Graph API Explorer if you forget; they're in the asset detail pages.

---

## Step 4 — Generate the long-lived access token (~5 min)

Still on the System User page:

1. Click **Generate New Token** at the top.
2. Select your app: **One Eighty Analytics**.
3. Tick these scopes (read-only, no write):

| Scope | Why |
|---|---|
| `ads_read` | Marketing API — campaigns, adsets, ads, insights |
| `business_management` | Read the BM structure (assets, ownership) |
| `pages_read_engagement` | Page-level engagement metrics |
| `pages_show_list` | List pages owned by the BM |
| `read_insights` | Page Insights API (different from `pages_read_engagement`) |
| `instagram_basic` | IG account metadata, media list |
| `instagram_manage_insights` | IG media + account insights |

4. Set **Token expiration**: **Never** (System User tokens issued this way are permanent unless revoked).
5. **Generate Token** → copy immediately.

The token starts with `EAA…` and is ~200+ characters long. **Shown once** — if you lose it before saving, generate a new one (no harm).

---

## Step 5 — Drop everything into Secret Manager (~5 min)

Open Terminal. You need 6 secrets per client. For Manami:

```bash
PROJECT=oneeighty-warehouse
SLUG=manami

# Replace each <VALUE> below with what you collected above.
echo -n "<APP_ID>"             | gcloud secrets create meta-${SLUG}-app-id              --data-file=- --project=$PROJECT
echo -n "<APP_SECRET>"         | gcloud secrets create meta-${SLUG}-app-secret          --data-file=- --project=$PROJECT
echo -n "<ACCESS_TOKEN>"       | gcloud secrets create meta-${SLUG}-access-token        --data-file=- --project=$PROJECT
echo -n "act_<AD_ACCOUNT_ID>"  | gcloud secrets create meta-${SLUG}-ad-account-id       --data-file=- --project=$PROJECT
echo -n "<FB_PAGE_ID>"         | gcloud secrets create meta-${SLUG}-fb-page-id          --data-file=- --project=$PROJECT
echo -n "<IG_BUSINESS_ID>"     | gcloud secrets create meta-${SLUG}-ig-business-id      --data-file=- --project=$PROJECT

# Grant the n8n service account access to all 6
for s in app-id app-secret access-token ad-account-id fb-page-id ig-business-id; do
  gcloud secrets add-iam-policy-binding meta-${SLUG}-$s \
    --member="serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" \
    --project=$PROJECT
done
```

Verify:

```bash
gcloud secrets list --filter="name~meta-${SLUG}" --project=$PROJECT
```

Should list all 6.

---

## Step 6 — Update `ref.clients` (1 SQL)

In BigQuery Console:

```sql
UPDATE `oneeighty-warehouse.ref.clients`
SET has_meta = TRUE,
    has_instagram = TRUE,
    updated_at = CURRENT_TIMESTAMP()
WHERE slug = 'manami';
```

This flag drives which clients the eventual `wf_meta_ads` / `wf_instagram` / `wf_facebook_organic` workflows iterate over.

---

## Step 7 — Pull 7 sample JSON responses (~10 min)

Open https://developers.facebook.com/tools/explorer.

For each request below:
1. Top-right: select your app **One Eighty Analytics**.
2. Click **Get Token** → **Get User Access Token** → tick the same 7 scopes from Step 4 → **Generate**. (This is a different token from the System User token — expires in ~1 hour, only used to grab samples.)
3. Set **API version** to the latest stable (e.g. `v22.0`).
4. Paste the request, hit **Submit**, copy the full JSON response into the file path listed.

> 💡 Replace `<AD_ACCOUNT_ID>` with `act_<id>`, `<PAGE_ID>` and `<IG_BUSINESS_ID>` with the IDs from Step 3.

| # | Endpoint | Save as |
|---|---|---|
| 1 | `<AD_ACCOUNT_ID>/insights?level=campaign&date_preset=last_7d&fields=campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,cpc,actions,action_values,purchase_roas` | `infra/samples/meta_campaign_insights.json` |
| 2 | `<AD_ACCOUNT_ID>/insights?level=ad&date_preset=last_7d&fields=ad_id,ad_name,campaign_id,adset_id,spend,impressions,reach,frequency,clicks,ctr,cpc,actions,action_values,video_play_actions,video_thruplay_watched_actions` | `infra/samples/meta_ad_insights.json` |
| 3 | `<PAGE_ID>/posts?fields=id,message,created_time,permalink_url,attachments,insights.metric(post_impressions,post_engaged_users,post_clicks,post_reactions_by_type_total)&limit=5` | `infra/samples/fb_posts.json` |
| 4 | `<PAGE_ID>/insights?metric=page_impressions,page_post_engagements,page_video_views,page_fan_adds_unique,page_fan_removes_unique&period=day&date_preset=last_7d` | `infra/samples/fb_page_insights.json` |
| 5 | `<IG_BUSINESS_ID>/media?fields=id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count,insights.metric(reach,impressions,saved,shares)&limit=5` | `infra/samples/ig_media.json` |
| 6 | Same as #5 but filter to reels manually after fetching — pick a `media_type=VIDEO` item that's a reel and re-query: `<MEDIA_ID>?fields=id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count,insights.metric(reach,saved,shares,ig_reels_avg_watch_time,ig_reels_video_view_total_time,plays,total_interactions)` | `infra/samples/ig_reels.json` |
| 7 | `<IG_BUSINESS_ID>/insights?metric=reach,follower_count,profile_views,website_clicks&period=day&since=<UNIX_7_DAYS_AGO>&until=<UNIX_TODAY>` | `infra/samples/ig_account_insights.json` |

To get UNIX timestamps for #7: in any terminal, `date -v-7d +%s` (7 days ago) and `date +%s` (today) on macOS.

After saving the 7 files:

```bash
mkdir -p ~/Documents/Claude/Projects/one-eighty-dashboard/infra/samples
# move the 7 JSON files there
ls ~/Documents/Claude/Projects/one-eighty-dashboard/infra/samples
```

---

## Step 8 — Tell me when done

Reply with:
- ✅ Step 5: 6 secrets in Secret Manager (paste the `gcloud secrets list` output).
- ✅ Step 6: `ref.clients` updated.
- ✅ Step 7: 7 JSON files in `infra/samples/`.

Then I write:
- `infra/bigquery/009_create_raw_meta_ads.sql`
- `infra/bigquery/010_create_raw_instagram.sql`
- `infra/bigquery/011_create_raw_facebook.sql`
- `infra/n8n/wf_meta_ads.md` + `wf_meta_ads_to_bigquery.json`
- `infra/n8n/wf_instagram.md` + `wf_instagram_to_bigquery.json`
- `infra/n8n/wf_facebook_organic.md` + `wf_facebook_organic_to_bigquery.json`
- `infra/secrets/README.md` updated with the 6 new Meta secret names.

---

## Things to NOT do

- ❌ Don't push the app to **Live** mode. Stays in Development; the System User token works regardless.
- ❌ Don't paste the access token in chat, Slack, email, or any non-Secret-Manager location.
- ❌ Don't tick `ads_management`, `pages_manage_*`, or any `_write_` scope — read-only is the entire point.
- ❌ Don't use a personal token for production. The Graph API Explorer token is short-lived and only for sampling. The System User token is what the workflow uses.

---

## Token rotation (future)

System User tokens with `expiration: never` don't auto-expire, but Meta can invalidate them if:
- You change your Facebook password
- You remove yourself from the BM
- Meta revokes for security reasons

If a workflow run starts erroring with `OAuthException`, regenerate the token (Step 4), update Secret Manager:

```bash
echo -n "<NEW_TOKEN>" | gcloud secrets versions add meta-${SLUG}-access-token --data-file=- --project=$PROJECT
```

n8n auto-picks the latest version on next run. No workflow change needed.
