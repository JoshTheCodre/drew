import "server-only";
import { COLLECTIONS, store } from "./firestore";
import { nowMs } from "./clock";

/**
 * One shared standings table for the whole arcade. Every game writes here, so
 * a new game gets a leaderboard for free.
 */

export type LeaderboardRow = {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  points: number;
  wins: number;
  plays: number;
};

type ScoreDoc = {
  userId: string;
  gameId: string;
  username: string;
  displayName: string;
  points: number;
  wins: number;
  plays: number;
  updatedAt: number;
};

const scoreId = (userId: string, gameId: string) => `${userId}__${gameId}`;

export type ScoreDelta = {
  userId: string;
  username: string;
  displayName: string;
  points: number;
  won: boolean;
};

/** Read-modify-write a single player's score for one game, atomically. */
export async function bumpLeaderboard(gameId: string, delta: ScoreDelta): Promise<void> {
  const db = await store();
  const id = scoreId(delta.userId, gameId);

  await db.runTx(async (tx) => {
    const current = await tx.get<ScoreDoc>(COLLECTIONS.leaderboard, id);
    tx.set(COLLECTIONS.leaderboard, id, {
      userId: delta.userId,
      gameId,
      username: delta.username,
      displayName: delta.displayName,
      points: (current?.points ?? 0) + delta.points,
      wins: (current?.wins ?? 0) + (delta.won ? 1 : 0),
      plays: (current?.plays ?? 0) + 1,
      updatedAt: nowMs(),
    } satisfies ScoreDoc);
  });
}

/** Pass null for gameId to rank across every game in the arcade. */
export async function readLeaderboard(
  gameId: string | null,
  limit = 25,
): Promise<LeaderboardRow[]> {
  const db = await store();
  const docs = await db.list<ScoreDoc>(
    COLLECTIONS.leaderboard,
    gameId ? { where: [["gameId", "==", gameId]] } : undefined,
  );

  const totals = new Map<string, Omit<LeaderboardRow, "rank">>();
  for (const doc of docs) {
    const existing = totals.get(doc.userId);
    if (existing) {
      existing.points += doc.points;
      existing.wins += doc.wins;
      existing.plays += doc.plays;
    } else {
      totals.set(doc.userId, {
        userId: doc.userId,
        username: doc.username,
        displayName: doc.displayName,
        points: doc.points,
        wins: doc.wins,
        plays: doc.plays,
      });
    }
  }

  return [...totals.values()]
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.plays - b.plays)
    .slice(0, limit)
    .map((row, i) => ({ rank: i + 1, ...row }));
}
