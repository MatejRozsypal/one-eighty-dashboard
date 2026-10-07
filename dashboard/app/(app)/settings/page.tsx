/**
 * Settings: everything configurable, organised by client.
 *
 * A client is picked once and everything about them (who can see them, what
 * their costs are assumed to be) is on one screen.
 * Internal staff get their own tab: an admin or agency account belongs to no
 * single client, so filing them under one would be a lie.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppLink } from "@/components/ui/AppLink";
import { currentAccess, isInternal } from "@/lib/authz";
import { getClients, type Client } from "@/lib/clients";
import { listUsers, type AppUser } from "@/lib/users/store";
import { listClientSettings } from "@/lib/users/settings";
import { listAccessLog, countRecentRefusals } from "@/lib/users/accessLog";
import { isDemo } from "@/lib/demo/client";
import { NO_VALUE } from "@/lib/format";
import { Notice } from "@/components/ui/Notice";
import { saveSettingsAction } from "@/app/(app)/admin/actions";
import { CreateUserForm } from "@/app/(app)/admin/UserForms";
import { PeopleList } from "@/components/settings/PeopleList";
import { saveCreativeSettingsAction } from "./actions";
import { Header } from "@/components/shell/Header";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SaveButton } from "@/components/settings/SaveButton";
import { CreativeThresholds } from "@/components/settings/CreativeThresholds";
import { getCreativeSettings } from "@/lib/creative/store";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const FIELD =
  "w-[120px] rounded-control border border-hairline-strong bg-paper px-2.5 py-1.5 text-right font-mono text-[12.5px]";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // Agency reaches Settings too: targets and cost assumptions are their job.
  // Managing *access* is not, so that is gated separately below and again in
  // each server action. The gear is hidden from clients; this is the check that
  // actually holds.
  const access = await currentAccess();
  if (!access || !isInternal(access.role)) redirect("/snapshot");
  const canManage = access.role === "admin";

  const tab = (searchParams.tab as string) ?? "clients";
  const clients = await getClients();

  const requested = searchParams.client as string | undefined;
  const selected: Client =
    clients.find((c) => c.clientId === requested) ?? clients[0];

  let users: AppUser[] = [];
  let loadError: string | null = null;
  try {
    users = await listUsers();
  } catch {
    loadError = "Could not read the user store.";
  }

  const header = (
    <>
      <Header title="Settings" />
      <SettingsTabs />
    </>
  );

  const error = loadError && (
    <div className="rounded-card border border-negative/35 bg-notice-negative p-[16px_18px] text-[13px] text-content-strong">
      {loadError}
    </div>
  );

  // ── Team ────────────────────────────────────────────────────────────────
  if (tab === "team") {
    const staff = users.filter((u) => u.role !== "client");
    return (
      <>
        {header}
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          {error}
          <SettingsSection
            title="Team"
            summary={
              staff.length === 0
                ? "Nobody yet"
                : `${staff.length} account${staff.length === 1 ? "" : "s"} · ${
                    staff.filter((u) => u.role === "admin").length
                  } admin`
            }
          >
            <PeopleList
              users={staff}
              clients={clients}
              canManage={canManage}
              emptyMessage="No team accounts yet."
            />
          </SettingsSection>

          {canManage && (
            <SettingsSection
              title="Add team member"
            >
              <CreateUserForm clients={clients} />
            </SettingsSection>
          )}
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
        <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
          <SettingsSection
            title="Access log"
            defaultOpen
            summary={
              refusals > 0
                ? `${refusals} refused in 30 days`
                : `${entries.length} recent entries`
            }
            description="One row per data page view. A gap means a view could not be recorded, not that nobody looked. Demo views are not recorded."
          >
            <div
              className={`rounded-card border p-[14px_16px] text-[13px] ${
                refusals > 0
                  ? "border-negative/35 bg-notice-negative text-content-strong"
                  : "border-hairline bg-gray-50 text-content-body"
              }`}
            >
              {refusals > 0 ? (
                <>
                  <strong>{refusals}</strong> refused in 30 days.
                </>
              ) : (
                <>No refused attempts.</>
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
                        e.event === "refused" ? "bg-notice-negative" : ""
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
                            <strong>{e.requestedClientId ?? NO_VALUE}</strong>, served{" "}
                            {e.clientId ?? NO_VALUE}
                          </>
                        ) : (
                          (e.clientId ?? NO_VALUE)
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SettingsSection>
        </main>
      </>
    );
  }

  // ── Clients (default) ───────────────────────────────────────────────────
  const settings = await listClientSettings().catch(() => []);
  const current = settings.find((s) => s.clientId === selected.clientId);
  const creative = await getCreativeSettings(selected.clientId);
  const people = users.filter(
    (u) => u.role === "client" && u.clientId === selected.clientId
  );
  const demo = isDemo(selected.clientId);

  // What each collapsed section says about itself. "Not stated" is the useful
  // answer where nothing is set, it is exactly what someone opening Settings
  // is trying to find out.
  const costSummary = (() => {
    const parts: string[] = [];
    if (current?.opexRate !== null && current?.opexRate !== undefined) {
      parts.push(`OpEx ${(current.opexRate * 100).toFixed(0)}%`);
    }
    if (current?.fulfilmentPerOrder !== null && current?.fulfilmentPerOrder !== undefined) {
      parts.push(`fulfilment ${current.fulfilmentPerOrder} ${selected.currency}`);
    }
    if (current?.otherCm1PerOrder !== null && current?.otherCm1PerOrder !== undefined) {
      parts.push(`other ${current.otherCm1PerOrder} ${selected.currency}`);
    }
    return parts.length === 0 ? "Nothing stated" : parts.join(" · ");
  })();

  // The Creative section is unusable until the three money lines are set, so
  // the collapsed summary says which of them are missing rather than reporting
  // a count. "Nothing set" and "no CPA" need different actions.
  const creativeSummary = (() => {
    const missing: string[] = [];
    if (creative.killRoas === null) missing.push("kill line");
    if (creative.targetRoas === null) missing.push("target");
    if (creative.targetCpa === null) missing.push("CPA");
    if (missing.length === 3) return "No thresholds set";
    if (missing.length > 0) return `Missing ${missing.join(", ")}`;
    return `Kill ${creative.killRoas!.toFixed(2)} · target ${creative.targetRoas!.toFixed(2)} · CPA ${creative.targetCpa} ${selected.metaCurrency ?? selected.currency}`;
  })();

  const activePeople = people.filter((u) => u.isActive).length;
  const peopleSummary =
    people.length === 0
      ? "Nobody outside the agency"
      : `${activePeople} with access${
          people.length > activePeople
            ? ` · ${people.length - activePeople} disabled`
            : ""
        }`;

  return (
    <>
      {header}
      <main className="page-frame flex flex-col gap-5 px-5 pb-14 pt-6 lg:px-8">
        {error}

        <div className="flex flex-wrap items-center gap-2">
          {clients.map((c) => (
            <AppLink
              key={c.clientId}
              href={`/settings?client=${c.clientId}`}
              className={`rounded-control border px-3 py-2 text-[13px] transition-colors duration-fast ${
                c.clientId === selected.clientId
                  ? "border-hairline-strong bg-bg-inverse font-semibold text-content-inverse"
                  : "border-hairline-strong text-content-body hover:bg-gray-50"
              }`}
            >
              {c.name}
            </AppLink>
          ))}
        </div>

        {demo && (
          <Notice>Demo client: read only.</Notice>
        )}

        <SettingsSection
          title="Cost assumptions"
          summary={costSummary}
          description="No source reports these costs, so they are your input. Leave a field empty and the metrics that depend on it show n/a."
        >
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
                placeholder={NO_VALUE}
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
                placeholder={NO_VALUE}
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
                placeholder={NO_VALUE}
                defaultValue={current?.otherCm1PerOrder?.toString() ?? ""}
                className={FIELD}
              />
            </label>
            <SaveButton />
            {current?.updatedAt && (
              <span className="font-mono text-[10.5px] text-content-muted">
                {current.updatedAt.slice(0, 10)} · {current.updatedBy}
              </span>
            )}
          </form>
        </SettingsSection>

        <SettingsSection
          title="Creative Engine"
          summary={creativeSummary}
          description="Kill ROAS, target ROAS and target CPA have no defaults. Without all three, Creative screens show delivery only and give no verdicts."
        >
          <CreativeThresholds
            clientId={selected.clientId}
            currency={selected.metaCurrency ?? selected.currency}
            settings={creative}
            action={saveCreativeSettingsAction}
          />
        </SettingsSection>

        <SettingsSection
          title="People with access"
          summary={peopleSummary}
        >
          <PeopleList
            users={people}
            clients={clients}
            canManage={canManage}
            fixedClient={selected}
            emptyMessage="No client users yet."
          />

        </SettingsSection>

        {canManage && !demo && (
          <SettingsSection
            title="Invite someone"
          >
            <CreateUserForm clients={[selected]} fixedClient={selected} />
          </SettingsSection>
        )}
      </main>
    </>
  );
}
