import "server-only";
import { COLLECTIONS, store, type Tx } from "@/lib/firestore";
import { newId } from "@/lib/ids";
import { nowMs } from "@/lib/clock";
import { assertCanStake } from "@/lib/compliance";
import { formatCents, withLedger, type LedgerBatch } from "@/lib/wallet";
import { bumpLeaderboard } from "@/lib/leaderboard";
import type { User } from "@/lib/auth";
import { isValidGuess, pickAnswer, score } from "./words";

export const GAME_ID = "wordle-duel";

export const MAX_GUESSES = 6;
export const WORD_LENGTH = 5;

/** House cut, in basis points. 1000 = 10%, so $500 + $500 pays $900. */
export const RAKE_BPS = Number(process.env.WD_RAKE_BPS ?? 1000);

/** How long a match may run once both players are in. */
export const MATCH_SECONDS = Number(process.env.WD_MATCH_SECONDS ?? 300);

/** How long an unmatched invite waits before it is refunded automatically. */
export const LOBBY_TTL_SECONDS = Number(process.env.WD_LOBBY_TTL_SECONDS ?? 1800);

export const STAKE_PRESETS_CENTS = [500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000];
export const MIN_STAKE_CENTS = 100;
export const MAX_STAKE_CENTS = Number(process.env.WD_MAX_STAKE_CENTS ?? 100_000);

export type MatchStatus = "waiting" | "active" | "finished" | "cancelled";
export type MatchOutcome = "solved" | "both_failed" | "expired" | "forfeit" | "cancelled" | null;

export class DuelError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type StoredGuess = { turn: number; guess: string; pattern: string; solved: boolean; at: number };

/**
 * The entire match — including every guess — is one document. That is what
 * makes settlement atomic: a transaction on this single doc serialises two
 * players racing to submit the winning word.
 */
type MatchDoc = {
  word: string;
  stakeCents: number;
  rakeBps: number;
  status: MatchStatus;
  hostId: string;
  hostName: string;
  hostUsername: string;
  guestId: string | null;
  guestName: string | null;
  guestUsername: string | null;
  winnerId: string | null;
  outcome: MatchOutcome;
  potCents: number | null;
  payoutCents: number | null;
  rakeCents: number | null;
  createdAt: number;
  startedAt: number | null;
  deadlineAt: number | null;
  finishedAt: number | null;
  boards: Record<string, StoredGuess[]>;
};

type MatchRecord = MatchDoc & { id: string };

/** pot, rake and winner's take, derived from the stake. Never stored twice. */
export function economics(stakeCents: number, rakeBps = RAKE_BPS) {
  const pot = stakeCents * 2;
  const rake = Math.floor((pot * rakeBps) / 10_000);
  return { pot, rake, take: pot - rake };
}

const getMatch = async (id: string) =>
  (await store()).get<MatchRecord>(COLLECTIONS.wdMatches, id);

/* ------------------------------------------------------------------ */
/* Settlement — the only place money leaves escrow                     */
/* ------------------------------------------------------------------ */

/**
 * Applies the payout for a finished match. Runs inside an open transaction
 * with both wallets already loaded, so balances and the house cut move
 * together or not at all.
 */
function applySettlement(
  batch: LedgerBatch,
  tx: Tx,
  matchId: string,
  match: MatchDoc,
  winnerId: string | null,
  outcome: Exclude<MatchOutcome, null>,
) {
  const at = nowMs();
  const players = [match.hostId, match.guestId].filter((id): id is string => Boolean(id));
  const { pot, rake, take } = economics(match.stakeCents, match.rakeBps);

  if (winnerId) {
    const loserId = players.find((id) => id !== winnerId);

    // Winner gets their own stake back plus the opponent's, less the rake.
    batch.release(winnerId, match.stakeCents, matchId, "Stake returned");
    batch.payout(
      winnerId,
      take - match.stakeCents,
      matchId,
      `Won duel · ${formatCents(take)} of a ${formatCents(pot)} pot`,
    );
    if (loserId) batch.forfeit(loserId, match.stakeCents, matchId, "Lost duel");
    if (rake > 0) batch.rake(rake, matchId, `Rake on ${matchId}`);

    tx.update(COLLECTIONS.wdMatches, matchId, {
      status: "finished",
      winnerId,
      outcome,
      potCents: pot,
      payoutCents: take,
      rakeCents: rake,
      finishedAt: at,
    });
    return;
  }

  // No winner: every stake goes home and the house takes nothing.
  for (const id of players) batch.release(id, match.stakeCents, matchId, "Duel drawn — stake returned");
  tx.update(COLLECTIONS.wdMatches, matchId, {
    status: "finished",
    winnerId: null,
    outcome,
    potCents: pot,
    payoutCents: 0,
    rakeCents: 0,
    finishedAt: at,
  });
}

