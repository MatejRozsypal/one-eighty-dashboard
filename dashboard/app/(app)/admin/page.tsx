/**
 * Admin — who can open this dashboard, and what they can see.
 *
 * Scope is deliberately narrow: this manages **access to the app**, not the
 * warehouse. Client configuration still lives in `ref.clients` and is still
 * changed with SQL, because that is business data an analyst reads, not
 * credentials.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClients } from "@/lib/clients";
import { listUsers, type AppUser } from "@/lib/users/store";
import { userStoreConfigured } from "@/lib/users/db";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Badge } from "@/components/ui/Badge";
import { pageEyebrow } from "@/lib/nav";
import { CreateUserForm, ResetPasswordButton } from "./UserForms";
import { deleteUserAction, updateUserAction } from "./actions";

export const metadata: Metadata = { title: "Users & access" };
export const dynamic = "force-dynamic";

const ROLE_COPY: Record<string, { label: string; note: string }> = {
  admin: { label: "Admin", note: "Every client, plus this screen" },
  agency: { label: "Agency", note: "Every client" },
  client: { label: "Client", note: "One client only" },
};

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  // The nav hides this from non-admins; this is the check that actually holds.
  if (session?.user?.role !== "admin") {
    redirect("/snapshot");
  }

  const header = (
    <Header eyebrow={pageEyebrow("/admin", "")} title="Users & access" />
  );

  if (!userStoreConfigured()) {
    return (
      <>
        {header}
        <main className="flex max-w-[820px] flex-col gap-4 px-5 pb-14 pt-6 lg:px-8">
          <div className="flex flex-col gap-3 rounded-card border border-warning/40 bg-[#FFF9EE] p-[22px_24px]">
            <span className="self-start">
              <Badge variant="neutral" size="sm" dot>
                Not connected
              </Badge>
            </span>
            <span className="text-[15px] font-semibold text-content-strong">
              No user store is attached yet.
            </span>
            <div className="flex flex-col gap-2 text-[13px] leading-[1.65] text-content-body">
              <span>
                User accounts live in Postgres, deliberately not in BigQuery —
                password hashes have no business sitting in an analytics
                warehouse that several service accounts can read.
              </span>
              <span>To finish setting this up:</span>
              <ol className="ml-4 flex list-decimal flex-col gap-1">
                <li>
                  Vercel project → <strong>Storage</strong> → Create Database →
                  Neon Postgres. It adds <code className="font-mono">DATABASE_URL</code> automatically.
                </li>
                <li>
                  Run <code className="font-mono">dashboard/lib/users/schema.sql</code> against it.
                </li>
                <li>Redeploy. This screen then lists users instead of this note.</li>
              </ol>
              <span className="text-content-muted">
                Until then every {process.env.ALLOWED_EMAIL_DOMAIN ?? "oneeighty.cz"} Google
                account signs in as admin, exactly as before — attaching the
                database is what starts enforcing roles.
              </span>
            </div>
          </div>
        </main>
      </>
    );
  }

  let users: AppUser[] = [];
  let loadError: string | null = null;
  try {
    users = await listUsers();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Could not read the user store.";
  }

  const clients = await getClients();

  return (
    <>
      {header}
      <main className="flex max-w-[1080px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {loadError && (
          <div className="rounded-card border border-negative/35 bg-[#FFF7F7] p-[16px_18px] text-[13px] text-content-strong">
            {loadError} — has <code className="font-mono">schema.sql</code> been run?
          </div>
        )}

        <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
          <div className="flex flex-col gap-[5px]">
            <Eyebrow>Add someone</Eyebrow>
            <span className="text-[12.5px] leading-[1.5] text-content-muted">
              They sign in with the email and the temporary password you hand
              over, then pick their own.
            </span>
          </div>
          <CreateUserForm clients={clients} />
        </section>

        <section className="flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]">
          <Eyebrow>People with access · {users.length}</Eyebrow>

          {users.length === 0 && !loadError && (
            <span className="py-4 text-[13px] text-content-muted">
              Nobody yet. While this table is empty, any{" "}
              {process.env.ALLOWED_EMAIL_DOMAIN ?? "oneeighty.cz"} Google account
              can still sign in as admin — that is the way back in. Adding the
              first user closes it.
            </span>
          )}

          <div className="flex flex-col gap-3">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex flex-col gap-3 border-b border-hairline pb-3 last:border-0"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="font-mono text-[13px] font-semibold text-content-strong">
                    {user.email}
                  </span>
                  {user.name && (
                    <span className="text-[12.5px] text-content-muted">{user.name}</span>
                  )}
                  <Badge variant={user.isActive ? "positive" : "neutral"} size="sm">
                    {user.isActive ? ROLE_COPY[user.role].label : "Disabled"}
                  </Badge>
                  {user.mustChangePassword && (
                    <Badge variant="neutral" size="sm" dot>
                      Temporary password
                    </Badge>
                  )}
                  {!user.hasPassword && (
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                      Google only
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-content-muted">
                    {user.lastLoginAt
                      ? `last in ${user.lastLoginAt.slice(0, 10)}`
                      : "never signed in"}
                  </span>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <form
                    action={updateUserAction}
                    className="flex flex-wrap items-end gap-2.5"
                  >
                    <input type="hidden" name="id" value={user.id} />
                    <input type="hidden" name="email" value={user.email} />

                    <select
                      name="role"
                      defaultValue={user.role}
                      className="rounded-control border border-hairline-strong bg-paper px-2.5 py-1.5 text-[12.5px]"
                    >
                      {Object.entries(ROLE_COPY).map(([value, copy]) => (
                        <option key={value} value={value}>
                          {copy.label} — {copy.note}
                        </option>
                      ))}
                    </select>

                    <select
                      name="clientId"
                      defaultValue={user.clientId ?? ""}
                      className="rounded-control border border-hairline-strong bg-paper px-2.5 py-1.5 text-[12.5px]"
                    >
                      <option value="">— no client —</option>
                      {clients.map((c) => (
                        <option key={c.clientId} value={c.clientId}>
                          {c.name}
                        </option>
                      ))}
                    </select>

                    <label className="flex items-center gap-1.5 text-[12.5px] text-content-body">
                      <input
                        type="checkbox"
                        name="isActive"
                        defaultChecked={user.isActive}
                      />
                      Active
                    </label>

                    <button
                      type="submit"
                      className="rounded-control border border-hairline-strong px-2.5 py-1.5 font-mono text-[11px] text-content-body transition-colors duration-fast hover:bg-gray-50"
                    >
                      Save
                    </button>
                  </form>

                  <ResetPasswordButton user={user} />

                  <form action={deleteUserAction}>
                    <input type="hidden" name="id" value={user.id} />
                    <input type="hidden" name="email" value={user.email} />
                    <button
                      type="submit"
                      className="rounded-control border border-negative/35 px-2.5 py-1.5 font-mono text-[11px] text-negative transition-colors duration-fast hover:bg-[#FFF7F7]"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
