/**
 * Drop-in presence for any server-rendered page: each loads its own data
 * (memoised per request, so both together cost one load) and renders nothing
 * for a client-role viewer or when Postgres is unavailable.
 *
 *   <TeamStreak />        the viewer's streak pill, under the greeting
 *   <TeamLeaderboard />   the leaderboard side card (top 3, the viewer, See all)
 */

import { getPresenceBoard } from "@/lib/presence/leaderboard";
import { StreakBadge } from "@/components/presence/StreakBadge";
import { LeaderboardCard } from "@/components/presence/LeaderboardCard";

export async function TeamStreak() {
  const board = await getPresenceBoard();
  if (!board?.viewer) return null;
  return <StreakBadge row={board.viewer} countsWeekends={board.countsWeekends} />;
}

export async function TeamLeaderboard() {
  const board = await getPresenceBoard();
  if (!board || board.rows.length === 0) return null;
  return <LeaderboardCard rows={board.rows} />;
}
