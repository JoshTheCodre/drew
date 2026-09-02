import "server-only";
import { Chess } from "chess.js";
import { COLLECTIONS, store, type Tx } from "@/lib/firestore";
import { newId } from "@/lib/ids";
import { nowMs } from "@/lib/clock";
import { assertCanStake } from "@/lib/compliance";
import { formatCents, withLedger, type LedgerBatch } from "@/lib/wallet";
import { bumpLeaderboard } from "@/lib/leaderboard";
import type { User } from "@/lib/auth";

export const GAME_ID = "chess";

/** House cut, in basis points. 1000 = 10%, so $500 + $500 pays $900. */
export const RAKE_BPS = Number(process.env.CHESS_RAKE_BPS ?? 1000);

/** 5+3 blitz: five minutes each, three seconds added per move. */
export const BASE_SECONDS = Number(process.env.CHESS_BASE_SECONDS ?? 300);
export const INCREMENT_SECONDS = Number(process.env.CHESS_INCREMENT_SECONDS ?? 3);

export const LOBBY_TTL_SECONDS = Number(process.env.CHESS_LOBBY_TTL_SECONDS ?? 1800);

export const STAKE_PRESETS_CENTS = [500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000];
export const MIN_STAKE_CENTS = 100;
export const MAX_STAKE_CENTS = Number(process.env.CHESS_MAX_STAKE_CENTS ?? 100_000);

export const START_FEN = new Chess().fen();

export type Colour = "w" | "b";
export type MatchStatus = "waiting" | "active" | "finished" | "cancelled";
export type MatchOutcome =
  | "checkmate"
  | "resign"
  | "timeout"
  | "stalemate"
  | "draw"
  | "cancelled"
  | null;

export class ChessError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type MoveRecord = { san: string; from: string; to: string; colour: Colour; at: number };

/**
 * Like Wordle Duel, an entire game lives in one document — position, clocks and
 * move list included — so a transaction on it serialises everything and makes
 * settlement atomic.
 */
