/**
 * Drop-in presence for any server-rendered page: each loads its own data
 * (memoised per request, so both together cost one load) and renders nothing
 * for a client-role viewer or when Postgres is unavailable.
 *
 *   <TeamStreak />        the viewer's streak pill, under the greeting
 *   <TeamLeaderboard />   the leaderboard section
 */

import { getPresenceBoard } from "@/lib/presence/leaderboard";
import { StreakBadge } from "@/components/presence/StreakBadge";
import { Leaderboard } from "@/components/presence/Leaderboard";

export async function TeamStreak() {
  const board = await getPresenceBoard();
  if (!board?.viewer) return null;
  return <StreakBadge row={board.viewer} countsWeekends={board.countsWeekends} />;
}

export async function TeamLeaderboard() {
  const board = await getPresenceBoard();
  if (!board || board.rows.length === 0) return null;
  return <Leaderboard rows={board.rows} />;
}
