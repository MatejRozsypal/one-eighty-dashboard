/**
 * Whether the real assistant answers the signed-in person: an internal role
 * and an agent configured. The model picker only shows when it does.
 */

import { NextResponse } from "next/server";
import { currentAccess, isInternal } from "@/lib/authz";
import type { ChatStatus } from "@/lib/chat/models";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await currentAccess();
  if (!access) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const live =
    isInternal(access.role) &&
    Boolean(process.env.AGENT_URL) &&
    Boolean(process.env.AGENT_SHARED_SECRET);
  return NextResponse.json({ live } satisfies ChatStatus);
}