/** Standings are written after the money lands, so a retry can't double-count. */
async function recordResult(match: MatchDoc, winnerId: string | null) {
  const players: [string, string, string][] = [];
  players.push([match.hostId, match.hostUsername, match.hostName]);
  if (match.guestId) players.push([match.guestId, match.guestUsername ?? "", match.guestName ?? ""]);

  for (const [userId, username, displayName] of players) {
    await bumpLeaderboard(GAME_ID, {
      userId,
      username,
      displayName,
      points: winnerId === userId ? 100 : winnerId === null ? 25 : 10,
      won: winnerId === userId,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export async function createMatch(user: User, stakeCents: number): Promise<string> {
  if (!Number.isInteger(stakeCents) || stakeCents < MIN_STAKE_CENTS) {
    throw new DuelError(`Minimum stake is ${formatCents(MIN_STAKE_CENTS)}.`);
  }
  if (stakeCents > MAX_STAKE_CENTS) {
    throw new DuelError(`Maximum stake is ${formatCents(MAX_STAKE_CENTS)}.`);
  }
  await assertCanStake(user.id, stakeCents);

  const open = await openChallenges();
  if (open.filter((c) => c.hostId === user.id).length >= 3) {
    throw new DuelError("You already have three open challenges. Cancel one first.", 409);
  }

  const id = newId("wd");
  const at = nowMs();

  await withLedger([user.id], (batch, tx) => {
    batch.hold(user.id, stakeCents, id, `Stake for duel ${id}`);
    tx.set(COLLECTIONS.wdMatches, id, {
      word: pickAnswer(),
      stakeCents,
      rakeBps: RAKE_BPS,
      status: "waiting",
      hostId: user.id,
      hostName: user.display_name,
      hostUsername: user.username,
      guestId: null,
      guestName: null,
      guestUsername: null,
      winnerId: null,
      outcome: null,
      potCents: null,
      payoutCents: null,
      rakeCents: null,
      createdAt: at,
      startedAt: null,
      deadlineAt: null,
      finishedAt: null,
      boards: {},
    } satisfies MatchDoc);
  });

  return id;
}

export async function joinMatch(matchId: string, user: User): Promise<void> {
  const preview = await getMatch(matchId);
  if (!preview) throw new DuelError("That challenge no longer exists.", 404);
  if (preview.hostId === user.id) throw new DuelError("You can't accept your own challenge.", 409);
  await assertCanStake(user.id, preview.stakeCents);

  await withLedger([user.id], async (batch, tx) => {
    const match = await tx.get<MatchDoc>(COLLECTIONS.wdMatches, matchId);
    if (!match) throw new DuelError("That challenge no longer exists.", 404);
    if (match.status !== "waiting") throw new DuelError("Someone already took this challenge.", 409);

    batch.hold(user.id, match.stakeCents, matchId, `Stake for duel ${matchId}`);

    const at = nowMs();
    tx.update(COLLECTIONS.wdMatches, matchId, {
      guestId: user.id,
      guestName: user.display_name,
      guestUsername: user.username,
      status: "active",
      startedAt: at,
      deadlineAt: at + MATCH_SECONDS * 1000,
    });
  });
}

export async function cancelMatch(matchId: string, userId: string): Promise<void> {
  const preview = await getMatch(matchId);
  if (!preview) throw new DuelError("That challenge no longer exists.", 404);
  if (preview.hostId !== userId) throw new DuelError("Only the host can cancel a challenge.", 403);

  await withLedger([userId], async (batch, tx) => {
    const match = await tx.get<MatchDoc>(COLLECTIONS.wdMatches, matchId);
    if (!match) throw new DuelError("That challenge no longer exists.", 404);
    if (match.status !== "waiting") throw new DuelError("This match is already underway.", 409);

    batch.release(userId, match.stakeCents, matchId, "Challenge cancelled — stake returned");
    tx.update(COLLECTIONS.wdMatches, matchId, {
      status: "cancelled",
      outcome: "cancelled",
      finishedAt: nowMs(),
    });
  });
}

export async function forfeitMatch(matchId: string, userId: string): Promise<void> {
  const preview = await getMatch(matchId);
  if (!preview) throw new DuelError("Match not found.", 404);
  if (userId !== preview.hostId && userId !== preview.guestId) {
    throw new DuelError("You aren't in this match.", 403);
  }

  const players = [preview.hostId, preview.guestId].filter((id): id is string => Boolean(id));
  const settled = await withLedger(players, async (batch, tx) => {
    const match = await tx.get<MatchDoc>(COLLECTIONS.wdMatches, matchId);
    if (!match) throw new DuelError("Match not found.", 404);
    if (match.status !== "active") throw new DuelError("This match isn't running.", 409);

    const opponent = userId === match.hostId ? match.guestId : match.hostId;
    applySettlement(batch, tx, matchId, match, opponent, "forfeit");
    return { match, winnerId: opponent };
  });

  await recordResult(settled.match, settled.winnerId);
}

export type GuessResult = { pattern: string; solved: boolean; turn: number };

export async function submitGuess(
  matchId: string,
  userId: string,
  rawGuess: string,
): Promise<GuessResult> {
  const guess = String(rawGuess ?? "")
    .trim()
    .toLowerCase();

  if (guess.length !== WORD_LENGTH) throw new DuelError(`Guesses are ${WORD_LENGTH} letters.`);
  if (!/^[a-z]+$/.test(guess)) throw new DuelError("Letters only.");
  if (!isValidGuess(guess)) throw new DuelError(`"${guess.toUpperCase()}" isn't in the word list.`, 422);

  const preview = await getMatch(matchId);
  if (!preview) throw new DuelError("Match not found.", 404);
  if (userId !== preview.hostId && userId !== preview.guestId) {
    throw new DuelError("You aren't in this match.", 403);
  }

  const players = [preview.hostId, preview.guestId].filter((id): id is string => Boolean(id));

  const outcome = await withLedger(players, async (batch, tx) => {
    const match = await tx.get<MatchDoc>(COLLECTIONS.wdMatches, matchId);
    if (!match) throw new DuelError("Match not found.", 404);

    if (match.status !== "active") {
      // Losing the race by milliseconds deserves a better message than "closed".
      if (match.outcome === "solved" && match.winnerId !== userId) {
        throw new DuelError("Your opponent solved it first.", 409);
      }
      throw new DuelError("This match isn't accepting guesses.", 409);
    }

    if (match.deadlineAt && match.deadlineAt <= nowMs()) {
      applySettlement(batch, tx, matchId, match, null, "expired");
      throw new DuelError("Time's up — the match expired and both stakes were returned.", 409);
    }

    const boards = match.boards ?? {};
    const mine = boards[userId] ?? [];
    if (mine.some((g) => g.solved)) throw new DuelError("You already solved it.", 409);
    if (mine.length >= MAX_GUESSES) throw new DuelError("You're out of guesses.", 409);

    const pattern = score(guess, match.word);
    const solved = pattern === "ggggg";
    const turn = mine.length + 1;
    const updated = { ...boards, [userId]: [...mine, { turn, guess, pattern, solved, at: nowMs() }] };

    tx.update(COLLECTIONS.wdMatches, matchId, { boards: updated });

    if (solved) {
      applySettlement(batch, tx, matchId, { ...match, boards: updated }, userId, "solved");
      return { result: { pattern, solved, turn }, match, winnerId: userId as string | null };
    }

    // Both players out of guesses without solving: nobody wins, stakes return.
    const exhausted = players.every((id) => (updated[id]?.length ?? 0) >= MAX_GUESSES);
    if (exhausted) {
      applySettlement(batch, tx, matchId, { ...match, boards: updated }, null, "both_failed");
      return { result: { pattern, solved, turn }, match, winnerId: null };
    }

    return { result: { pattern, solved, turn }, match: null, winnerId: null };
  });

  if (outcome.match) await recordResult(outcome.match, outcome.winnerId);
  return outcome.result;
}

/**
 * Refunds matches whose clock ran out and invites nobody accepted.
 * Called from reads, so the lobby is self-cleaning.
 */
export async function sweep(): Promise<void> {
  const db = await store();
  const at = nowMs();

  const recent = await db.list<MatchRecord>(COLLECTIONS.wdMatches, {
    orderBy: [["createdAt", "desc"]],
    limit: 100,
  });

  const expired = recent.filter(
    (m) => m.status === "active" && m.deadlineAt !== null && m.deadlineAt <= at,
  );
  for (const match of expired) {
    const players = [match.hostId, match.guestId].filter((id): id is string => Boolean(id));
    try {
      const settled = await withLedger(players, async (batch, tx) => {
        const current = await tx.get<MatchDoc>(COLLECTIONS.wdMatches, match.id);
        if (!current || current.status !== "active") return null;
        applySettlement(batch, tx, match.id, current, null, "expired");
        return current;
      });
      if (settled) await recordResult(settled, null);
    } catch {
      // another request settled it first
    }
  }

  const stale = recent.filter(
    (m) => m.status === "waiting" && m.createdAt <= at - LOBBY_TTL_SECONDS * 1000,
  );
  for (const match of stale) {
    try {
      await cancelMatch(match.id, match.hostId);
    } catch {
      // already taken or cancelled
    }
  }
}

/* ------------------------------------------------------------------ */
/* Read models                                                         */
/* ------------------------------------------------------------------ */

export type GuessView = { turn: number; guess: string | null; pattern: string; at: number };

export type PlayerView = {
  userId: string;
  username: string;
  displayName: string;
  guesses: GuessView[];
  solved: boolean;
  solvedInTurns: number | null;
};

export type MatchView = {
  id: string;
  status: MatchStatus;
  outcome: MatchOutcome;
  stakeCents: number;
  potCents: number;
  rakeCents: number;
  takeCents: number;
  createdAt: number;
  startedAt: number | null;
  deadlineAt: number | null;
  finishedAt: number | null;
  winnerId: string | null;
  /** Only ever populated once the match is over. */
  word: string | null;
  you: PlayerView | null;
  opponent: PlayerView | null;
  host: { userId: string; username: string; displayName: string };
  guest: { userId: string; username: string; displayName: string } | null;
  yourRole: "host" | "guest" | "spectator";
};

function playerView(
  userId: string,
  username: string,
  displayName: string,
  guesses: StoredGuess[],
  revealLetters: boolean,
): PlayerView {
  const winning = guesses.find((g) => g.solved);
  return {
    userId,
    username,
    displayName,
    // An opponent's letters stay hidden mid-match; only their colours show.
    guesses: guesses.map((g) => ({
      turn: g.turn,
      guess: revealLetters ? g.guess : null,
      pattern: g.pattern,
      at: g.at,
    })),
    solved: Boolean(winning),
    solvedInTurns: winning ? winning.turn : null,
  };
}

function toView(match: MatchRecord, viewerId?: string): MatchView {
  const over = match.status === "finished" || match.status === "cancelled";
  const boards = match.boards ?? {};
  const yourRole: MatchView["yourRole"] =
    viewerId === match.hostId ? "host" : viewerId && viewerId === match.guestId ? "guest" : "spectator";

  const host = {
    userId: match.hostId,
    username: match.hostUsername,
    displayName: match.hostName,
  };
  const guest = match.guestId
    ? {
        userId: match.guestId,
        username: match.guestUsername ?? "",
        displayName: match.guestName ?? "",
      }
    : null;

  // Players see their own board on the left; spectators get host vs guest,
  // with both sets of letters hidden until the match is over.
  const you = yourRole === "guest" ? guest : host;
  const opponent = yourRole === "guest" ? host : guest;
  const revealYours = yourRole !== "spectator" || over;
  const { pot, rake, take } = economics(match.stakeCents, match.rakeBps);

  return {
    id: match.id,
    status: match.status,
    outcome: match.outcome,
    stakeCents: match.stakeCents,
    potCents: match.potCents ?? pot,
    rakeCents: match.rakeCents ?? rake,
    takeCents: match.payoutCents ?? take,
    createdAt: match.createdAt,
    startedAt: match.startedAt,
    deadlineAt: match.deadlineAt,
    finishedAt: match.finishedAt,
    winnerId: match.winnerId,
    word: over ? match.word : null,
    you: you ? playerView(you.userId, you.username, you.displayName, boards[you.userId] ?? [], revealYours) : null,
    opponent: opponent
      ? playerView(
          opponent.userId,
          opponent.username,
          opponent.displayName,
          boards[opponent.userId] ?? [],
          over,
        )
      : null,
    host,
    guest,
    yourRole,
  };
}

export async function viewMatch(id: string, viewerId?: string): Promise<MatchView | null> {
  const match = await getMatch(id);
  return match ? toView(match, viewerId) : null;
}

export type LobbyEntry = {
  id: string;
  stakeCents: number;
  potCents: number;
  takeCents: number;
  hostId: string;
  hostName: string;
  hostUsername: string;
  createdAt: number;
  isYours: boolean;
};

export async function openChallenges(viewerId?: string, limit = 20): Promise<LobbyEntry[]> {
  const db = await store();
  const rows = await db.list<MatchRecord>(COLLECTIONS.wdMatches, {
    where: [["status", "==", "waiting"]],
  });

  return rows
    .sort((a, b) => b.stakeCents - a.stakeCents || a.createdAt - b.createdAt)
    .slice(0, limit)
    .map((m) => {
      const { pot, take } = economics(m.stakeCents, m.rakeBps);
      return {
        id: m.id,
        stakeCents: m.stakeCents,
        potCents: pot,
        takeCents: take,
        hostId: m.hostId,
        hostName: m.hostName,
        hostUsername: m.hostUsername,
        createdAt: m.createdAt,
        isYours: m.hostId === viewerId,
      };
    });
}

export async function myMatches(userId: string, limit = 10): Promise<MatchView[]> {
  const db = await store();
  const [hosted, joined] = await Promise.all([
    db.list<MatchRecord>(COLLECTIONS.wdMatches, { where: [["hostId", "==", userId]] }),
    db.list<MatchRecord>(COLLECTIONS.wdMatches, { where: [["guestId", "==", userId]] }),
  ]);

  const seen = new Map<string, MatchRecord>();
  for (const m of [...hosted, ...joined]) {
    if (m.status === "active" || m.status === "finished" || m.status === "waiting") seen.set(m.id, m);
  }

  return [...seen.values()]
    .sort(
      (a, b) =>
        (b.finishedAt ?? b.startedAt ?? b.createdAt) - (a.finishedAt ?? a.startedAt ?? a.createdAt),
    )
    .slice(0, limit)
    .map((m) => toView(m, userId));
}

export type DuelStanding = {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  wins: number;
  played: number;
  netCents: number;
};

/** Ranked by money won, straight out of settled matches. */
export async function duelStandings(limit = 10): Promise<DuelStanding[]> {
  const db = await store();
  const recent = await db.list<MatchRecord>(COLLECTIONS.wdMatches, {
    orderBy: [["finishedAt", "desc"]],
    limit: 200,
  });

  const totals = new Map<string, Omit<DuelStanding, "rank">>();
  const seed = (userId: string, username: string, displayName: string) => {
    let row = totals.get(userId);
    if (!row) {
      row = { userId, username, displayName, wins: 0, played: 0, netCents: 0 };
      totals.set(userId, row);
    }
    return row;
  };

  for (const match of recent) {
    if (match.status !== "finished") continue;
    const players: [string, string, string][] = [[match.hostId, match.hostUsername, match.hostName]];
    if (match.guestId) players.push([match.guestId, match.guestUsername ?? "", match.guestName ?? ""]);

    for (const [userId, username, displayName] of players) {
      const row = seed(userId, username, displayName);
      row.played += 1;
      if (match.winnerId === userId) {
        row.wins += 1;
        row.netCents += (match.payoutCents ?? 0) - match.stakeCents;
      } else if (match.winnerId !== null) {
        row.netCents -= match.stakeCents;
      }
    }
  }

  return [...totals.values()]
    .sort((a, b) => b.netCents - a.netCents || b.wins - a.wins)
    .slice(0, limit)
    .map((row, i) => ({ rank: i + 1, ...row }));
}
