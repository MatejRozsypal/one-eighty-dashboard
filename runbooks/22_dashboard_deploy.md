# Runbook 22 — Deploy the dashboard to `dashboard.oneeighty.cz`

The Next.js app in `dashboard/` is built and passes `npm run build`. What's left is
credentials, a Vercel project, and DNS. Roughly 45 minutes, most of it waiting for
DNS.

Everything below needs either a Google Cloud console login or a Vercel login, so
it has to be done by a human — none of it can be scripted from a Claude session.

---

## 0. Prerequisites

- Owner (or Editor) on the `oneeighty-warehouse` GCP project
- Access to the Vercel team that will own the project
- DNS control for `oneeighty.cz`

---

## 1. Create the read-only service account

The app must never read raw PII. That is enforced by the grant, not by the code.

```bash
gcloud config set project oneeighty-warehouse

gcloud iam service-accounts create sa-frontend-reader \
  --display-name="Dashboard frontend (read-only, mart)"
```

Grant Data Viewer on **`mart` only** — not on the project:

```bash
bq add-iam-policy-binding \
  --member="serviceAccount:sa-frontend-reader@oneeighty-warehouse.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer" \
  oneeighty-warehouse:mart
```

The account also needs Job User at project level, because running a query is a
project-level operation even when the data it touches is not:

```bash
gcloud projects add-iam-policy-binding oneeighty-warehouse \
  --member="serviceAccount:sa-frontend-reader@oneeighty-warehouse.iam.gserviceaccount.com" \
  --role="roles/bigquery.jobUser"
```

### Optional — `ref` and `ops`

Two pages want datasets outside `mart`:

| Dataset | Used by | Consequence if not granted |
|---|---|---|
| `ref` | Client switcher, currency, FX coverage | **The app will not start.** `ref.clients` is required. |
| `ops` | Data Health → recent pipeline runs | Section renders an explanatory note instead of the table. Everything else works. |

`ref` is mandatory:

```bash
bq add-iam-policy-binding \
  --member="serviceAccount:sa-frontend-reader@oneeighty-warehouse.iam.gserviceaccount.com" \
  --role="roles/bigquery.dataViewer" \
  oneeighty-warehouse:ref
```

`ops` is optional — grant it only if you want the pipeline-runs table. It holds no
PII, so it's a safe grant, just not a required one.

### Authorized datasets — the step that is easy to miss and breaks everything

**Granting READER on `mart` is not sufficient.** Every object in `mart` is a *view*
over `stg`, and BigQuery requires the caller to hold access to the underlying tables
too — unless those datasets explicitly authorize the querying dataset.

Without this the app builds, deploys, signs in, and then every page 500s with
`Access Denied: Table oneeighty-warehouse:stg.…`.

Authorizing the datasets is what preserves least privilege: the service account still
**cannot** query `stg`, `raw` or `raw_google_ads` directly — only through `mart` views.

```bash
auth_ds() {   # $1 = dataset to modify, $2 = dataset it should authorize
  bq show --format=prettyjson oneeighty-warehouse:$1 > /tmp/a.json
  jq --arg d "$2" 'if any(.access[]; .dataset.dataset.datasetId==$d) then . else
     .access += [{"dataset":{"dataset":{"projectId":"oneeighty-warehouse","datasetId":$d},
     "targetTypes":["VIEWS"]}}] end' /tmp/a.json > /tmp/b.json
  bq update --source /tmp/b.json oneeighty-warehouse:$1
}

auth_ds stg            mart
auth_ds raw            stg
auth_ds raw            mart
auth_ds ref            mart
auth_ds raw_google_ads stg     # Google Ads DTS lives OUTSIDE `raw`
auth_ds raw_google_ads mart
```

> `raw_google_ads` is the one people forget. `mart_daily_kpis` reaches it through
> `stg_google_ads_campaign_insights`, so **that single view fails while all others
> succeed** — which looks like a problem with the KPI view rather than a grant.

