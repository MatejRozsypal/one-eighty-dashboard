/**
 * Editable list of accounts.
 *
 * Used twice: once per client under that client's settings, once for internal
 * staff under Team. Splitting the *rendering* would have meant two copies of
 * the role, active and remove controls drifting apart, so the difference
 * between the two is passed in rather than forked.
 *
 * `canManage` decides whether the controls render at all. Agency reaches these
 * screens to edit targets and cost assumptions, and should see who has access —
 * but changing it is the one operation that can reach another client's data, so
 * it stays with admin. The server actions each re-check that independently;
 * hiding the buttons is the courtesy, not the control.
 */

import type { AppUser } from "@/lib/users/store";
import type { Client } from "@/lib/clients";
import { Badge } from "@/components/ui/Badge";
import { deleteUserAction, updateUserAction } from "@/app/(app)/admin/actions";
import { ResetPasswordButton } from "@/app/(app)/admin/UserForms";

const ROLE_COPY: Record<string, { label: string; note: string }> = {
  admin: { label: "Admin", note: "Every client, plus access management" },
  agency: { label: "Agency", note: "Every client" },
  client: { label: "Client", note: "One client only" },
};

export function PeopleList({
  users,
  clients,
  canManage,
  /** When set, the role picker is hidden — everyone here is a client account. */
  fixedClient,
  emptyMessage,
}: {
  users: AppUser[];
  clients: Client[];
  canManage: boolean;
  fixedClient?: Client;
  emptyMessage: string;
}) {
  if (users.length === 0) {
    return <p className="text-[13px] text-content-muted">{emptyMessage}</p>;
  }

  return (
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

          {canManage && (
            <div className="flex flex-wrap items-end gap-3">
              <form
                action={updateUserAction}
                className="flex flex-wrap items-end gap-2.5"
              >
                <input type="hidden" name="id" value={user.id} />
                <input type="hidden" name="email" value={user.email} />

                {fixedClient ? (
                  <>
                    {/*
                      Inside one client's settings the role is not the question —
                      everyone listed is a client account for this client, and
                      offering "agency" here would grant every client from a
                      screen about one of them.
                    */}
                    <input type="hidden" name="role" value="client" />
                    <input
                      type="hidden"
                      name="clientId"
                      value={fixedClient.clientId}
                    />
                  </>
                ) : (
                  <>
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
                  </>
                )}

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
          )}
        </div>
      ))}
    </div>
  );
}
