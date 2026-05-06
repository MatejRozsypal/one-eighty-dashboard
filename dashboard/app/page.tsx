/**
 * Home page — server component.
 *
 * MVP scope: prove end-to-end connectivity by reading the clients registry
 * and the latest mart_daily_kpis row per client. If this renders with real
 * numbers, the entire pipeline (n8n → BQ → mart → frontend) is working.
 */

import { query, PROJECT_ID } from "@/lib/bigquery";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

interface Client {
  client_id: string;
  name: string;
  currency: string;
  status: string;
  shop_platform: string | null;
  email_platform: string | null;
}

interface DailyKpi {
  client_id: string;
  date: { value: string };
  revenue: number | null;
  orders: number | null;
  email_revenue: number | null;
}

async function getClients(): Promise<Client[]> {
  return query<Client>(
    `SELECT client_id, name, currency, status, shop_platform, email_platform
     FROM \`${PROJECT_ID}.ref.clients\`
     ORDER BY status DESC, client_id`
  );
}

async function getLatestKpis(): Promise<DailyKpi[]> {
  // Force partition filter to keep this free
  return query<DailyKpi>(
    `SELECT client_id, date, revenue, orders, email_revenue
     FROM \`${PROJECT_ID}.mart.mart_daily_kpis\`
     WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
     ORDER BY client_id, date DESC`
  ).catch(() => []); // mart may not exist yet on first deploy — fail gracefully
}

function formatMoney(value: number | null, currency: string): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function Home() {
  const session = await getServerSession(authOptions);
  const [clients, kpis] = await Promise.all([getClients(), getLatestKpis()]);

  // Group KPIs by client
  const kpisByClient = kpis.reduce<Record<string, DailyKpi[]>>((acc, k) => {
    (acc[k.client_id] ??= []).push(k);
    return acc;
  }, {});

  return (
    <main className="mx-auto max-w-6xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">One Eighty Dashboard</h1>
          <p className="text-slate-500">
            Signed in as {session?.user?.email}
          </p>
        </div>
        <a
          href="/api/auth/signout"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Sign out
        </a>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Clients</h2>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Currency</th>
                <th className="px-4 py-2 font-medium">Stack</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.client_id} className="border-t border-slate-100">
                  <td className="px-4 py-2">{c.name}</td>
                  <td className="px-4 py-2">{c.currency}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {c.shop_platform ?? "—"}
                    {c.email_platform ? ` + ${c.email_platform}` : ""}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        c.status === "active"
                          ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"
                          : "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                      }
                    >
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Last 7 days · revenue</h2>
        {Object.keys(kpisByClient).length === 0 ? (
          <p className="text-sm text-slate-500">
            No data yet. Mart layer hasn&apos;t refreshed — run the n8n
            workflows first, then wait 15 minutes for the scheduled query to
            populate <code>mart_daily_kpis</code>.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {clients
              .filter((c) => kpisByClient[c.client_id])
              .map((c) => (
                <div
                  key={c.client_id}
                  className="rounded-lg border border-slate-200 p-4"
                >
                  <h3 className="mb-2 font-medium">{c.name}</h3>
                  <ul className="space-y-1 text-sm">
                    {kpisByClient[c.client_id].map((k) => (
                      <li
                        key={k.date.value}
                        className="flex justify-between border-b border-slate-100 py-1"
                      >
                        <span className="text-slate-600">{k.date.value}</span>
                        <span className="font-medium">
                          {formatMoney(k.revenue, c.currency)}{" "}
                          <span className="text-slate-400">
                            · {k.orders ?? 0} orders
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </section>
    </main>
  );
}
