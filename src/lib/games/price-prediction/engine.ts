import "server-only";
import { COLLECTIONS, store } from "@/lib/firestore";
import { newId } from "@/lib/ids";
import { nowMs } from "@/lib/clock";
import { MARKETS, fetchPrices, getPrices, marketById, priceHistory } from "@/lib/markets";
import { bumpLeaderboard, readLeaderboard, type LeaderboardRow } from "@/lib/leaderboard";
import type { User } from "@/lib/auth";

export const GAME_ID = "price-prediction";
export type { LeaderboardRow };

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

type RoundDoc = {
  marketId: string;
  status: RoundStatus;
  opensAt: number;
  locksAt: number;
  resolvesAt: number;
  openPrice: number | null;
  finalPrice: number | null;
  resolvedAt: number | null;
  attempts: number;
  createdAt: number;
};

type RoundRecord = RoundDoc & { id: string };

type PredictionDoc = {
  roundId: string;
  userId: string;
  username: string;
  displayName: string;
  value: number;
  createdAt: number;
  absError: number | null;
  placement: number | null;
  points: number | null;
};

type PredictionRecord = PredictionDoc & { id: string };

export class GameError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const predictionId = (roundId: string, userId: string) => `${roundId}__${userId}`;

/**
 * Rounds are few and short-lived, so reads pull the most recent slice by a
 * single indexed field and filter in memory. That keeps Firestore working with
 * automatic single-field indexes — no composite index deployment required.
 */
async function recentRoundDocs(limit = 40): Promise<RoundRecord[]> {
  const db = await store();
  return db.list<RoundRecord>(COLLECTIONS.ppRounds, {
    orderBy: [["resolvesAt", "desc"]],
    limit,
  });
}

