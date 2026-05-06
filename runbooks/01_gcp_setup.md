# Runbook 01 — GCP project + BigQuery + service accounts

**Time:** 45–60 minutes
**Prerequisite:** Logged into your One Eighty Google account with billing rights
**Outcome:** GCP project live, BigQuery datasets created, two service accounts ready, all SQL files run.

---

## Step 1 — Create the GCP project

1. Open https://console.cloud.google.com/
2. Top bar → project dropdown → **NEW PROJECT**
3. Project name: `oneeighty-warehouse`
4. Project ID: `oneeighty-warehouse` (must be globally unique — if taken, append `-1`)
5. Organization: One Eighty (or "No organization" if you don't have a Workspace org yet)
6. Click **CREATE**, wait ~30s for it to finish provisioning
7. Top bar → switch to the new project

## Step 2 — Link billing

1. Left nav → **Billing**
2. Link a billing account (the One Eighty Google account should already have one)
3. Set a budget alert: **Budgets & alerts → CREATE BUDGET**
   - Name: `Warehouse cost guardrail`
   - Amount: **€20/month**
   - Alert thresholds: 50%, 90%, 100%
   - Email recipients: matej@oneeighty.cz

## Step 3 — Enable APIs

In Cloud Console search bar, search & enable each:
- [ ] **BigQuery API**
- [ ] **Secret Manager API**
- [ ] **Cloud Logging API**
- [ ] **IAM Service Account Credentials API**

Each one takes ~10s. The "ENABLE" button is on the API's product page.

## Step 4 — Create service accounts

Go to **IAM & Admin → Service Accounts → CREATE SERVICE ACCOUNT**.

### sa-n8n-writer
- Name: `sa-n8n-writer`
- ID: `sa-n8n-writer`
- Description: `n8n workflows write to raw + ops, read from Secret Manager`
- Click **CREATE AND CONTINUE**
- Roles to grant:
  - **BigQuery Job User** (project-wide)
  - **Secret Manager Secret Accessor** (project-wide)
- Click **CONTINUE → DONE**

### sa-frontend-reader
- Name: `sa-frontend-reader`
- ID: `sa-frontend-reader`
- Description: `Frontend Next.js reads mart only, never raw`
- Roles to grant:
  - **BigQuery Job User** (project-wide)
- (We'll grant Data Viewer on `mart` dataset specifically in Step 7 — narrower scope than project-wide.)

## Step 5 — Generate JSON keys

For **sa-n8n-writer** only (sa-frontend-reader gets its key later when we set up Vercel):

1. Click on `sa-n8n-writer` → **KEYS** tab → **ADD KEY → Create new key → JSON**
2. File downloads to `~/Downloads/oneeighty-warehouse-XXXXXX.json`
3. **Move it to a safe place temporarily:** `mv ~/Downloads/oneeighty-warehouse-*.json ~/Desktop/sa-n8n-writer-key.json`
4. We'll upload this to Secret Manager in Runbook 02 and then delete it from disk.

**Do not commit this file. Do not paste it into chat. Do not store it long-term on your laptop.**

## Step 6 — Run all SQL files

You have two options. Use whichever you're comfortable with.

### Option A — Cloud Console SQL Editor (no CLI)
1. Left nav → **BigQuery → SQL Editor**
2. Make sure region is **EU** in the workspace settings (top right)
3. Open `infra/bigquery/001_create_datasets.sql` from your local clone
4. Copy contents → paste into editor → **RUN**
5. Check left panel → confirm `raw`, `ref`, `stg`, `mart`, `ops` datasets appear under `oneeighty-warehouse`
6. Repeat for `002` through `008` in order

### Option B — `bq` CLI (faster)
From your terminal:
```bash
cd ~/Documents/Claude/Projects/one-eighty-dashboard
gcloud config set project oneeighty-warehouse
for f in infra/bigquery/00*.sql; do
  echo "=== Running $f ==="
  bq query --use_legacy_sql=false --location=EU < "$f"
done
```

## Step 7 — Tighten permissions on service accounts

Now that the datasets exist, narrow the service-account scopes:

```bash
# n8n-writer: editor on raw + ops only
bq add-iam-policy-binding \
  --member=serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com \
  --role=roles/bigquery.dataEditor \
  oneeighty-warehouse:raw

bq add-iam-policy-binding \
  --member=serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com \
  --role=roles/bigquery.dataEditor \
  oneeighty-warehouse:ops

# n8n-writer: reader on ref (so workflows can read clients registry)
bq add-iam-policy-binding \
  --member=serviceAccount:sa-n8n-writer@oneeighty-warehouse.iam.gserviceaccount.com \
  --role=roles/bigquery.dataViewer \
  oneeighty-warehouse:ref

# frontend-reader: viewer on mart only
bq add-iam-policy-binding \
  --member=serviceAccount:sa-frontend-reader@oneeighty-warehouse.iam.gserviceaccount.com \
  --role=roles/bigquery.dataViewer \
  oneeighty-warehouse:mart
```

## Step 8 — Verify

```bash
# Datasets exist
bq ls

# Clients registry has Manami + Dr Dobias
bq query --use_legacy_sql=false 'SELECT client_id, name, status FROM `oneeighty-warehouse.ref.clients` ORDER BY client_id'
```

Expected output:
```
+-----------+-----------------------------------+------------+
| client_id |               name                |   status   |
+-----------+-----------------------------------+------------+
| dr_dobias | Dr. Dobias Natural Pet Health     | onboarding |
| manami    | Manami s.r.o.                     | active     |
+-----------+-----------------------------------+------------+
```

If you see this, GCP foundation is done. Move to Runbook 02 (Secret Manager).

---

## Troubleshooting

**"User does not have bigquery.datasets.create permission"**
You're not a project owner. Check IAM role on your own account — should be `Owner` or `BigQuery Admin`.

**"Location EU not available"**
Free-tier projects are sometimes restricted to US. Check Cloud Console → BigQuery → top-right → make sure dataset region is `EU` in the create dialog. If you've already created in US, drop and recreate.

**"Invalid resource name projects/.../datasets/raw"**
Project ID typo. Confirm `gcloud config get-value project` returns `oneeighty-warehouse`.
