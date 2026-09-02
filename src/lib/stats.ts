import "server-only";
import { COLLECTIONS, store } from "./firestore";
import { nowMs } from "./clock";

export type ArcadeStats = {
  players: number;
  openRounds: number;
  openDuels: number;
  stakedCents: number;
  paidOutCents: number;
  predictionsMade: number;
};

export const EMPTY_STATS: ArcadeStats = {
  players: 0,
  openRounds: 0,
  openDuels: 0,
  stakedCents: 0,
  paidOutCents: 0,
  predictionsMade: 0,
};

/**
 * These are decorative headline numbers on the home page, and computing them
 * touches several collections. Cached briefly so a burst of visitors doesn't
 * turn into a burst of Firestore reads on every render.
 */
const TTL_MS = 30_000;
const g = globalThis as unknown as { __arcadeStats?: { at: number; value: ArcadeStats } };

export async function arcadeStats(): Promise<ArcadeStats> {
  const cached = g.__arcadeStats;
  if (cached && nowMs() - cached.at < TTL_MS) return cached.value;

  const db = await store();

  const [players, openRounds, openDuels, predictionsMade, wallets, matches] = await Promise.all([
    db.count(COLLECTIONS.users),
    db.count(COLLECTIONS.ppRounds, { where: [["status", "==", "open"]] }),
    db.count(COLLECTIONS.wdMatches, { where: [["status", "==", "waiting"]] }),
    db.count(COLLECTIONS.ppPredictions),
    db.list<{ escrowCents: number }>(COLLECTIONS.wallets),
    db.list<{ payoutCents: number | null }>(COLLECTIONS.wdMatches, {
      where: [["status", "==", "finished"]],
    }),
  ]);

  const value: ArcadeStats = {
    players,
    openRounds,
    openDuels,
    predictionsMade,
    stakedCents: wallets.reduce((sum, w) => sum + (w.escrowCents ?? 0), 0),
    paidOutCents: matches.reduce((sum, m) => sum + (m.payoutCents ?? 0), 0),
  };

  g.__arcadeStats = { at: nowMs(), value };
  return value;
}