**Whenever a new source dataset is added, authorize it here too**, or the Snapshot
will start failing the moment a mart view begins reading from it.

### Key

```bash
gcloud iam service-accounts keys create /tmp/sa-frontend-reader.json \
  --iam-account=sa-frontend-reader@oneeighty-warehouse.iam.gserviceaccount.com

base64 -i /tmp/sa-frontend-reader.json | pbcopy   # now on your clipboard
rm /tmp/sa-frontend-reader.json                   # delete it immediately
```

---

## 2. OAuth client

GCP Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**

- Type: **Web application**
- Name: `One Eighty Dashboard`
- Authorised JavaScript origins:
  - `https://dashboard.oneeighty.cz`
  - `http://localhost:3000`
- Authorised redirect URIs:
  - `https://dashboard.oneeighty.cz/api/auth/callback/google`
  - `http://localhost:3000/api/auth/callback/google`

Keep the client ID and secret.

> The redirect URI must match **exactly**, including the scheme and the absence of
> a trailing slash. A mismatch produces `redirect_uri_mismatch` at sign-in and
> nothing in the app logs explains it.

---

## 3. Vercel project

```bash
cd dashboard
npx vercel link          # pick the One Eighty team, name the project one-eighty-dashboard
```

Set the environment variables. Do these one at a time — `vercel env add` reads the
value from stdin so nothing lands in your shell history:

```bash
npx vercel env add GOOGLE_CLIENT_ID production
npx vercel env add GOOGLE_CLIENT_SECRET production
npx vercel env add NEXTAUTH_SECRET production          # openssl rand -base64 32
npx vercel env add NEXTAUTH_URL production             # https://dashboard.oneeighty.cz
npx vercel env add ALLOWED_EMAIL_DOMAIN production     # oneeighty.cz
npx vercel env add GCP_PROJECT_ID production           # oneeighty-warehouse
npx vercel env add GCP_SERVICE_ACCOUNT_KEY_BASE64 production   # paste from step 1
```

Repeat for the `preview` environment if you want preview deploys to work, with
`NEXTAUTH_URL` left unset there (NextAuth derives it from the deployment URL).

Ship it:

```bash
npx vercel --prod
```

---

## 4. Domain

Vercel project → **Settings → Domains → Add** → `dashboard.oneeighty.cz`.

Vercel will give you a CNAME. Add it at the registrar:

```
dashboard  CNAME  cname.vercel-dns.com.
```

Propagation is usually minutes. The TLS certificate issues automatically once the
record resolves.

**After the domain is live**, go back and confirm `NEXTAUTH_URL` is exactly
`https://dashboard.oneeighty.cz`. If it still points at a `*.vercel.app` URL,
sign-in will redirect to the wrong host and appear to silently fail.

---

## 5. Warehouse migration — `mart_order_gaps`

The **Time between orders** screen reads `mart.mart_order_gaps`, which doesn't
exist yet. Until it's deployed the page renders an honest "not computed yet"
state; everything else works.

```bash
bq query --use_legacy_sql=false --project_id=oneeighty-warehouse \
  < infra/bigquery/208_mart_order_gaps.sql
```

Additive and non-destructive — it creates one new view and touches nothing else.
The view exposes gap lengths only, no customer identifier, so no PII crosses into
`mart`.

Verify:

```sql
SELECT client_id, COUNT(*) AS gaps, APPROX_QUANTILES(gap_days, 100)[OFFSET(50)] AS median
FROM `oneeighty-warehouse.mart.mart_order_gaps`
GROUP BY client_id;
```

Expected for Dobias: roughly 21,000 gaps, median ≈ 59 days.

---

## 6. Registry fixes (recommended before showing anyone)

Two rows in `ref.clients` disagree with the warehouse. The dashboard detects both
and reports them on **Data Health → Registry drift**, so nothing is hidden — but
until they're fixed, Dobias's figures carry the wrong currency symbol.

