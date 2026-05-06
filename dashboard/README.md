# dashboard — Next.js 14 frontend

The custom Vercel-hosted dashboard. Phase 4 deliverable; MVP renders the clients registry + last-7-day revenue per client to prove end-to-end pipeline.

## Local dev

```bash
cd dashboard
cp .env.example .env.local
# fill in env vars (Google OAuth client + service account key)
npm install
npm run dev
# open http://localhost:3000
```

## Deploy to Vercel

```bash
cd dashboard
npx vercel link            # link to the oneeighty Vercel team
npx vercel env add         # add each env var (interactive)
npx vercel --prod          # ship
```

After first deploy, configure the custom domain `dashboard.oneeighty.cz` in Vercel project settings → Domains.

## Architecture

```
Browser
  ↓ (HTTPS)
Vercel Edge ──→ middleware.ts (auth gate)
  ↓                ↓ unauthenticated → /auth/signin
Server Component → lib/bigquery.ts → mart.mart_daily_kpis (read-only SA)
  ↓
HTML / streaming response
```

Key choices:
- **No client-side BQ access.** The browser never gets a credential. Everything goes through server components or API routes.
- **`sa-frontend-reader` has Data Viewer on `mart` only.** Cannot read raw PII tables.
- **Parameterized queries always.** `lib/bigquery.ts` exposes `query(sql, params)` — never use string interpolation for user input.
- **Domain-restricted SSO.** `lib/auth.ts` rejects any non-`@oneeighty.cz` email at sign-in.

## Adding a new page

1. Create `app/<route>/page.tsx` as a server component
2. Import `query` from `@/lib/bigquery`
3. Read from `mart.*` only (never `raw.*`)
4. Always include `WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL N DAY)` to satisfy `require_partition_filter` and keep cost ~free

## Env vars

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth client ID from GCP Console |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `NEXTAUTH_URL` | `http://localhost:3000` dev / `https://dashboard.oneeighty.cz` prod |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `ALLOWED_EMAIL_DOMAIN` | `oneeighty.cz` |
| `GCP_PROJECT_ID` | `oneeighty-warehouse` |
| `GCP_SERVICE_ACCOUNT_KEY_BASE64` | base64 of the `sa-frontend-reader` JSON key |
