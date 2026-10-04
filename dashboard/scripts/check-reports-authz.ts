/**
 * Unit checks for the Reports gate decision (lib/authz.ts canUseReports) and
 * the "table not found" matcher the reference loaders rely on.
 *
 *     npx tsx --tsconfig scripts/tsconfig.json scripts/check-reports-authz.ts
 *
 * Pure: no session, no Postgres, no BigQuery. Exits non-zero on a mismatch.
 */

import * as authz from "@/lib/authz";
import { canUseReports, REPORTS_ROLES, type Access } from "@/lib/authz";
import { isTableNotFound } from "@/lib/reports/clients";
import type { ReportsAuthzModule } from "@/lib/reports/contracts";

// Type-level: lib/authz.ts satisfies the contract (fails tsc otherwise).
const _conforms: ReportsAuthzModule = authz;
void _conforms;

let checks = 0;
let failures = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const a = (email: string, role: Access["role"], clientId: string | null = null, mustChangePassword = false): Access => ({
  email,
  role,
  clientId,
  mustChangePassword,
});

function run(envDomain: string | undefined) {
  const prev = process.env.ALLOWED_EMAIL_DOMAIN;
  if (envDomain === undefined) delete process.env.ALLOWED_EMAIL_DOMAIN;
  else process.env.ALLOWED_EMAIL_DOMAIN = envDomain;
  try {
    return {
      admin: canUseReports(a("matej@oneeighty.cz", "admin")),
      agency: canUseReports(a("lukas@oneeighty.cz", "agency")),
      client: canUseReports(a("peter@oneeighty.cz", "client", "dobias")),
    };
  } finally {
    if (prev === undefined) delete process.env.ALLOWED_EMAIL_DOMAIN;
    else process.env.ALLOWED_EMAIL_DOMAIN = prev;
  }
}

// Owner decision: admin and agency, never client.
eq("REPORTS_ROLES", [...REPORTS_ROLES], ["admin", "agency"]);

// Default domain (ALLOWED_EMAIL_DOMAIN unset => oneeighty.cz).
const saved = process.env.ALLOWED_EMAIL_DOMAIN;
delete process.env.ALLOWED_EMAIL_DOMAIN;

eq("admin on internal domain", canUseReports(a("matej@oneeighty.cz", "admin")), true);
eq("agency on internal domain", canUseReports(a("lukas@oneeighty.cz", "agency")), true);
eq("domain is case-insensitive", canUseReports(a("Matej@OneEighty.CZ", "admin")), true);
eq("surrounding whitespace tolerated", canUseReports(a(" matej@oneeighty.cz ", "admin")), true);

eq("client role on internal domain", canUseReports(a("someone@oneeighty.cz", "client", "manami")), false);
eq("client role without a client", canUseReports(a("someone@oneeighty.cz", "client")), false);
eq("client role, outside domain", canUseReports(a("peter@drdobias.com", "client", "dobias")), false);

eq("admin, wrong domain", canUseReports(a("matej@gmail.com", "admin")), false);
eq("agency, wrong domain", canUseReports(a("freelancer@gmail.com", "agency")), false);
eq("look-alike suffix domain", canUseReports(a("x@oneeighty.cz.evil.com", "admin")), false);
eq("look-alike prefix domain", canUseReports(a("x@notoneeighty.cz", "admin")), false);
eq("subdomain is not the domain", canUseReports(a("x@mail.oneeighty.cz", "admin")), false);
eq("two @ signs", canUseReports(a("x@gmail.com@oneeighty.cz", "admin")), false);
eq("empty local part", canUseReports(a("@oneeighty.cz", "admin")), false);
eq("no @ at all", canUseReports(a("oneeighty.cz", "admin")), false);
eq("empty email", canUseReports(a("", "admin")), false);

eq("internal role carrying a client id", canUseReports(a("matej@oneeighty.cz", "admin", "dobias")), false);
eq("unknown role string", canUseReports({ email: "x@oneeighty.cz", role: "owner" as Access["role"], clientId: null, mustChangePassword: false }), false);
eq("null role", canUseReports({ email: "x@oneeighty.cz", role: null as unknown as Access["role"], clientId: null, mustChangePassword: false }), false);

// Forced password change: a temporary-password session never reaches Reports,
// whatever its role or domain (route handlers and server actions have no redirect).
eq("admin with temporary password", canUseReports(a("matej@oneeighty.cz", "admin", null, true)), false);
eq("agency with temporary password", canUseReports(a("lukas@oneeighty.cz", "agency", null, true)), false);
eq("agency after password change", canUseReports(a("lukas@oneeighty.cz", "agency", null, false)), true);
eq("truthy non-boolean flag is refused", canUseReports({ email: "x@oneeighty.cz", role: "agency", clientId: null, mustChangePassword: 1 as unknown as boolean }), false);

eq("null session", canUseReports(null), false);
eq("undefined session", canUseReports(undefined as unknown as null), false);

if (saved === undefined) delete process.env.ALLOWED_EMAIL_DOMAIN;
else process.env.ALLOWED_EMAIL_DOMAIN = saved;

// ALLOWED_EMAIL_DOMAIN is honoured, including lists, spaces and empty entries.
eq("env unset", run(undefined), { admin: true, agency: true, client: false });
eq("env other domain", run("example.org"), { admin: false, agency: false, client: false });
eq("env list incl. ours", run("example.org, OneEighty.cz"), { admin: true, agency: true, client: false });
eq("env empty entries ignored", run(",,"), { admin: false, agency: false, client: false });

// Missing-table matcher used by clients.ts and benchmarks.ts.
const nf = (t: string) => ({ code: 404, message: `Not found: Table oneeighty-warehouse:${t} was not found in location EU` });
eq("not found: client_verticals", isTableNotFound(nf("ref.client_verticals"), "ref.client_verticals"), true);
eq("not found: industry_benchmarks", isTableNotFound(nf("ref.industry_benchmarks"), "ref.industry_benchmarks"), true);
eq("other table not found is re-thrown", isTableNotFound(nf("ref.clients"), "ref.client_verticals"), false);
eq("longer table name is not a match", isTableNotFound(nf("ref.client_verticals_old"), "ref.client_verticals"), false);
eq("missing dataset is re-thrown", isTableNotFound({ code: 404, message: "Not found: Dataset oneeighty-warehouse:ref" }, "ref.client_verticals"), false);
eq("permission error is re-thrown", isTableNotFound({ code: 403, message: "Access Denied: Table oneeighty-warehouse:ref.client_verticals" }, "ref.client_verticals"), false);
eq("non-error value", isTableNotFound(null, "ref.client_verticals"), false);

console.log(`${checks - failures}/${checks} reports authz checks passed`);
if (failures > 0) process.exit(1);