type MatchDoc = {
  fen: string;
  moves: MoveRecord[];
  stakeCents: number;
  rakeBps: number;
  status: MatchStatus;
  /** Who plays white is fixed when the game starts. */
  whiteId: string | null;
  blackId: string | null;
  hostId: string;
  hostName: string;
  hostUsername: string;
  guestId: string | null;
  guestName: string | null;
  guestUsername: string | null;
  whiteMs: number;
  blackMs: number;
  /** When the clock last started running for the side to move. */
  turnStartedAt: number | null;
  winnerId: string | null;
  outcome: MatchOutcome;
  reason: string | null;
  potCents: number | null;
  payoutCents: number | null;
  rakeCents: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

type MatchRecord = MatchDoc & { id: string };

export function economics(stakeCents: number, rakeBps = RAKE_BPS) {
  const pot = stakeCents * 2;
  const rake = Math.floor((pot * rakeBps) / 10_000);
  return { pot, rake, take: pot - rake };
}

const getMatch = async (id: string) => (await store()).get<MatchRecord>(COLLECTIONS.chessMatches, id);

/** Milliseconds left for the side to move, accounting for time already spent. */
export function clocksAt(match: MatchDoc, at: number): { whiteMs: number; blackMs: number } {
  if (match.status !== "active" || match.turnStartedAt === null) {
    return { whiteMs: match.whiteMs, blackMs: match.blackMs };
  }
  const spent = Math.max(0, at - match.turnStartedAt);
  const turn = new Chess(match.fen).turn();
  return {
    whiteMs: turn === "w" ? Math.max(0, match.whiteMs - spent) : match.whiteMs,
    blackMs: turn === "b" ? Math.max(0, match.blackMs - spent) : match.blackMs,
  };
}

const playerFor = (match: MatchDoc, colour: Colour) =>
  colour === "w" ? match.whiteId : match.blackId;

/* ------------------------------------------------------------------ */
/* Settlement                                                          */
/* ------------------------------------------------------------------ */

function applySettlement(
  batch: LedgerBatch,
  tx: Tx,
  matchId: string,
  match: MatchDoc,
  winnerId: string | null,
  outcome: Exclude<MatchOutcome, null>,
  reason: string,
  extra: Record<string, unknown> = {},
) {
  const at = nowMs();
  const players = [match.hostId, match.guestId].filter((id): id is string => Boolean(id));
  const { pot, rake, take } = economics(match.stakeCents, match.rakeBps);

  if (winnerId) {
    const loserId = players.find((id) => id !== winnerId);
    batch.release(winnerId, match.stakeCents, matchId, "Stake returned");
    batch.payout(
      winnerId,
      take - match.stakeCents,
      matchId,
      `Won at chess · ${formatCents(take)} of a ${formatCents(pot)} pot`,
    );
    if (loserId) batch.forfeit(loserId, match.stakeCents, matchId, "Lost at chess");
    if (rake > 0) batch.rake(rake, matchId, `Rake on ${matchId}`);
  } else {
    for (const id of players) batch.release(id, match.stakeCents, matchId, "Draw — stake returned");
  }

  tx.update(COLLECTIONS.chessMatches, matchId, {
    ...extra,
    status: "finished",
    winnerId,
    outcome,
    reason,
    potCents: pot,
    payoutCents: winnerId ? take : 0,
    rakeCents: winnerId ? rake : 0,
    turnStartedAt: null,
    finishedAt: at,
  });
}

async function recordResult(match: MatchDoc, winnerId: string | null) {
  const players: [string, string, string][] = [[match.hostId, match.hostUsername, match.hostName]];
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

/** Reads chess.js for a terminal position and turns it into an outcome. */
function terminalState(game: Chess): { outcome: Exclude<MatchOutcome, null>; reason: string } | null {
  if (game.isCheckmate()) {
    return { outcome: "checkmate", reason: `Checkmate — ${game.turn() === "w" ? "black" : "white"} wins.` };
  }
  if (game.isStalemate()) return { outcome: "stalemate", reason: "Stalemate — the game is drawn." };
  if (game.isInsufficientMaterial()) {
    return { outcome: "draw", reason: "Insufficient material — the game is drawn." };
  }
  if (game.isThreefoldRepetition()) {
    return { outcome: "draw", reason: "Threefold repetition — the game is drawn." };
  }
  if (game.isDraw()) return { outcome: "draw", reason: "Fifty-move rule — the game is drawn." };
  return null;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export async function createMatch(user: User, stakeCents: number): Promise<string> {
  if (!Number.isInteger(stakeCents) || stakeCents < MIN_STAKE_CENTS) {
    throw new ChessError(`Minimum stake is ${formatCents(MIN_STAKE_CENTS)}.`);
  }
  if (stakeCents > MAX_STAKE_CENTS) {
    throw new ChessError(`Maximum stake is ${formatCents(MAX_STAKE_CENTS)}.`);
  }
  await assertCanStake(user.id, stakeCents);

  const open = await openChallenges();
  if (open.filter((c) => c.hostId === user.id).length >= 3) {
    throw new ChessError("You already have three open challenges. Cancel one first.", 409);
  }

  const id = newId("ch");
  const at = nowMs();

  await withLedger([user.id], (batch, tx) => {
    batch.hold(user.id, stakeCents, id, `Stake for chess ${id}`);
    tx.set(COLLECTIONS.chessMatches, id, {
      fen: START_FEN,
      moves: [],
      stakeCents,
      rakeBps: RAKE_BPS,
      status: "waiting",
      whiteId: null,
      blackId: null,
      hostId: user.id,
      hostName: user.display_name,
      hostUsername: user.username,
      guestId: null,
      guestName: null,
      guestUsername: null,
      whiteMs: BASE_SECONDS * 1000,
      blackMs: BASE_SECONDS * 1000,
      turnStartedAt: null,
      winnerId: null,
      outcome: null,
      reason: null,
      potCents: null,
      payoutCents: null,
      rakeCents: null,
      createdAt: at,
      startedAt: null,
      finishedAt: null,
    } satisfies MatchDoc);
  });

  return id;
}

export async function joinMatch(matchId: string, user: User): Promise<void> {
  const preview = await getMatch(matchId);
  if (!preview) throw new ChessError("That challenge no longer exists.", 404);
  if (preview.hostId === user.id) throw new ChessError("You can't accept your own challenge.", 409);
  await assertCanStake(user.id, preview.stakeCents);

  // Colours are drawn here so neither player can pick the white advantage.
  const hostIsWhite = Math.random() < 0.5;

  await withLedger([user.id], async (batch, tx) => {
    const match = await tx.get<MatchDoc>(COLLECTIONS.chessMatches, matchId);
    if (!match) throw new ChessError("That challenge no longer exists.", 404);
    if (match.status !== "waiting") throw new ChessError("Someone already took this challenge.", 409);

    batch.hold(user.id, match.stakeCents, matchId, `Stake for chess ${matchId}`);

    const at = nowMs();
    tx.update(COLLECTIONS.chessMatches, matchId, {
      guestId: user.id,
      guestName: user.display_name,
      guestUsername: user.username,
      whiteId: hostIsWhite ? match.hostId : user.id,
      blackId: hostIsWhite ? user.id : match.hostId,
      status: "active",
      startedAt: at,
      turnStartedAt: at,
    });
  });
}

export async function cancelMatch(matchId: string, userId: string): Promise<void> {
  const preview = await getMatch(matchId);
  if (!preview) throw new ChessError("That challenge no longer exists.", 404);
  if (preview.hostId !== userId) throw new ChessError("Only the host can cancel a challenge.", 403);

  await withLedger([userId], async (batch, tx) => {
    const match = await tx.get<MatchDoc>(COLLECTIONS.chessMatches, matchId);
    if (!match) throw new ChessError("That challenge no longer exists.", 404);
    if (match.status !== "waiting") throw new ChessError("This game is already underway.", 409);

    batch.release(userId, match.stakeCents, matchId, "Challenge cancelled — stake returned");
    tx.update(COLLECTIONS.chessMatches, matchId, {
      status: "cancelled",
      outcome: "cancelled",
      reason: "Cancelled before anyone joined.",
      finishedAt: nowMs(),
    });
  });
}

export async function resign(matchId: string, userId: string): Promise<void> {
  const preview = await getMatch(matchId);
  if (!preview) throw new ChessError("Game not found.", 404);
  if (userId !== preview.hostId && userId !== preview.guestId) {
    throw new ChessError("You aren't in this game.", 403);
  }

  const players = [preview.hostId, preview.guestId].filter((id): id is string => Boolean(id));
  const settled = await withLedger(players, async (batch, tx) => {
    const match = await tx.get<MatchDoc>(COLLECTIONS.chessMatches, matchId);
    if (!match) throw new ChessError("Game not found.", 404);
    if (match.status !== "active") throw new ChessError("This game isn't running.", 409);

    const opponent = userId === match.hostId ? match.guestId : match.hostId;
    applySettlement(batch, tx, matchId, match, opponent, "resign", "Opponent resigned.");
    return { match, winnerId: opponent };
  });

  await recordResult(settled.match, settled.winnerId);
}

export type MoveInput = { from: string; to: string; promotion?: string };

export async function playMove(matchId: string, userId: string, move: MoveInput): Promise<void> {
  const preview = await getMatch(matchId);
  if (!preview) throw new ChessError("Game not found.", 404);
  if (userId !== preview.hostId && userId !== preview.guestId) {
    throw new ChessError("You aren't in this game.", 403);
  }

  const players = [preview.hostId, preview.guestId].filter((id): id is string => Boolean(id));

  const result = await withLedger(players, async (batch, tx) => {
    const match = await tx.get<MatchDoc>(COLLECTIONS.chessMatches, matchId);
    if (!match) throw new ChessError("Game not found.", 404);
    if (match.status !== "active") throw new ChessError("This game isn't accepting moves.", 409);

    const game = new Chess(match.fen);
    const turn = game.turn();
    if (playerFor(match, turn) !== userId) throw new ChessError("It isn't your move.", 409);

    // Flag first: a move that arrives after the clock hits zero doesn't count.
    const at = nowMs();
    const clocks = clocksAt(match, at);
    const remaining = turn === "w" ? clocks.whiteMs : clocks.blackMs;
    if (remaining <= 0) {
      const opponent = players.find((id) => id !== userId) ?? null;
      applySettlement(batch, tx, matchId, match, opponent, "timeout", "Flagged on time.", {
        whiteMs: clocks.whiteMs,
        blackMs: clocks.blackMs,
      });
      return { match, winnerId: opponent, settled: true };
    }

    let played;
    try {
      played = game.move({ from: move.from, to: move.to, promotion: move.promotion ?? "q" });
    } catch {
      throw new ChessError("That isn't a legal move.", 422);
    }
    if (!played) throw new ChessError("That isn't a legal move.", 422);

    const withIncrement = remaining + INCREMENT_SECONDS * 1000;
    const nextClocks = {
      whiteMs: turn === "w" ? withIncrement : clocks.whiteMs,
      blackMs: turn === "b" ? withIncrement : clocks.blackMs,
    };
    const moves = [
      ...match.moves,
      { san: played.san, from: played.from, to: played.to, colour: turn, at },
    ];

    const terminal = terminalState(game);
    if (terminal) {
      const winnerId =
        terminal.outcome === "checkmate" ? (playerFor(match, turn) ?? null) : null;
      applySettlement(batch, tx, matchId, match, winnerId, terminal.outcome, terminal.reason, {
        fen: game.fen(),
        moves,
        ...nextClocks,
      });
      return { match, winnerId, settled: true };
    }

    tx.update(COLLECTIONS.chessMatches, matchId, {
      fen: game.fen(),
      moves,
      ...nextClocks,
      turnStartedAt: at,
    });
    return { match: null, winnerId: null, settled: false };
  });

  if (result.settled && result.match) await recordResult(result.match, result.winnerId);
}

/** Settles games whose clock ran out, and refunds invites nobody accepted. */
export async function sweep(): Promise<void> {
  const db = await store();
  const at = nowMs();
  const recent = await db.list<MatchRecord>(COLLECTIONS.chessMatches, {
    orderBy: [["createdAt", "desc"]],
    limit: 100,
  });

  for (const match of recent.filter((m) => m.status === "active")) {
    const clocks = clocksAt(match, at);
    if (clocks.whiteMs > 0 && clocks.blackMs > 0) continue;

    const flagged = clocks.whiteMs <= 0 ? match.whiteId : match.blackId;
    const winnerId = [match.hostId, match.guestId].find((id) => id && id !== flagged) ?? null;
    const players = [match.hostId, match.guestId].filter((id): id is string => Boolean(id));

    try {
      const settled = await withLedger(players, async (batch, tx) => {
        const current = await tx.get<MatchDoc>(COLLECTIONS.chessMatches, match.id);
        if (!current || current.status !== "active") return null;
        applySettlement(batch, tx, match.id, current, winnerId, "timeout", "Flagged on time.", {
          whiteMs: clocks.whiteMs,
          blackMs: clocks.blackMs,
        });
        return current;
      });
      if (settled) await recordResult(settled, winnerId);
    } catch {
      // another request settled it first
    }
  }

  for (const match of recent.filter(
    (m) => m.status === "waiting" && m.createdAt <= at - LOBBY_TTL_SECONDS * 1000,
  )) {
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

export type Seat = {
  userId: string;
  username: string;
  displayName: string;
  colour: Colour | null;
  clockMs: number;
};

export type ChessView = {
  id: string;
  status: MatchStatus;
  outcome: MatchOutcome;
  reason: string | null;
  fen: string;
  moves: MoveRecord[];
  /** Legal moves for the viewer, keyed by origin square — drives the UI dots. */
  legalMoves: Record<string, string[]>;
  turn: Colour;
  inCheck: boolean;
  yourColour: Colour | null;
  yourTurn: boolean;
  stakeCents: number;
  potCents: number;
  rakeCents: number;
  takeCents: number;
  winnerId: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  turnStartedAt: number | null;
  you: Seat | null;
  opponent: Seat | null;
  host: Seat;
  guest: Seat | null;
  yourRole: "host" | "guest" | "spectator";
};

function toView(match: MatchRecord, viewerId?: string): ChessView {
  const at = nowMs();
  const game = new Chess(match.fen);
  const turn = game.turn();
  const clocks = clocksAt(match, at);

  const colourOf = (userId: string | null): Colour | null =>
    !userId ? null : match.whiteId === userId ? "w" : match.blackId === userId ? "b" : null;

  const seat = (userId: string, username: string, displayName: string): Seat => {
    const colour = colourOf(userId);
    return {
      userId,
      username,
      displayName,
      colour,
      clockMs: colour === "w" ? clocks.whiteMs : colour === "b" ? clocks.blackMs : match.whiteMs,
    };
  };

  const host = seat(match.hostId, match.hostUsername, match.hostName);
  const guest = match.guestId
    ? seat(match.guestId, match.guestUsername ?? "", match.guestName ?? "")
    : null;

  const yourRole: ChessView["yourRole"] =
    viewerId === match.hostId ? "host" : viewerId && viewerId === match.guestId ? "guest" : "spectator";
  const you = yourRole === "guest" ? guest : yourRole === "host" ? host : null;
  const opponent = yourRole === "guest" ? host : yourRole === "host" ? guest : null;

  const yourColour = you?.colour ?? null;
  const yourTurn = match.status === "active" && yourColour === turn;

  // Only hand the mover their own legal moves.
  const legalMoves: Record<string, string[]> = {};
  if (yourTurn) {
    for (const move of game.moves({ verbose: true })) {
      (legalMoves[move.from] ??= []).push(move.to);
    }
  }

  const { pot, rake, take } = economics(match.stakeCents, match.rakeBps);

  return {
    id: match.id,
    status: match.status,
    outcome: match.outcome,
    reason: match.reason,
    fen: match.fen,
    moves: match.moves ?? [],
    legalMoves,
    turn,
    inCheck: game.inCheck(),
    yourColour,
    yourTurn,
    stakeCents: match.stakeCents,
    potCents: match.potCents ?? pot,
    rakeCents: match.rakeCents ?? rake,
    takeCents: match.payoutCents ?? take,
    winnerId: match.winnerId,
    createdAt: match.createdAt,
    startedAt: match.startedAt,
    finishedAt: match.finishedAt,
    turnStartedAt: match.turnStartedAt,
    you,
    opponent,
    host,
    guest,
    yourRole,
  };
}

export async function viewMatch(id: string, viewerId?: string): Promise<ChessView | null> {
  const match = await getMatch(id);
  return match ? toView(match, viewerId) : null;
}

export type ChessLobbyEntry = {
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

export async function openChallenges(viewerId?: string, limit = 20): Promise<ChessLobbyEntry[]> {
  const db = await store();
  const rows = await db.list<MatchRecord>(COLLECTIONS.chessMatches, {
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

export async function myMatches(userId: string, limit = 10): Promise<ChessView[]> {
  const db = await store();
  const [hosted, joined] = await Promise.all([
    db.list<MatchRecord>(COLLECTIONS.chessMatches, { where: [["hostId", "==", userId]] }),
    db.list<MatchRecord>(COLLECTIONS.chessMatches, { where: [["guestId", "==", userId]] }),
  ]);

  const seen = new Map<string, MatchRecord>();
  for (const m of [...hosted, ...joined]) if (m.status !== "cancelled") seen.set(m.id, m);

  return [...seen.values()]
    .sort(
      (a, b) =>
        (b.finishedAt ?? b.startedAt ?? b.createdAt) - (a.finishedAt ?? a.startedAt ?? a.createdAt),
    )
    .slice(0, limit)
    .map((m) => toView(m, userId));
}
