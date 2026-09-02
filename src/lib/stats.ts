import "server-only";
import { COLLECTIONS, store } from "./firestore";

export type ArcadeStats = {
  players: number;
  openRounds: number;
  openDuels: number;
  stakedCents: number;
  paidOutCents: number;
  predictionsMade: number;
};

/** Headline numbers for the arcade home page. */
export async function arcadeStats(): Promise<ArcadeStats> {
  const db = await store();

  const [players, openRounds, openDuels, predictionsMade, wallets, matches] = await Promise.all([
    db.count(COLLECTIONS.users),
    db.count(COLLECTIONS.ppRounds, { where: [["status", "==", "open"]] }),
    db.count(COLLECTIONS.wdMatches, { where: [["status", "==", "waiting"]] }),
    db.count(COLLECTIONS.ppPredictions),
    db.list<{ escrowCents: number }>(COLLECTIONS.wallets),
    db.list<{ status: string; payoutCents: number | null }>(COLLECTIONS.wdMatches, {
      where: [["status", "==", "finished"]],
    }),
  ]);

  return {
    players,
    openRounds,
    openDuels,
    predictionsMade,
    stakedCents: wallets.reduce((sum, w) => sum + (w.escrowCents ?? 0), 0),
    paidOutCents: matches.reduce((sum, m) => sum + (m.payoutCents ?? 0), 0),
  };
}