```sql
-- Dobias trades in USD. The registry still says CAD, from a superseded assumption.
UPDATE `oneeighty-warehouse.ref.clients`
SET currency = 'USD', updated_at = CURRENT_TIMESTAMP()
WHERE client_id = 'dobias';

-- Manami has been running Google Ads since 2025-10 (~19k CZK/month into CM3).
UPDATE `oneeighty-warehouse.ref.clients`
SET has_gads = TRUE, updated_at = CURRENT_TIMESTAMP()
WHERE client_id = 'manami';
```

Reload Data Health afterwards — both warnings should clear.

---

## 7. Install as an app

Once live, the PWA manifest makes it installable.

- **macOS / Chrome:** open `dashboard.oneeighty.cz` → install icon in the address
  bar → *Install*. It lands in the Applications folder and the dock.
- **iPhone / Safari:** Share → *Add to Home Screen*. Launches without the browser
  chrome; the status bar blends into the dark app bar.

---

## 8. Verification checklist

| Check | Expected |
|---|---|
| `/` redirects | → `/snapshot` |
| Sign-in with a non-`@oneeighty.cz` account | Rejected, lands on the explanatory error page |
| Snapshot → Revenue | ≈ $205k for Dobias on Last 30 days |
| Snapshot → CAC delta | **Red** while Revenue delta is green (polarity is correct) |
| Snapshot → currency toggle | `USD → CZK` disabled with a padlock (no FX rates yet) |
| Client switcher | Manami's figures in CZK, Google card populated |
| Data Health | Two drift warnings, unless step 6 was applied |
| Channels | GA4 "not connected", stated not hidden |
| Mobile at 375px | Bottom tab bar, margin stack as a vertical list |

---

## Two failures hit during the first deploy — read before debugging

Both produced symptoms that pointed away from the actual cause.

### Framework Preset was "Other", so nothing was ever built

The Vercel project pre-dated the app by two months and had **Framework Preset =
Other**. With that setting Vercel never runs `next build`; it looks for a static
directory, finds none, and publishes an empty deployment. Every route returned
`404` with `x-vercel-error: NOT_FOUND` — which reads like a routing or domain
problem, and isn't.

The tell is in `vercel inspect <deployment>`: the **Builds and Aliases sections
are both empty**. A real Next.js deployment lists both. Check that first when a
deployment is "Ready" but serves nothing.

Fix: Settings → Build and Deployment → Framework Preset → **Next.js** → Save,
then redeploy. Vercel then warns that the live deployment differs from project
settings, which confirms the change took.

### `next-auth/middleware` does not survive the Edge runtime

The original `middleware.ts` used `withAuth` from `next-auth/middleware`. It
builds fine locally and fails at runtime on Vercel with:

```
ReferenceError: __dirname is not defined
```

Because middleware runs on *every* request, this returned `500` for the entire
site — including `/auth/signin`, so there was no way to log in and no obvious
place to look.

Fix: there is now **no `middleware.ts`**. The session is enforced in
`app/(app)/layout.tsx`, which wraps every data-bearing route and runs in the
same place as the BigQuery queries it protects. That is stricter than an edge
gate, not weaker — a misconfigured matcher can let a route through; a layout
cannot, because the check and the data live in the same function.

Don't reintroduce middleware for auth without testing a real deployment.

---

## Known gaps at launch

Not blockers — they render as explicit empty states:

- **GA4 not connected.** No traffic, channel or funnel data exists anywhere in
  the warehouse. The Channels page says so.
- **Google Ads has no mart view.** Spend totals come from `mart_daily_kpis` and
  work; per-campaign Google detail does not exist.
- **Klaviyo subscriber growth** is blocked on a segment mirroring the master list
  (runbook 21).
- **No USD→CZK FX rates**, so the CZK rollup toggle stays disabled. `ref.fx_rates`
  holds only CAD→USD, last refreshed 2026-05-01 by hand.
- **Orders, Products, Email, Cohorts, Repeat rate** are in the nav marked "Soon".
  The warehouse can feed all five; the pages aren't built.
