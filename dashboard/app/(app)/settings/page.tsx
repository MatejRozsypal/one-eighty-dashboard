/**
 * Settings — everything configurable, organised by client.
 *
 * ── Why this replaced the flat admin screen ─────────────────────────────────
 * The old screen listed every person across every client in one table and every
 * client's cost assumptions in another. With two clients that was merely untidy;
 * it does not survive ten, because the question anyone actually arrives with is
 * "what is set up for *this* client", and the flat list makes you filter it in
 * your head. Here a client is picked once and everything about them — who can
 * see them, what their costs are assumed to be, what they are aiming at — is on
 * one screen.
 *
 * Internal staff are the exception and get their own tab: an admin or agency
 * account belongs to no single client, so filing them under one would be a lie.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClients, type Client } from "@/lib/clients";
import { listUsers, type AppUser } from "@/lib/users/store";
import { listClientSettings } from "@/lib/users/settings";
import { listAccessLog, countRecentRefusals } from "@/lib/users/accessLog";
import { getGoals } from "@/lib/queries/goals";
import { GOAL_METRICS } from "@/lib/goals/store";
import { monthsOfYear } from "@/lib/goals/progress";
import { isDemo } from "@/lib/demo/client";
import { saveSettingsAction } from "@/app/(app)/admin/actions";
import { saveGoalsAction } from "./actions";
import { Header } from "@/components/shell/Header";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { SettingsTabs } from "@/components/settings/SettingsTabs";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const CARD =
  "flex flex-col gap-4 rounded-card border border-hairline bg-surface-card p-[22px_20px] shadow-sm lg:p-[22px_26px]";
const FIELD =
  "w-[120px] rounded-control border border-hairline-strong bg-paper px-2.5 py-1.5 text-right font-mono text-[12.5px]";
const BUTTON =
  "rounded-control border border-hairline-strong px-3 py-2 font-mono text-[11px] text-content-body transition-colors duration-fast hover:bg-gray-50";

function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getServerSession(authOptions);
  // The gear is hidden from non-admins; this is the check that actually holds.
  if (session?.user?.role !== "admin") redirect("/snapshot");

  const tab = (searchParams.tab as string) ?? "clients";
  const clients = await getClients();

  const requested = searchParams.client as string | undefined;
  const selected: Client =
    clients.find((c) => c.clientId === requested) ?? clients[0];

  let users: AppUser[] = [];
  let loadError: string | null = null;
  try {
    users = await listUsers();
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Could not read the user store.";
  }

  const header = (
    <>
      <Header eyebrow="Settings" title="Settings" />
      <SettingsTabs />
    </>
  );

  const error = loadError && (
    <div className="rounded-card border border-negative/35 bg-[#FFF7F7] p-[16px_18px] text-[13px] text-content-strong">
      {loadError} — has <code className="font-mono">schema.sql</code> been run?
    </div>
  );

  // ── Team ────────────────────────────────────────────────────────────────
  if (tab === "team") {
    const staff = users.filter((u) => u.role !== "client");
    return (
      <>
        {header}
        <main className="flex max-w-[1080px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          {error}
          <section className={CARD}>
            <div className="flex flex-col gap-[5px]">
              <Eyebrow>Team · {staff.length}</Eyebrow>
              <span className="text-[12.5px] leading-[1.5] text-content-muted">
                Admin and agency accounts see every client, so they belong to
                none of them and are listed here rather than under a client.
                Admin adds user management on top.
              </span>
            </div>
            {staff.map((u) => (
              <div
                key={u.email}
                className="flex flex-wrap items-center gap-3 border-b border-hairline pb-3 text-[13px] last:border-0"
              >
                <span className="min-w-[220px] flex-1 text-content-strong">
                  {u.name ?? u.email}
                  <span className="ml-2 font-mono text-[11px] text-content-muted">
                    {u.email}
                  </span>
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-content-muted">
                  {u.role}
                </span>
                {!u.isActive && (
                  <span className="font-mono text-[11px] text-negative">
                    deactivated
                  </span>
                )}
              </div>
            ))}
            <p className="text-[12px] text-content-muted">
              Adding, editing and deactivating accounts still lives on the{" "}
              <Link href="/admin" className="underline">
                user management screen
              </Link>
              . It has not moved here yet.
            </p>
          </section>
        </main>
      </>
    );
  }

  // ── Access log ──────────────────────────────────────────────────────────
  if (tab === "log") {
    const [entries, refusals] = await Promise.all([
      listAccessLog({ limit: 150 }).catch(() => []),
      countRecentRefusals(30).catch(() => 0),
    ]);

    return (
      <>
        {header}
        <main className="flex max-w-[1080px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <section className={CARD}>
            <div className="flex flex-col gap-[5px]">
              <Eyebrow>Access log</Eyebrow>
              <span className="text-[12.5px] leading-[1.5] text-content-muted">
                One row per data-page render: who was served which client, and
                every time an account asked for a client that was not theirs.
                Read this as evidence, not enforcement — a write failure is
                swallowed so it cannot take the dashboard down, so a gap means
                &ldquo;could not record&rdquo;, never &ldquo;nobody
                accessed&rdquo;. Demo views are not recorded.
              </span>
            </div>

            <div
              className={`rounded-card border p-[14px_16px] text-[13px] ${
                refusals > 0
                  ? "border-negative/35 bg-[#FFF7F7] text-content-strong"
                  : "border-hairline bg-gray-50 text-content-body"
              }`}
            >
              {refusals > 0 ? (
                <>
                  <strong>{refusals}</strong> refused cross-client attempt
                  {refusals === 1 ? "" : "s"} in the last 30 days.
                </>
              ) : (
                <>No refused cross-client attempts in the last 30 days.</>
              )}
            </div>

            {entries.length === 0 ? (
              <p className="text-[13px] text-content-muted">
                Nothing recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-[150px_1.4fr_90px_1fr] gap-2 border-b border-hairline bg-gray-50 px-4 py-2.5">
                    {["When", "Who", "Event", "Client"].map((h) => (
                      <span
                        key={h}
                        className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted"
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                  {entries.map((e) => (
                    <div
                      key={e.id}
                      className={`grid grid-cols-[150px_1.4fr_90px_1fr] items-center gap-2 border-b border-hairline px-4 py-2.5 text-[12.5px] ${
                        e.event === "refused" ? "bg-[#FFF7F7]" : ""
                      }`}
                    >
                      <span className="font-mono text-[11.5px] text-content-muted">
                        {e.at.slice(0, 16).replace("T", " ")}
                      </span>
                      <span className="truncate text-content-strong">
                        {e.email}
                        <span className="ml-2 font-mono text-[10.5px] text-content-muted">
                          {e.role}
                        </span>
                      </span>
                      <span
                        className={`font-mono text-[11px] ${
                          e.event === "refused"
                            ? "font-semibold text-negative"
                            : "text-content-muted"
                        }`}
                      >
                        {e.event}
                      </span>
                      <span className="truncate font-mono text-[11.5px] text-content-body">
                        {e.event === "refused" ? (
                          <>
                            asked for{" "}
                            <strong>{e.requestedClientId ?? "—"}</strong>, served{" "}
                            {e.clientId ?? "—"}
                          </>
                        ) : (
                          (e.clientId ?? "—")
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </main>
      </>
    );
  }

  // ── Clients (default) ───────────────────────────────────────────────────
  const settings = await listClientSettings().catch(() => []);
  const current = settings.find((s) => s.clientId === selected.clientId);
  const year = new Date().getUTCFullYear();
  const goals = await getGoals(selected.clientId, year).catch(() => []);
  const people = users.filter(
    (u) => u.role === "client" && u.clientId === selected.clientId
  );
  const demo = isDemo(selected.clientId);

  return (
    <>
      {header}
      <main className="flex max-w-[1080px] flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {error}

        <div className="flex flex-wrap items-center gap-2">
          {clients.map((c) => (
            <Link
              key={c.clientId}
              href={`/settings?client=${c.clientId}`}
              className={`rounded-control border px-3 py-2 text-[13px] transition-colors duration-fast ${
                c.clientId === selected.clientId
                  ? "border-hairline-strong bg-bg-inverse font-semibold text-content-inverse"
                  : "border-hairline-strong text-content-body hover:bg-gray-50"
              }`}
            >
              {c.name}
            </Link>
          ))}
        </div>

        {demo && (
          <div className="rounded-card border border-hairline bg-gray-50 p-[14px_16px] text-[13px] text-content-body">
            Every figure for this client is invented, and its cost assumptions
            and targets are fixed in code. Saving here is refused rather than
            silently storing rows nothing reads.
          </div>
        )}

        <section className={CARD}>
          <div className="flex flex-col gap-[5px]">
            <Eyebrow>Cost assumptions · {selected.name}</Eyebrow>
            <span className="text-[12.5px] leading-[1.5] text-content-muted">
              No connected source reports operating expenses, fulfilment or the
              other CM1 costs, so they cannot be derived — they are your input.
              Leave a field empty and the metric that depends on it is hidden
              rather than guessed.
            </span>
          </div>

          <form action={saveSettingsAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="clientId" value={selected.clientId} />
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
                OpEx % of revenue
              </span>
              <input
                name="opexPct"
                type="text"
                inputMode="decimal"
                placeholder="—"
                defaultValue={
                  current?.opexRate !== null && current?.opexRate !== undefined
                    ? (current.opexRate * 100).toString()
                    : ""
                }
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
                Fulfilment / order ({selected.currency})
              </span>
              <input
                name="fulfilmentPerOrder"
                type="text"
                inputMode="decimal"
                placeholder="—"
                defaultValue={current?.fulfilmentPerOrder?.toString() ?? ""}
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-content-muted">
                Other CM1 / order ({selected.currency})
              </span>
              <input
                name="otherCm1PerOrder"
                type="text"
                inputMode="decimal"
                placeholder="—"
                defaultValue={current?.otherCm1PerOrder?.toString() ?? ""}
                className={FIELD}
              />
            </label>
            <button type="submit" className={BUTTON}>
              Save
            </button>
            {current?.updatedAt && (
              <span className="font-mono text-[10.5px] text-content-muted">
                {current.updatedAt.slice(0, 10)} · {current.updatedBy}
              </span>
            )}
          </form>
        </section>

        <section className={CARD}>
          <div className="flex flex-col gap-[5px]">
            <Eyebrow>
              Goals · {selected.name} · {year}
            </Eyebrow>
            <span className="text-[12.5px] leading-[1.5] text-content-muted">
              Monthly targets. Quarters and the year are summed from these
              rather than set separately, so there is only ever one answer to
              what is being aimed at. An empty box is no target — which the
              Goals page shows as unset, not as a miss.
            </span>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[680px] pb-1">
              <div className="grid grid-cols-[110px_repeat(4,1fr)_90px] gap-2 border-b border-hairline bg-gray-50 px-3 py-2.5">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted">
                  Month
                </span>
                {GOAL_METRICS.map((m) => (
                  <span
                    key={m.key}
                    title={m.blurb}
                    className="text-right font-mono text-[10.5px] uppercase tracking-[0.08em] text-content-muted"
                  >
                    {m.label}
                  </span>
                ))}
                <span />
              </div>

              {monthsOfYear(year).map((month) => (
                <form
                  key={month}
                  action={saveGoalsAction}
                  className="grid grid-cols-[110px_repeat(4,1fr)_90px] items-center gap-2 border-b border-hairline px-3 py-2"
                >
                  <input type="hidden" name="clientId" value={selected.clientId} />
                  <input type="hidden" name="month" value={month} />
                  <span className="text-[13px] text-content-strong">
                    {monthName(month)}
                  </span>
                  {GOAL_METRICS.map((m) => {
                    const g = goals.find(
                      (x) => x.month === month && x.metric === m.key
                    );
                    return (
                      <input
                        key={m.key}
                        name={`target_${m.key}`}
                        type="text"
                        inputMode="decimal"
                        placeholder="—"
                        disabled={demo}
                        defaultValue={g ? String(g.target) : ""}
                        aria-label={`${m.label} target for ${monthName(month)}`}
                        className="w-full rounded-control border border-hairline-strong bg-paper px-2 py-1.5 text-right font-mono text-[12.5px] disabled:bg-gray-50 disabled:text-content-muted"
                      />
                    );
                  })}
                  <button type="submit" disabled={demo} className={`${BUTTON} disabled:opacity-40`}>
                    Save
                  </button>
                </form>
              ))}
            </div>
          </div>
        </section>

        <section className={CARD}>
          <div className="flex flex-col gap-[5px]">
            <Eyebrow>
              People with access · {selected.name} · {people.length}
            </Eyebrow>
            <span className="text-[12.5px] leading-[1.5] text-content-muted">
              Client accounts confined to {selected.name}. Agency and admin
              accounts see every client and are listed under Team.
            </span>
          </div>

          {people.length === 0 ? (
            <p className="text-[13px] text-content-muted">
              Nobody outside the agency can open {selected.name} yet.
            </p>
          ) : (
            people.map((u) => (
              <div
                key={u.email}
                className="flex flex-wrap items-center gap-3 border-b border-hairline pb-3 text-[13px] last:border-0"
              >
                <span className="min-w-[220px] flex-1 text-content-strong">
                  {u.name ?? u.email}
                  <span className="ml-2 font-mono text-[11px] text-content-muted">
                    {u.email}
                  </span>
                </span>
                {!u.isActive && (
                  <span className="font-mono text-[11px] text-negative">
                    deactivated
                  </span>
                )}
                {u.lastLoginAt && (
                  <span className="font-mono text-[10.5px] text-content-muted">
                    last in {u.lastLoginAt.slice(0, 10)}
                  </span>
                )}
              </div>
            ))
          )}

          <p className="text-[12px] text-content-muted">
            Inviting and deactivating people still lives on the{" "}
            <Link href="/admin" className="underline">
              user management screen
            </Link>
            . It has not moved here yet.
          </p>
        </section>
      </main>
    </>
  );
}
