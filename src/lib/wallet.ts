import { db } from "./db";
import { newId } from "./ids";
import { formatCents } from "./format";

/**
 * Simulated currency, real accounting. Every movement writes an append-only
 * ledger row, and a wallet's two buckets are the only mutable state:
 *
 *   available — spendable now
 *   escrow    — committed to a live match, untouchable by either player
 *
 * Balances are held in integer cents; nothing here uses floating point.
 * Callers that move money for more than one user must wrap these calls in
 * a single `tx()` so a match settles all-or-nothing.
 */

export const HOUSE_ACCOUNT = "house";

export type LedgerKind =
  | "deposit"
  | "withdrawal"
  | "stake_hold"
  | "stake_release"
  | "stake_forfeit"
  | "payout"
  | "rake"
  | "refund";

export type Wallet = {
  userId: string;
  availableCents: number;
  escrowCents: number;
  currency: string;
};

export type LedgerEntry = {
  id: string;
  kind: LedgerKind;
  availableDelta: number;
  escrowDelta: number;
  availableAfter: number;
  escrowAfter: number;
  refType: string | null;
  refId: string | null;
  memo: string | null;
  createdAt: number;
};

export class WalletError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type WalletRow = { user_id: string; available_cents: number; escrow_cents: number; currency: string };

export function ensureWallet(userId: string): Wallet {
  const existing = db
    .prepare("SELECT user_id, available_cents, escrow_cents, currency FROM wallets WHERE user_id = ?")
    .get(userId) as unknown as WalletRow | undefined;

  if (existing) {
    return {
      userId,
      availableCents: existing.available_cents,
      escrowCents: existing.escrow_cents,
      currency: existing.currency,
    };
  }

  db.prepare(
    "INSERT INTO wallets (user_id, available_cents, escrow_cents, currency, updated_at) VALUES (?, 0, 0, 'USD', ?)",
  ).run(userId, Date.now());
  return { userId, availableCents: 0, escrowCents: 0, currency: "USD" };
}

export const getWallet = (userId: string): Wallet => ensureWallet(userId);

type PostOptions = {
  userId: string;
  kind: LedgerKind;
  availableDelta?: number;
  escrowDelta?: number;
  refType?: string;
  refId?: string;
  memo?: string;
};

/** The single write path for money. Never mutate `wallets` outside this. */
function post({
  userId,
  kind,
  availableDelta = 0,
  escrowDelta = 0,
  refType,
  refId,
  memo,
}: PostOptions): Wallet {
  const isHouse = userId === HOUSE_ACCOUNT;
  const before = isHouse ? houseBalance() : ensureWallet(userId);

  const availableAfter = before.availableCents + availableDelta;
  const escrowAfter = before.escrowCents + escrowDelta;

  if (availableAfter < 0) throw new WalletError("Not enough available balance.", 402);
  if (escrowAfter < 0) throw new WalletError("Escrow accounting would go negative.", 500);

  const now = Date.now();
  if (!isHouse) {
    db.prepare("UPDATE wallets SET available_cents = ?, escrow_cents = ?, updated_at = ? WHERE user_id = ?")
      .run(availableAfter, escrowAfter, now, userId);
  }

  db.prepare(
    `INSERT INTO ledger_entries
       (id, user_id, kind, available_delta, escrow_delta, available_after, escrow_after, ref_type, ref_id, memo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId("led"),
    userId,
    kind,
    availableDelta,
    escrowDelta,
    availableAfter,
    escrowAfter,
    refType ?? null,
    refId ?? null,
    memo ?? null,
    now,
  );

  return { userId, availableCents: availableAfter, escrowCents: escrowAfter, currency: before.currency };
}

/** The house has no wallet row — its balance is the sum of its ledger. */
export function houseBalance(): Wallet {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(available_delta), 0) AS a, COALESCE(SUM(escrow_delta), 0) AS e FROM ledger_entries WHERE user_id = ?",
    )
    .get(HOUSE_ACCOUNT) as unknown as { a: number; e: number };
  return { userId: HOUSE_ACCOUNT, availableCents: row.a, escrowCents: row.e, currency: "USD" };
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

export const deposit = (userId: string, cents: number, ref?: string, memo?: string) =>
  post({ userId, kind: "deposit", availableDelta: cents, refType: "payment", refId: ref, memo });

export const withdraw = (userId: string, cents: number, ref?: string, memo?: string) =>
  post({ userId, kind: "withdrawal", availableDelta: -cents, refType: "payout", refId: ref, memo });

/** Move a stake out of reach for the duration of a match. */
export function hold(userId: string, cents: number, refId: string, memo?: string): Wallet {
  const wallet = ensureWallet(userId);
  if (wallet.availableCents < cents) {
    throw new WalletError(
      `You need ${formatCents(cents)} available to stake — you have ${formatCents(wallet.availableCents)}.`,
      402,
    );
  }
  return post({
    userId,
    kind: "stake_hold",
    availableDelta: -cents,
    escrowDelta: cents,
    refType: "wd_match",
    refId,
    memo,
  });
}

/** Give a held stake back (draw, cancellation, expiry). */
export const releaseHold = (userId: string, cents: number, refId: string, memo?: string) =>
  post({
    userId,
    kind: "stake_release",
    availableDelta: cents,
    escrowDelta: -cents,
    refType: "wd_match",
    refId,
    memo,
  });

/** Loser's stake leaves escrow and does not come back. */
export const forfeitHold = (userId: string, cents: number, refId: string, memo?: string) =>
  post({ userId, kind: "stake_forfeit", escrowDelta: -cents, refType: "wd_match", refId, memo });

/** Winnings on top of a released stake. */
export const payout = (userId: string, cents: number, refId: string, memo?: string) =>
  post({ userId, kind: "payout", availableDelta: cents, refType: "wd_match", refId, memo });

export const takeRake = (cents: number, refId: string, memo?: string) =>
  post({ userId: HOUSE_ACCOUNT, kind: "rake", availableDelta: cents, refType: "wd_match", refId, memo });

/* ------------------------------------------------------------------ */

type LedgerRow = {
  id: string;
  kind: LedgerKind;
  available_delta: number;
  escrow_delta: number;
  available_after: number;
  escrow_after: number;
  ref_type: string | null;
  ref_id: string | null;
  memo: string | null;
  created_at: number;
};

export function ledger(userId: string, limit = 30): LedgerEntry[] {
  const rows = db
    .prepare(
      `SELECT id, kind, available_delta, escrow_delta, available_after, escrow_after,
              ref_type, ref_id, memo, created_at
         FROM ledger_entries WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(userId, limit) as unknown as LedgerRow[];

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    availableDelta: r.available_delta,
    escrowDelta: r.escrow_delta,
    availableAfter: r.available_after,
    escrowAfter: r.escrow_after,
    refType: r.ref_type,
    refId: r.ref_id,
    memo: r.memo,
    createdAt: r.created_at,
  }));
}

export { formatCents, dollarsToCents } from "./format";
