import { db, tx } from "@/lib/db";
import { newId } from "@/lib/ids";
import { MARKETS, marketById, getPrices, fetchPrices, priceHistory } from "@/lib/markets";

export const GAME_ID = "price-prediction";

/** Seconds a round accepts predictions, then seconds until settlement. */
const ENTRY_SECONDS = Number(process.env.PP_ENTRY_SECONDS ?? 300);
const SETTLE_SECONDS = Number(process.env.PP_SETTLE_SECONDS ?? 300);
const MAX_RESOLVE_ATTEMPTS = 5;

export const SCORING = {
  participation: 10,
  placement: [120, 70, 40] as const, // 1st, 2nd, 3rd
  accuracyMax: 60,
  /** Relative error at which the accuracy bonus reaches zero (1%). */
  accuracyFloor: 0.01,
};

export type RoundStatus = "open" | "locked" | "resolved" | "void";

export type RoundRow = {
  id: string;
  market_id: string;
  status: RoundStatus;
  opens_at: number;
  locks_at: number;
  resolves_at: number;
  open_price: number | null;
  final_price: number | null;
  resolved_at: number | null;
  attempts: number;
  created_at: number;
};

export type PredictionRow = {
  id: string;
  round_id: string;
  user_id: string;
  value: number;
  created_at: number;
  abs_error: number | null;
  placement: number | null;
  points: number | null;
};

export class GameError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* Round lifecycle                                                     */
/* ------------------------------------------------------------------ */

