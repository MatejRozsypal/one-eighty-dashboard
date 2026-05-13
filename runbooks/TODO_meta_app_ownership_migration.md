# TODO — Migrate Meta App ownership to One Eighty BM

**Current state:** The Meta App `One Eighty Warehouse` is owned by **Manami's Business Manager** (the wrong BM — should be agency-owned). Created accidentally during the original Manami onboarding when the app-creation wizard asked which Business Portfolio owns the app and we picked Manami's.

**Why fix:** an agency should own its own integration tooling. Today:
- If you stop working with Manami, they could in theory claim the app (their BM owns it).
- Adding a new client requires sharing the app from Manami's BM to that client's BM, which conceptually puts Manami in the middle of every client relationship.
- App-level rate limits, review status, and any future Standard Access submissions are tied to Manami's BM, not One Eighty.

**When to do it:** any time before the third client onboards. Not urgent — current sharing setup works fine for Manami + Dobias.

---

## Path A — Transfer ownership (preferred if One Eighty BM exists)

Requires One Eighty Agency to have its own verified Business Manager.

1. Create a One Eighty BM (if not yet existing) at https://business.facebook.com → **Create Account** → name `One Eighty Agency` → verify business identity (takes 1-3 days).
2. In Manami's BM → Settings → Apps → `One Eighty Warehouse` → look for **Transfer App** or **Change app's business** option.
3. Initiate transfer to One Eighty BM. Manami's admin (you or Peter or owner) approves.
4. Once transferred, re-share the app from One Eighty BM → Manami's BM and → Dobias's BM with **Develop app** permission.
5. **No workflow changes needed** — the App ID + Secret + tokens remain valid.

## Path B — Recreate under One Eighty BM (simpler if Path A is blocked)

1. Create One Eighty BM (as above).
2. Create a NEW Meta App from developers.facebook.com under One Eighty BM ownership.
3. In each client BM (Manami, Dobias), re-add the new app as an asset to the existing System User, generate new tokens.
4. Update Secret Manager:
   ```
   meta-manami-app-id            → new App ID
   meta-manami-app-secret        → new App Secret
   meta-manami-access-token      → new token
   meta-dobias-app-id            → new App ID (same as Manami)
   meta-dobias-app-secret        → new App Secret (same as Manami)
   meta-dobias-access-token      → new token
   ```
5. **Old app can be deleted** once tokens stop being used (or kept inactive for 30 days as fallback).
6. **No workflow changes needed.**

---

## Sub-todos when doing the migration

- [ ] Create One Eighty Business Manager
- [ ] Complete BM verification (business address, tax ID, etc.)
- [ ] Migrate or recreate app under One Eighty BM
- [ ] Update Secret Manager (new versions of `meta-*-app-*` if recreated)
- [ ] Regenerate System User tokens in each client BM
- [ ] Update `infra/secrets/README.md` to document the new ownership
- [ ] Delete old app (only after verifying new app workflows are stable for 7+ days)
