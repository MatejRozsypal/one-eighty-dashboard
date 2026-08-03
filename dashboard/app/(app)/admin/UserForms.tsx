"use client";

/**
 * Client half of the admin screen — the bits that need form state.
 *
 * The temporary password is the one thing here that cannot be re-read: it is
 * returned by the action, rendered once, and then only exists wherever the
 * admin copied it to. So it gets a loud, deliberate panel rather than a toast
 * that can be missed by looking away.
 */

import { useFormState, useFormStatus } from "react-dom";
import { useState } from "react";
import { createUserAction, resetPasswordAction, type ActionResult } from "./actions";
import type { AppUser, Role } from "@/lib/users/store";
import type { Client } from "@/lib/clients";

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-control bg-ink-900 px-4 py-2 text-[13px] font-medium text-content-inverse transition-colors duration-fast hover:bg-ink-800 disabled:opacity-50"
    >
      {pending ? busy : label}
    </button>
  );
}

function TemporaryPassword({ result }: { result: ActionResult }) {
  if (!result.temporaryPassword) return null;
  return (
    <div className="flex flex-col gap-2 rounded-card border border-accent bg-accent-soft p-[14px_16px]">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-growth-700">
        Temporary password for {result.email}
      </span>
      <code className="select-all font-mono text-[17px] font-semibold text-content-strong">
        {result.temporaryPassword}
      </code>
      <span className="text-[12px] leading-[1.5] text-content-body">
        Shown once and never stored in a readable form — copy it now. They will
        be asked to choose their own the first time they sign in.
      </span>
    </div>
  );
}

/**
 * `fixedClient` is the per-client variant.
 *
 * Invited from inside a client's settings, the only sensible account is a
 * client-role one confined to that client — so the role and client pickers
 * disappear rather than being pre-filled and editable. Leaving them editable
 * would make it possible to create an agency account, which sees every client,
 * from a screen whose whole framing is one client.
 */
export function CreateUserForm({
  clients,
  fixedClient,
}: {
  clients: Client[];
  fixedClient?: Client;
}) {
  const [result, action] = useFormState<ActionResult | null, FormData>(
    createUserAction,
    null
  );
  const [role, setRole] = useState<Role>("client");

  const field =
    "rounded-control border border-hairline-strong bg-paper px-3 py-2 text-[13.5px] text-content-strong";

  return (
    <div className="flex flex-col gap-3.5">
      <form action={action} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-muted">
              Email
            </span>
            <input name="email" type="email" required className={field} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-muted">
              Name (optional)
            </span>
            <input name="name" type="text" className={field} />
          </label>

          {fixedClient ? (
            <>
              <input type="hidden" name="role" value="client" />
              <input type="hidden" name="clientId" value={fixedClient.clientId} />
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-muted">
                  Access
                </span>
                <span className="text-[13px] text-content-body">
                  {fixedClient.name} only — they will not see any other client.
                </span>
              </div>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-muted">
                  Role
                </span>
                <select
                  name="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className={field}
                >
                  <option value="client">Client — one client only</option>
                  <option value="agency">Agency — every client</option>
                  <option value="admin">Admin — every client + user management</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-content-muted">
                  Client
                </span>
                <select
                  name="clientId"
                  disabled={role !== "client"}
                  className={`${field} disabled:bg-gray-50 disabled:text-gray-300`}
                >
                  {clients.map((c) => (
                    <option key={c.clientId} value={c.clientId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Submit label="Create user" busy="Creating…" />
          {result?.ok === false && (
            <span className="text-[12.5px] text-negative">{result.message}</span>
          )}
        </div>
      </form>

      {result?.ok && <TemporaryPassword result={result} />}
    </div>
  );
}

export function ResetPasswordButton({ user }: { user: AppUser }) {
  const [result, action] = useFormState<ActionResult | null, FormData>(
    resetPasswordAction,
    null
  );

  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={user.id} />
        <input type="hidden" name="email" value={user.email} />
        <button
          type="submit"
          className="rounded-control border border-hairline-strong px-2.5 py-1.5 font-mono text-[11px] text-content-body transition-colors duration-fast hover:bg-gray-50"
        >
          Reset password
        </button>
      </form>
      {result?.ok && <TemporaryPassword result={result} />}
      {result?.ok === false && (
        <span className="text-[12px] text-negative">{result.message}</span>
      )}
    </div>
  );
}
