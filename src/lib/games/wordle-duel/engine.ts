import { db, tx } from "@/lib/db";
import { newId } from "@/lib/ids";
import { assertCanStake } from "@/lib/compliance";
import { forfeitHold, formatCents, hold, payout, releaseHold, takeRake } from "@/lib/wallet";
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
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type MatchRow = {
  id: string;
  word: string;
  stake_cents: number;
  rake_bps: number;
  status: MatchStatus;
  host_id: string;
  guest_id: string | null;
  winner_id: string | null;
  outcome: MatchOutcome;
  pot_cents: number | null;
  payout_cents: number | null;
  rake_cents: number | null;
  created_at: number;
  started_at: number | null;
  deadline_at: number | null;
  finished_at: number | null;
};

type GuessRow = {
  id: string;
  match_id: string;
  user_id: string;
  turn: number;
  guess: string;
  pattern: string;
  solved: number;
  created_at: number;
};

const getMatchRow = (id: string) =>
  db.prepare("SELECT * FROM wd_matches WHERE id = ?").get(id) as unknown as MatchRow | undefined;

const guessRows = (matchId: string) =>
  db
    .prepare("SELECT * FROM wd_guesses WHERE match_id = ? ORDER BY created_at ASC, turn ASC")
    .all(matchId) as unknown as GuessRow[];

/** pot, rake and winner take, derived from the stake. Never stored twice. */
export function economics(stakeCents: number, rakeBps = RAKE_BPS) {
  const pot = stakeCents * 2;
  const rake = Math.floor((pot * rakeBps) / 10_000);
  return { pot, rake, take: pot - rake };
}

/* ------------------------------------------------------------------ */
/* Settlement — the only place money leaves escrow                     */
/* ------------------------------------------------------------------ */

/**
 * Pays out a finished match. Must run inside a transaction: both players'
 * balances and the house cut move together or not at all.
 */