async function predictionsFor(roundId: string): Promise<PredictionRecord[]> {
  const db = await store();
  const rows = await db.list<PredictionRecord>(COLLECTIONS.ppPredictions, {
    where: [["roundId", "==", roundId]],
  });
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

/* ------------------------------------------------------------------ */
/* Round lifecycle                                                     */
/* ------------------------------------------------------------------ */

async function createRound(marketId: string, openPrice: number | null, at: number) {
  const db = await store();
  const locksAt = at + ENTRY_SECONDS * 1000;
  const doc: RoundDoc = {
    marketId,
    status: "open",
    opensAt: at,
    locksAt,
    resolvesAt: locksAt + SETTLE_SECONDS * 1000,
    openPrice,
    finalPrice: null,
    resolvedAt: null,
    attempts: 0,
    createdAt: at,
  };
  await db.set(COLLECTIONS.ppRounds, newId("rnd"), doc);
}

/**
 * Scores a round and writes the results. The round document is claimed inside a
 * transaction first, so only one caller ever settles it.
 */
async function settle(round: RoundRecord, finalPrice: number) {
  const db = await store();
  const at = nowMs();

  const claimed = await db.runTx(async (tx) => {
    const current = await tx.get<RoundDoc>(COLLECTIONS.ppRounds, round.id);
    if (!current || current.status !== "locked") return false;
    tx.update(COLLECTIONS.ppRounds, round.id, { status: "resolved", finalPrice, resolvedAt: at });
    return true;
  });
  if (!claimed) return;

  const scored = (await predictionsFor(round.id))
    .map((p) => ({ ...p, absError: Math.abs(p.value - finalPrice) }))
    .sort((a, b) => a.absError - b.absError || a.createdAt - b.createdAt);

  let placement = 0;
  let lastError = Number.NaN;

  for (const [index, prediction] of scored.entries()) {
    // Ties share a placement.
    if (prediction.absError !== lastError) {
      placement = index + 1;
      lastError = prediction.absError;
    }

    const relError = finalPrice > 0 ? prediction.absError / finalPrice : 1;
    const accuracy = Math.max(
      0,
      Math.round(SCORING.accuracyMax * (1 - Math.min(relError / SCORING.accuracyFloor, 1))),
    );
    const points = SCORING.participation + (SCORING.placement[placement - 1] ?? 0) + accuracy;

    await db.update(COLLECTIONS.ppPredictions, prediction.id, {
      absError: prediction.absError,
      placement,
      points,
    });
    await bumpLeaderboard(GAME_ID, {
      userId: prediction.userId,
      username: prediction.username,
      displayName: prediction.displayName,
      points,
      won: placement === 1,
    });
  }
}

/**
 * Advance every round: open -> locked -> resolved, and make sure each market
 * always has a round taking entries. Called lazily from reads, and by
 * /api/cron/tick for quiet periods.
 */
export async function tick(): Promise<void> {
  const db = await store();
  const at = nowMs();
  const rounds = await recentRoundDocs();

  for (const round of rounds) {
    if (round.status === "open" && round.locksAt <= at) {
      await db.update(COLLECTIONS.ppRounds, round.id, { status: "locked" });
      round.status = "locked";
    }
  }

  const due = rounds.filter((r) => r.status === "locked" && r.resolvesAt <= at);
  if (due.length > 0) {
    let prices: Map<string, number>;
    try {
      prices = await fetchPrices([...new Set(due.map((r) => r.marketId))]);
    } catch {
      prices = new Map();
    }
    for (const round of due) {
      const price = prices.get(round.marketId);
      if (typeof price === "number") {
        await settle(round, price);
      } else if (round.attempts + 1 >= MAX_RESOLVE_ATTEMPTS) {
        await db.update(COLLECTIONS.ppRounds, round.id, { status: "void", attempts: round.attempts + 1 });
      } else {
        await db.update(COLLECTIONS.ppRounds, round.id, { attempts: round.attempts + 1 });
      }
    }
  }

  // Ensure an entry-taking round exists for every market.
  const fresh = await recentRoundDocs();
  const missing = MARKETS.filter(
    (m) => !fresh.some((r) => r.marketId === m.id && (r.status === "open" || r.status === "locked")),
  );
  if (missing.length > 0) {
    const prices = await getPrices(missing.map((m) => m.id));
    const now = nowMs();
    for (const m of missing) await createRound(m.id, prices.get(m.id) ?? null, now);
  }
}

/* ------------------------------------------------------------------ */
/* Predictions                                                         */
/* ------------------------------------------------------------------ */

export async function submitPrediction(roundId: string, user: User, value: number): Promise<void> {
  if (!Number.isFinite(value) || value <= 0) throw new GameError("Enter a price greater than zero.");

  const db = await store();
  await db.runTx(async (tx) => {
    const round = await tx.get<RoundDoc>(COLLECTIONS.ppRounds, roundId);
    if (!round) throw new GameError("Round not found.", 404);
    if (round.status !== "open") throw new GameError("Entries for this round are closed.", 409);
    if (round.locksAt <= nowMs()) throw new GameError("Entries for this round just closed.", 409);

    const reference = round.openPrice ?? value;
    if (value > reference * 100 || value < reference / 100) {
      throw new GameError("That prediction is wildly outside the market range.");
    }

    const id = predictionId(roundId, user.id);
    const existing = await tx.get<PredictionDoc>(COLLECTIONS.ppPredictions, id);

    tx.set(COLLECTIONS.ppPredictions, id, {
      roundId,
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      value,
      createdAt: existing?.createdAt ?? nowMs(),
      updatedAt: nowMs(),
      absError: null,
      placement: null,
      points: null,
    });
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
  market: Market | undefined;
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

type Market = ReturnType<typeof marketById>;

async function viewRound(round: RoundRecord, viewerId?: string): Promise<RoundView> {
  const revealed = round.status === "resolved";
  const predictions = await predictionsFor(round.id);
  const mine = viewerId ? predictions.find((p) => p.userId === viewerId) : undefined;

  const entries: Entry[] = predictions
    // Other players' numbers stay hidden until the round settles.
    .filter((p) => revealed || p.userId === viewerId)
    .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99) || a.createdAt - b.createdAt)
    .map((p) => ({
      userId: p.userId,
      username: p.username,
      displayName: p.displayName,
      value: p.value,
      submittedAt: p.createdAt,
      absError: p.absError,
      placement: p.placement,
      points: p.points,
      isYou: p.userId === viewerId,
    }));

  return {
    id: round.id,
    market: marketById(round.marketId),
    status: round.status,
    opensAt: round.opensAt,
    locksAt: round.locksAt,
    resolvesAt: round.resolvesAt,
    openPrice: round.openPrice,
    finalPrice: round.finalPrice,
    resolvedAt: round.resolvedAt,
    entryCount: predictions.length,
    yourPrediction: mine
      ? { value: mine.value, submittedAt: mine.createdAt, placement: mine.placement, points: mine.points }
      : null,
    entries,
  };
}

export async function activeRounds(viewerId?: string): Promise<RoundView[]> {
  const rounds = (await recentRoundDocs())
    .filter((r) => r.status === "open" || r.status === "locked")
    .sort((a, b) => a.resolvesAt - b.resolvesAt);
  return Promise.all(rounds.map((r) => viewRound(r, viewerId)));
}

export async function recentRounds(limit = 6, viewerId?: string): Promise<RoundView[]> {
  const rounds = (await recentRoundDocs())
    .filter((r) => r.status === "resolved" || r.status === "void")
    .sort((a, b) => b.resolvesAt - a.resolvesAt)
    .slice(0, limit);
  return Promise.all(rounds.map((r) => viewRound(r, viewerId)));
}

export async function roundById(id: string, viewerId?: string): Promise<RoundView | null> {
  const db = await store();
  const round = await db.get<RoundRecord>(COLLECTIONS.ppRounds, id);
  return round ? viewRound({ ...round, id }, viewerId) : null;
}

export const sparkline = (marketId: string, minutes = 60) =>
  priceHistory(marketId, nowMs() - minutes * 60_000);

export const leaderboard = (gameId: string | null = GAME_ID, limit = 25) =>
  readLeaderboard(gameId, limit);
