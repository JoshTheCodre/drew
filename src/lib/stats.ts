import { db } from "./db";

export type ArcadeStats = {
  players: number;
  openRounds: number;
  openDuels: number;
  stakedCents: number;
  paidOutCents: number;
  predictionsMade: number;
};

const count = (sql: string, ...args: unknown[]) =>
  (db.prepare(sql).get(...(args as never[])) as unknown as { n: number }).n;

/** Headline numbers for the arcade home page. */
export function arcadeStats(): ArcadeStats {
  return {
    players: count("SELECT COUNT(*) AS n FROM users"),
    openRounds: count("SELECT COUNT(*) AS n FROM pp_rounds WHERE status = 'open'"),
    openDuels: count("SELECT COUNT(*) AS n FROM wd_matches WHERE status = 'waiting'"),
    stakedCents: count("SELECT COALESCE(SUM(escrow_cents), 0) AS n FROM wallets"),
    paidOutCents: count(
      "SELECT COALESCE(SUM(payout_cents), 0) AS n FROM wd_matches WHERE status = 'finished' AND winner_id IS NOT NULL",
    ),
    predictionsMade: count("SELECT COUNT(*) AS n FROM pp_predictions"),
  };
}
