# dashboard: Next.js 14 frontend

The custom Vercel-hosted dashboard at `dashboard.oneeighty.cz`. It reads the BigQuery `mart` layer for every client in `ref.clients` and shows profitability, growth, orders, products, unit economics, paid, email, customers, retention, inventory, creative and data health. A fictional demo client ships with it for presentations (`lib/demo`).

## Local dev

`node`, `npm`, `npx` and `vercel` live in `~/.local/node/bin`, which is not on the default PATH.

```bash
export PATH="$HOME/.local/node/bin:$PATH"

# from the repo root: pull the env vars of the linked Vercel project
npx vercel env pull dashboard/.env.local

cd dashboard
npm install
npm run dev
# open http://localhost:3000
```

After the pull, edit `dashboard/.env.local` and set `NEXTAUTH_URL=http://localhost:3000`. The pulled value points at production, and sign-in redirects to it.

Without the pull you need `GCP_SERVICE_ACCOUNT_KEY_BASE64` (`sa-frontend-reader`), `DATABASE_URL`, `NEXTAUTH_SECRET` and the Google OAuth values. `.env.example` lists them. `.env*` is git-ignored. For a dev-only fallback, `gcloud auth application-default login` can stand in for the service account key.

Checks:

```bash
npx tsc --noEmit                                                        # types
npm run build                                                           # production build
npm run check:capabilities                                              # nav and page availability per client
npm run check:warehouse                                                 # every query against BigQuery (needs credentials)
```

## Deploy to Vercel

Run from the repo root, after the owner's OK. The Vercel project's root directory is `dashboard/`, and git pushes do not deploy (see `VERCEL_DEPLOYS.md` in the repo root).

```bash
npx vercel --prod --yes
```

The custom domain `dashboard.oneeighty.cz` is set in the Vercel project settings.

## Architecture

```
Browser
  ↓ (HTTPS)
Vercel ──→ app/(app)/layout.tsx (session check, no middleware)
  ↓            ↓ no session → /auth/signin
Server Component → lib/queries/* → lib/bigquery.ts → mart.* (read-only SA)
  ↓
HTML / streaming response
```

Key choices:
- **No client-side BQ access.** The browser never gets a credential. Everything goes through server components or API routes.
- **The layout is the auth gate.** There is deliberately no `middleware.ts`: next-auth's `withAuth` does not bundle for the Edge runtime. `app/(app)/layout.tsx` checks the session in the same place the queries run.
- **`sa-frontend-reader` has Data Viewer on `mart` only.** Cannot read raw PII tables.
- **Parameterized queries always.** `lib/bigquery.ts` exposes `query(sql, params)`. Never use string interpolation for user input.
- **Sign-in:** Google SSO for the allowed domain, plus email and password accounts stored in Postgres (`lib/users`). Roles are admin, agency and client. A client user sees exactly one client.
- **Capabilities decide what a client sees.** `lib/capabilities.ts` reads the `ref.clients` flags. Pages a client has no source for are hidden from the nav and show "{Source} not connected." if opened by URL.
- **Missing is not zero.** All formatters in `lib/format.ts` return `n/a` for null. Never write `?? 0` for a value that can be missing.

## Copy rules

UI text is minimal. Page headers are the title only, empty states are one line from `components/ui/EmptyState.tsx`, notices come from a closed list (`components/ui/Notice.tsx`), and definitions live in tooltips (`lib/metrics.ts`, `InfoTip`). No em dashes anywhere, no table names or client names in UI strings, numbers only through `lib/format` and `lib/currency` (en-US).

## Adding a new page

1. Create `app/(app)/<route>/page.tsx` as a server component
2. Add the route to `lib/nav.ts` and its required source to `lib/capabilities.ts`
3. Start the page with `pageAvailability(client, href)` and render `NotConnected` when it is not available
4. Read from `mart.*` only (never `raw.*`), through a function in `lib/queries/`
5. Always include a date filter such as `WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL N DAY)` to satisfy `require_partition_filter` and keep cost near zero

## Env vars

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth client ID from GCP Console |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `NEXTAUTH_URL` | `http://localhost:3000` dev, `https://dashboard.oneeighty.cz` prod |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `ALLOWED_EMAIL_DOMAIN` | `oneeighty.cz` |
| `GCP_PROJECT_ID` | `oneeighty-warehouse` |
| `GCP_SERVICE_ACCOUNT_KEY_BASE64` | base64 of the `sa-frontend-reader` JSON key |
| `DATABASE_URL` | Postgres for users, settings and the access log (`POSTGRES_URL` also works) |
| `CLICKUP_API_TOKEN` | Creative Engine tasks and notes (optional, the feature reports "ClickUp not connected." without it) |