function settle(match: MatchRow, winnerId: string | null, outcome: Exclude<MatchOutcome, null>) {
  const now = Date.now();
  const players = [match.host_id, match.guest_id].filter((id): id is string => Boolean(id));
  const { pot, rake, take } = economics(match.stake_cents, match.rake_bps);

  if (winnerId) {
    const loserId = players.find((id) => id !== winnerId);

    // Winner gets their own stake back plus the opponent's, less the rake.
    releaseHold(winnerId, match.stake_cents, match.id, "Stake returned");
    payout(winnerId, take - match.stake_cents, match.id, `Won duel · ${formatCents(take)} of a ${formatCents(pot)} pot`);
    if (loserId) forfeitHold(loserId, match.stake_cents, match.id, "Lost duel");
    if (rake > 0) takeRake(rake, match.id, `Rake on ${match.id}`);

    db.prepare(
      `UPDATE wd_matches SET status = 'finished', winner_id = ?, outcome = ?, pot_cents = ?,
              payout_cents = ?, rake_cents = ?, finished_at = ? WHERE id = ?`,
    ).run(winnerId, outcome, pot, take, rake, now, match.id);
    return;
  }

  // No winner: every stake goes home, and the house takes nothing.
  for (const id of players) releaseHold(id, match.stake_cents, match.id, "Duel drawn — stake returned");
  db.prepare(
    `UPDATE wd_matches SET status = 'finished', winner_id = NULL, outcome = ?, pot_cents = ?,
            payout_cents = 0, rake_cents = 0, finished_at = ? WHERE id = ?`,
  ).run(outcome, pot, now, match.id);
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export function createMatch(userId: string, stakeCents: number): string {
  if (!Number.isInteger(stakeCents) || stakeCents < MIN_STAKE_CENTS) {
    throw new DuelError(`Minimum stake is ${formatCents(MIN_STAKE_CENTS)}.`);
  }
  if (stakeCents > MAX_STAKE_CENTS) {
    throw new DuelError(`Maximum stake is ${formatCents(MAX_STAKE_CENTS)}.`);
  }
  assertCanStake(userId, stakeCents);

  return tx(() => {
    const open = db
      .prepare("SELECT COUNT(*) AS n FROM wd_matches WHERE host_id = ? AND status = 'waiting'")
      .get(userId) as unknown as { n: number };
    if (open.n >= 3) {
      throw new DuelError("You already have three open challenges. Cancel one first.", 409);
    }

    const id = newId("wd");
    const now = Date.now();
    hold(userId, stakeCents, id, `Stake for duel ${id}`);
    db.prepare(
      `INSERT INTO wd_matches (id, word, stake_cents, rake_bps, status, host_id, created_at)
       VALUES (?, ?, ?, ?, 'waiting', ?, ?)`,
    ).run(id, pickAnswer(), stakeCents, RAKE_BPS, userId, now);
    return id;
  });
}

export function joinMatch(matchId: string, userId: string) {
  return tx(() => {
    const match = getMatchRow(matchId);
    if (!match) throw new DuelError("That challenge no longer exists.", 404);
    if (match.status !== "waiting") throw new DuelError("Someone already took this challenge.", 409);
    if (match.host_id === userId) throw new DuelError("You can't accept your own challenge.", 409);

    assertCanStake(userId, match.stake_cents);
    hold(userId, match.stake_cents, match.id, `Stake for duel ${match.id}`);

    const now = Date.now();
    db.prepare(
      "UPDATE wd_matches SET guest_id = ?, status = 'active', started_at = ?, deadline_at = ? WHERE id = ?",
    ).run(userId, now, now + MATCH_SECONDS * 1000, match.id);
  });
}

export function cancelMatch(matchId: string, userId: string) {
  return tx(() => {
    const match = getMatchRow(matchId);
    if (!match) throw new DuelError("That challenge no longer exists.", 404);
    if (match.host_id !== userId) throw new DuelError("Only the host can cancel a challenge.", 403);
    if (match.status !== "waiting") throw new DuelError("This match is already underway.", 409);

    releaseHold(userId, match.stake_cents, match.id, "Challenge cancelled — stake returned");
    db.prepare("UPDATE wd_matches SET status = 'cancelled', outcome = 'cancelled', finished_at = ? WHERE id = ?")
      .run(Date.now(), match.id);
  });
}

export function forfeitMatch(matchId: string, userId: string) {
  return tx(() => {
    const match = getMatchRow(matchId);
    if (!match) throw new DuelError("Match not found.", 404);
    if (match.status !== "active") throw new DuelError("This match isn't running.", 409);
    if (userId !== match.host_id && userId !== match.guest_id) {
      throw new DuelError("You aren't in this match.", 403);
    }
    const opponent = userId === match.host_id ? match.guest_id : match.host_id;
    settle(match, opponent, "forfeit");
  });
}

export function submitGuess(matchId: string, userId: string, rawGuess: string) {
  const guess = String(rawGuess ?? "").trim().toLowerCase();

  if (guess.length !== WORD_LENGTH) throw new DuelError(`Guesses are ${WORD_LENGTH} letters.`);
  if (!/^[a-z]+$/.test(guess)) throw new DuelError("Letters only.");
  if (!isValidGuess(guess)) throw new DuelError(`"${guess.toUpperCase()}" isn't in the word list.`);

  return tx(() => {
    const match = getMatchRow(matchId);
    if (!match) throw new DuelError("Match not found.", 404);
    if (userId !== match.host_id && userId !== match.guest_id) {
      throw new DuelError("You aren't in this match.", 403);
    }
    if (match.status !== "active") {
      // Losing the race by milliseconds deserves a better message than "closed".
      if (match.outcome === "solved" && match.winner_id !== userId) {
        throw new DuelError("Your opponent solved it first.", 409);
      }
      throw new DuelError("This match isn't accepting guesses.", 409);
    }
    if (match.deadline_at && match.deadline_at <= Date.now()) {
      settle(match, null, "expired");
      throw new DuelError("Time's up — the match expired and both stakes were returned.", 409);
    }

    const mine = guessRows(match.id).filter((g) => g.user_id === userId);
    if (mine.some((g) => g.solved)) throw new DuelError("You already solved it.", 409);
    if (mine.length >= MAX_GUESSES) throw new DuelError("You're out of guesses.", 409);

    const pattern = score(guess, match.word);
    const solved = pattern === "ggggg";
    const turn = mine.length + 1;

    db.prepare(
      "INSERT INTO wd_guesses (id, match_id, user_id, turn, guess, pattern, solved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(newId("wg"), match.id, userId, turn, guess, pattern, solved ? 1 : 0, Date.now());

    if (solved) {
      // First correct guess ends it — the write above is inside this transaction,
      // so a simultaneous opponent guess serialises behind it and loses the race.
      settle(match, userId, "solved");
      return { pattern, solved: true, turn };
    }

    // Both players out of guesses without solving: nobody wins, stakes return.
    const all = guessRows(match.id);
    const players = [match.host_id, match.guest_id].filter((id): id is string => Boolean(id));
    const exhausted = players.every((id) => all.filter((g) => g.user_id === id).length >= MAX_GUESSES);
    if (exhausted) settle(match, null, "both_failed");

    return { pattern, solved: false, turn };
  });
}

/**
 * Refunds matches whose clock ran out and invites nobody accepted.
 * Called from reads, so the lobby is self-cleaning.
 */
export function sweep() {
  const now = Date.now();

  const expired = db
    .prepare("SELECT * FROM wd_matches WHERE status = 'active' AND deadline_at IS NOT NULL AND deadline_at <= ?")
    .all(now) as unknown as MatchRow[];
  for (const match of expired) tx(() => settle(match, null, "expired"));

  const stale = db
    .prepare("SELECT * FROM wd_matches WHERE status = 'waiting' AND created_at <= ?")
    .all(now - LOBBY_TTL_SECONDS * 1000) as unknown as MatchRow[];
  for (const match of stale) {
    tx(() => {
      releaseHold(match.host_id, match.stake_cents, match.id, "Challenge expired — stake returned");
      db.prepare(
        "UPDATE wd_matches SET status = 'cancelled', outcome = 'cancelled', finished_at = ? WHERE id = ?",
      ).run(Date.now(), match.id);
    });
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

type UserLite = { id: string; username: string; display_name: string };

const userLite = (id: string) =>
  db.prepare("SELECT id, username, display_name FROM users WHERE id = ?").get(id) as unknown as
    | UserLite
    | undefined;

function playerView(
  user: UserLite,
  rows: GuessRow[],
  revealLetters: boolean,
): PlayerView {
  const mine = rows.filter((g) => g.user_id === user.id);
  const winning = mine.find((g) => g.solved);
  return {
    userId: user.id,
    username: user.username,
    displayName: user.display_name,
    // An opponent's letters stay hidden mid-match; only their colours show.
    guesses: mine.map((g) => ({
      turn: g.turn,
      guess: revealLetters ? g.guess : null,
      pattern: g.pattern,
      at: g.created_at,
    })),
    solved: Boolean(winning),
    solvedInTurns: winning ? winning.turn : null,
  };
}

export function viewMatch(matchId: string, viewerId?: string): MatchView | null {
  const match = getMatchRow(matchId);
  if (!match) return null;

  const rows = guessRows(match.id);
  const host = userLite(match.host_id);
  const guest = match.guest_id ? userLite(match.guest_id) : undefined;
  if (!host) return null;

  const over = match.status === "finished" || match.status === "cancelled";
  const yourRole: MatchView["yourRole"] =
    viewerId === match.host_id ? "host" : viewerId && viewerId === match.guest_id ? "guest" : "spectator";

  // Players see their own board on the left; spectators get host vs guest,
  // with both sets of letters hidden until the match is over.
  const youUser = yourRole === "guest" ? guest : host;
  const oppUser = yourRole === "guest" ? host : guest;
  const revealYours = yourRole !== "spectator" || over;
  const { pot, rake, take } = economics(match.stake_cents, match.rake_bps);

  return {
    id: match.id,
    status: match.status,
    outcome: match.outcome,
    stakeCents: match.stake_cents,
    potCents: match.pot_cents ?? pot,
    rakeCents: match.rake_cents ?? rake,
    takeCents: match.payout_cents ?? take,
    createdAt: match.created_at,
    startedAt: match.started_at,
    deadlineAt: match.deadline_at,
    finishedAt: match.finished_at,
    winnerId: match.winner_id,
    word: over ? match.word : null,
    you: youUser ? playerView(youUser, rows, revealYours) : null,
    opponent: oppUser ? playerView(oppUser, rows, over) : null,
    host: { userId: host.id, username: host.username, displayName: host.display_name },
    guest: guest ? { userId: guest.id, username: guest.username, displayName: guest.display_name } : null,
    yourRole,
  };
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

export function openChallenges(viewerId?: string, limit = 20): LobbyEntry[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.stake_cents, m.rake_bps, m.host_id, m.created_at, u.username, u.display_name
         FROM wd_matches m JOIN users u ON u.id = m.host_id
        WHERE m.status = 'waiting'
        ORDER BY m.stake_cents DESC, m.created_at ASC LIMIT ?`,
    )
    .all(limit) as unknown as Array<{
      id: string;
      stake_cents: number;
      rake_bps: number;
      host_id: string;
      created_at: number;
      username: string;
      display_name: string;
    }>;

  return rows.map((r) => {
    const { pot, take } = economics(r.stake_cents, r.rake_bps);
    return {
      id: r.id,
      stakeCents: r.stake_cents,
      potCents: pot,
      takeCents: take,
      hostId: r.host_id,
      hostName: r.display_name,
      hostUsername: r.username,
      createdAt: r.created_at,
      isYours: r.host_id === viewerId,
    };
  });
}

export function myMatches(userId: string, limit = 10): MatchView[] {
  const rows = db
    .prepare(
      `SELECT id FROM wd_matches
        WHERE (host_id = ? OR guest_id = ?) AND status IN ('active','finished')
        ORDER BY COALESCE(finished_at, started_at, created_at) DESC LIMIT ?`,
    )
    .all(userId, userId, limit) as unknown as Array<{ id: string }>;
  return rows.map((r) => viewMatch(r.id, userId)).filter((m): m is MatchView => Boolean(m));
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

/** Ranked by money won, straight out of the ledger. */
export function duelStandings(limit = 10): DuelStanding[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.display_name,
              COALESCE(SUM(CASE WHEN m.winner_id = u.id THEN 1 ELSE 0 END), 0) AS wins,
              COUNT(m.id) AS played,
              COALESCE(SUM(
                CASE WHEN m.winner_id = u.id THEN m.payout_cents - m.stake_cents
                     WHEN m.winner_id IS NULL THEN 0
                     ELSE -m.stake_cents END
              ), 0) AS net
         FROM wd_matches m
         JOIN users u ON u.id = m.host_id OR u.id = m.guest_id
        WHERE m.status = 'finished'
        GROUP BY u.id, u.username, u.display_name
        ORDER BY net DESC, wins DESC LIMIT ?`,
    )
    .all(limit) as unknown as Array<{
      id: string;
      username: string;
      display_name: string;
      wins: number;
      played: number;
      net: number;
    }>;

  return rows.map((r, i) => ({
    rank: i + 1,
    userId: r.id,
    username: r.username,
    displayName: r.display_name,
    wins: r.wins,
    played: r.played,
    netCents: r.net,
  }));
}