function createRound(marketId: string, openPrice: number | null, now: number): RoundRow {
  const locksAt = now + ENTRY_SECONDS * 1000;
  const round: RoundRow = {
    id: newId("rnd"),
    market_id: marketId,
    status: "open",
    opens_at: now,
    locks_at: locksAt,
    resolves_at: locksAt + SETTLE_SECONDS * 1000,
    open_price: openPrice,
    final_price: null,
    resolved_at: null,
    attempts: 0,
    created_at: now,
  };
  db.prepare(
    `INSERT INTO pp_rounds (id, market_id, status, opens_at, locks_at, resolves_at, open_price, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    round.id,
    round.market_id,
    round.status,
    round.opens_at,
    round.locks_at,
    round.resolves_at,
    round.open_price,
    round.created_at,
  );
  return round;
}

function settle(round: RoundRow, finalPrice: number, now: number) {
  const predictions = db
    .prepare("SELECT * FROM pp_predictions WHERE round_id = ?")
    .all(round.id) as unknown as PredictionRow[];

  const scored = predictions
    .map((p) => ({ ...p, abs_error: Math.abs(p.value - finalPrice) }))
    .sort((a, b) => a.abs_error - b.abs_error || a.created_at - b.created_at);

  const updatePrediction = db.prepare(
    "UPDATE pp_predictions SET abs_error = ?, placement = ?, points = ? WHERE id = ?",
  );
  const upsertScore = db.prepare(
    `INSERT INTO leaderboard (user_id, game_id, points, wins, plays, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT (user_id, game_id) DO UPDATE SET
       points = points + excluded.points,
       wins   = wins   + excluded.wins,
       plays  = plays  + 1,
       updated_at = excluded.updated_at`,
  );

  let placement = 0;
  let lastError = Number.NaN;
  scored.forEach((p, index) => {
    // Ties share a placement.
    if (p.abs_error !== lastError) {
      placement = index + 1;
      lastError = p.abs_error;
    }

    const relError = finalPrice > 0 ? p.abs_error / finalPrice : 1;
    const accuracy = Math.max(
      0,
      Math.round(SCORING.accuracyMax * (1 - Math.min(relError / SCORING.accuracyFloor, 1))),
    );
    const bonus = SCORING.placement[placement - 1] ?? 0;
    const points = SCORING.participation + bonus + accuracy;

    updatePrediction.run(p.abs_error, placement, points, p.id);
    upsertScore.run(p.user_id, GAME_ID, points, placement === 1 ? 1 : 0, now);
  });

  db.prepare(
    "UPDATE pp_rounds SET status = 'resolved', final_price = ?, resolved_at = ? WHERE id = ?",
  ).run(finalPrice, now, round.id);
}

/**
 * Advance every round: open -> locked -> resolved, and make sure each market
 * always has a round taking entries. Called lazily from read endpoints and by
 * the /api/cron/tick endpoint.
 */
export async function tick(): Promise<void> {
  const now = Date.now();

  db.prepare("UPDATE pp_rounds SET status = 'locked' WHERE status = 'open' AND locks_at <= ?").run(now);

  const due = db
    .prepare("SELECT * FROM pp_rounds WHERE status = 'locked' AND resolves_at <= ? ORDER BY resolves_at ASC")
    .all(now) as unknown as RoundRow[];

  if (due.length > 0) {
    let prices: Map<string, number>;
    try {
      prices = await fetchPrices([...new Set(due.map((r) => r.market_id))]);
    } catch {
      prices = new Map();
    }
    for (const round of due) {
      const price = prices.get(round.market_id);
      if (typeof price === "number") {
        tx(() => settle(round, price, Date.now()));
      } else if (round.attempts + 1 >= MAX_RESOLVE_ATTEMPTS) {
        db.prepare("UPDATE pp_rounds SET status = 'void', attempts = attempts + 1 WHERE id = ?").run(round.id);
      } else {
        db.prepare("UPDATE pp_rounds SET attempts = attempts + 1 WHERE id = ?").run(round.id);
      }
    }
  }

  // Ensure an entry-taking round exists for every market.
  const missing = MARKETS.filter(
    (m) => !db.prepare("SELECT 1 AS ok FROM pp_rounds WHERE market_id = ? AND status = 'open' LIMIT 1").get(m.id),
  );
  if (missing.length > 0) {
    const prices = await getPrices(missing.map((m) => m.id));
    const at = Date.now();
    for (const m of missing) createRound(m.id, prices.get(m.id) ?? null, at);
  }
}

/* ------------------------------------------------------------------ */
/* Predictions                                                         */
/* ------------------------------------------------------------------ */

export function submitPrediction(roundId: string, userId: string, value: number): PredictionRow {
  if (!Number.isFinite(value) || value <= 0) throw new GameError("Enter a price greater than zero.");

  return tx(() => {
    const round = db.prepare("SELECT * FROM pp_rounds WHERE id = ?").get(roundId) as unknown as
      | RoundRow
      | undefined;
    if (!round) throw new GameError("Round not found.", 404);
    if (round.status !== "open") throw new GameError("Entries for this round are closed.", 409);
    if (round.locks_at <= Date.now()) throw new GameError("Entries for this round just closed.", 409);

    const reference = round.open_price ?? value;
    if (value > reference * 100 || value < reference / 100) {
      throw new GameError("That prediction is wildly outside the market range.");
    }

    const existing = db
      .prepare("SELECT * FROM pp_predictions WHERE round_id = ? AND user_id = ?")
      .get(roundId, userId) as unknown as PredictionRow | undefined;

    const at = Date.now();
    if (existing) {
      db.prepare("UPDATE pp_predictions SET value = ?, created_at = ? WHERE id = ?").run(value, at, existing.id);
      return { ...existing, value, created_at: at };
    }

    const row: PredictionRow = {
      id: newId("prd"),
      round_id: roundId,
      user_id: userId,
      value,
      created_at: at,
      abs_error: null,
      placement: null,
      points: null,
    };
    db.prepare(
      "INSERT INTO pp_predictions (id, round_id, user_id, value, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(row.id, row.round_id, row.user_id, row.value, row.created_at);
    return row;
  });
}

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

export type Entry = {
  userId: string;
  username: string;
  displayName: string;
  value: number;
  submittedAt: number;
  absError: number | null;
  placement: number | null;
  points: number | null;
  isYou: boolean;
};

export type RoundView = {
  id: string;
  market: ReturnType<typeof marketById>;
  status: RoundStatus;
  opensAt: number;
  locksAt: number;
  resolvesAt: number;
  openPrice: number | null;
  finalPrice: number | null;
  resolvedAt: number | null;
  entryCount: number;
  yourPrediction: {
    value: number;
    submittedAt: number;
    placement: number | null;
    points: number | null;
  } | null;
  entries: Entry[];
};

type EntryRow = {
  user_id: string;
  value: number;
  created_at: number;
  abs_error: number | null;
  placement: number | null;
  points: number | null;
  username: string;
  display_name: string;
};

function entriesFor(roundId: string, revealed: boolean, viewerId?: string): Entry[] {
  const rows = db
    .prepare(
      `SELECT p.user_id, p.value, p.created_at, p.abs_error, p.placement, p.points,
              u.username, u.display_name
         FROM pp_predictions p JOIN users u ON u.id = p.user_id
        WHERE p.round_id = ?
        ORDER BY (p.placement IS NULL), p.placement ASC, p.created_at ASC`,
    )
    .all(roundId) as unknown as EntryRow[];

  return rows
    // Other players' numbers stay hidden until the round settles.
    .filter((r) => revealed || r.user_id === viewerId)
    .map((r) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      value: r.value,
      submittedAt: r.created_at,
      absError: r.abs_error,
      placement: r.placement,
      points: r.points,
      isYou: r.user_id === viewerId,
    }));
}

export function viewRound(round: RoundRow, viewerId?: string): RoundView {
  const revealed = round.status === "resolved";
  const countRow = db
    .prepare("SELECT COUNT(*) AS n FROM pp_predictions WHERE round_id = ?")
    .get(round.id) as unknown as { n: number };
  const mine = viewerId
    ? (db
        .prepare(
          "SELECT value, created_at, placement, points FROM pp_predictions WHERE round_id = ? AND user_id = ?",
        )
        .get(round.id, viewerId) as unknown as
        | { value: number; created_at: number; placement: number | null; points: number | null }
        | undefined)
    : undefined;

  return {
    id: round.id,
    market: marketById(round.market_id),
    status: round.status,
    opensAt: round.opens_at,
    locksAt: round.locks_at,
    resolvesAt: round.resolves_at,
    openPrice: round.open_price,
    finalPrice: round.final_price,
    resolvedAt: round.resolved_at,
    entryCount: countRow.n,
    yourPrediction: mine
      ? { value: mine.value, submittedAt: mine.created_at, placement: mine.placement, points: mine.points }
      : null,
    entries: entriesFor(round.id, revealed, viewerId),
  };
}

export function activeRounds(viewerId?: string): RoundView[] {
  const rows = db
    .prepare("SELECT * FROM pp_rounds WHERE status IN ('open','locked') ORDER BY resolves_at ASC")
    .all() as unknown as RoundRow[];
  return rows.map((r) => viewRound(r, viewerId));
}

export function recentRounds(limit = 8, viewerId?: string): RoundView[] {
  const rows = db
    .prepare("SELECT * FROM pp_rounds WHERE status IN ('resolved','void') ORDER BY resolves_at DESC LIMIT ?")
    .all(limit) as unknown as RoundRow[];
  return rows.map((r) => viewRound(r, viewerId));
}

export function roundById(id: string, viewerId?: string): RoundView | null {
  const row = db.prepare("SELECT * FROM pp_rounds WHERE id = ?").get(id) as unknown as RoundRow | undefined;
  return row ? viewRound(row, viewerId) : null;
}

export function sparkline(marketId: string, minutes = 60) {
  return priceHistory(marketId, Date.now() - minutes * 60_000);
}

export type LeaderboardRow = {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  points: number;
  wins: number;
  plays: number;
};

type ScoreRow = {
  user_id: string;
  points: number;
  wins: number;
  plays: number;
  username: string;
  display_name: string;
};

/** Pass null for gameId to rank across every game in the arcade. */
export function leaderboard(gameId: string | null = GAME_ID, limit = 25): LeaderboardRow[] {
  const rows = (
    gameId
      ? db
          .prepare(
            `SELECT l.user_id, l.points, l.wins, l.plays, u.username, u.display_name
               FROM leaderboard l JOIN users u ON u.id = l.user_id
              WHERE l.game_id = ?
              ORDER BY l.points DESC, l.wins DESC, l.plays ASC LIMIT ?`,
          )
          .all(gameId, limit)
      : db
          .prepare(
            `SELECT l.user_id, SUM(l.points) AS points, SUM(l.wins) AS wins, SUM(l.plays) AS plays,
                    u.username, u.display_name
               FROM leaderboard l JOIN users u ON u.id = l.user_id
              GROUP BY l.user_id, u.username, u.display_name
              ORDER BY points DESC, wins DESC LIMIT ?`,
          )
          .all(limit)
  ) as unknown as ScoreRow[];

  return rows.map((r, i) => ({
    rank: i + 1,
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    points: r.points,
    wins: r.wins,
    plays: r.plays,
  }));
}
