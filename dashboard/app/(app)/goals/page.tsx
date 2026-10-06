/**
 * Goals moved to Plan. Old links and bookmarks land on the Plan page with
 * their query string (client and the rest) intact.
 */

import { redirect } from "next/navigation";
import type { SearchParams } from "@/lib/params";

export const dynamic = "force-dynamic";

export default function GoalsRedirect({ searchParams }: { searchParams: SearchParams }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else if (value !== undefined) query.set(key, value);
  }
  const qs = query.toString();
  redirect(qs ? `/plan?${qs}` : "/plan");
}
