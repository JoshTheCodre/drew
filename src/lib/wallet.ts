import "server-only";
import { COLLECTIONS, store, type Tx } from "./firestore";
import { newId } from "./ids";
import { nowMs } from "./clock";
import { formatCents } from "./format";

export { formatCents, dollarsToCents } from "./format";

/**
 * Simulated currency, real accounting.
 *
 * Each wallet has two buckets:
 *   available — spendable now
 *   escrow    — committed to a live match, untouchable by either player
 *
 * Amounts are integer cents; nothing here touches floating point.
 *
 * Firestore transactions require every read before every write, so money moves
 * through a LedgerBatch: load the wallets involved, apply moves in memory, then
 * flush balances and the append-only ledger in one atomic write.
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
  userId: string;
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
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type WalletDoc = { availableCents: number; escrowCents: number; currency: string; updatedAt: number };

const emptyWallet = (userId: string): Wallet => ({
  userId,
  availableCents: 0,
  escrowCents: 0,
  currency: "USD",
});

export async function getWallet(userId: string): Promise<Wallet> {
  const db = await store();
  const doc = await db.get<WalletDoc>(COLLECTIONS.wallets, userId);
  return doc
    ? {
        userId,
        availableCents: doc.availableCents,
        escrowCents: doc.escrowCents,
        currency: doc.currency ?? "USD",
      }
    : emptyWallet(userId);
}

/* ------------------------------------------------------------------ */
/* LedgerBatch — the only path money takes                             */
/* ------------------------------------------------------------------ */

type EntryDraft = Omit<LedgerEntry, "availableAfter" | "escrowAfter"> & {
  availableAfter: number;
  escrowAfter: number;
};

export class LedgerBatch {
  private readonly balances = new Map<string, Wallet>();
  private readonly entries: EntryDraft[] = [];

  constructor(private readonly tx: Tx) {}

  /** Read phase. Every account this batch will touch must be listed here. */
  async load(userIds: string[]) {
    for (const userId of new Set(userIds)) {
      if (this.balances.has(userId)) continue;
      const doc = await this.tx.get<WalletDoc>(COLLECTIONS.wallets, userId);
      this.balances.set(
        userId,
        doc
          ? {
              userId,
              availableCents: doc.availableCents,
              escrowCents: doc.escrowCents,
              currency: doc.currency ?? "USD",
            }
          : emptyWallet(userId),
      );
    }
  }

  balance(userId: string): Wallet {
    const wallet = this.balances.get(userId);
    if (!wallet) throw new WalletError(`Wallet ${userId} was not loaded into this batch.`, 500);
    return wallet;
  }

  private move(
    userId: string,
    kind: LedgerKind,
    availableDelta: number,
    escrowDelta: number,
    refType: string | null,
    refId: string | null,
    memo: string | null,
  ) {
    const wallet = this.balance(userId);
    const availableAfter = wallet.availableCents + availableDelta;
    const escrowAfter = wallet.escrowCents + escrowDelta;

    if (availableAfter < 0) throw new WalletError("Not enough available balance.", 402);
    if (escrowAfter < 0) throw new WalletError("Escrow accounting would go negative.", 500);

    wallet.availableCents = availableAfter;
    wallet.escrowCents = escrowAfter;

    this.entries.push({
      id: newId("led"),
      userId,
      kind,
      availableDelta,
      escrowDelta,
      availableAfter,
      escrowAfter,
      refType,
      refId,
      memo,
      createdAt: nowMs(),
    });
  }

  deposit(userId: string, cents: number, refId?: string, memo?: string) {
    this.move(userId, "deposit", cents, 0, "payment", refId ?? null, memo ?? null);
  }

  withdraw(userId: string, cents: number, refId?: string, memo?: string) {
    this.move(userId, "withdrawal", -cents, 0, "payout", refId ?? null, memo ?? null);
  }

  /** Move a stake out of reach for the duration of a match. */
  hold(userId: string, cents: number, refId: string, memo?: string) {
    const wallet = this.balance(userId);
    if (wallet.availableCents < cents) {
      throw new WalletError(
        `You need ${formatCents(cents)} available to stake — you have ${formatCents(wallet.availableCents)}.`,
        402,
      );
    }
    this.move(userId, "stake_hold", -cents, cents, "wd_match", refId, memo ?? null);
  }

  /** Give a held stake back: draw, cancellation or expiry. */
  release(userId: string, cents: number, refId: string, memo?: string) {
    this.move(userId, "stake_release", cents, -cents, "wd_match", refId, memo ?? null);
  }

  /** The loser's stake leaves escrow and does not come back. */
  forfeit(userId: string, cents: number, refId: string, memo?: string) {
    this.move(userId, "stake_forfeit", 0, -cents, "wd_match", refId, memo ?? null);
  }

  /** Winnings on top of a released stake. */
  payout(userId: string, cents: number, refId: string, memo?: string) {
    this.move(userId, "payout", cents, 0, "wd_match", refId, memo ?? null);
  }

  rake(cents: number, refId: string, memo?: string) {
    this.move(HOUSE_ACCOUNT, "rake", cents, 0, "wd_match", refId, memo ?? null);
  }

  /** Write phase. Balances and ledger rows land together or not at all. */
  flush() {
    const at = nowMs();
    for (const wallet of this.balances.values()) {
      this.tx.set(COLLECTIONS.wallets, wallet.userId, {
        availableCents: wallet.availableCents,
        escrowCents: wallet.escrowCents,
        currency: wallet.currency,
        updatedAt: at,
      });
    }
    for (const entry of this.entries) {
      const { id, ...rest } = entry;
      this.tx.set(COLLECTIONS.ledger, id, rest);
    }
  }
}

/**
 * Runs `fn` inside a Firestore transaction with `userIds` already loaded, then
 * flushes. Anything that moves money should go through here.
 */
export async function withLedger<T>(
  userIds: string[],
  fn: (batch: LedgerBatch, tx: Tx) => Promise<T> | T,
): Promise<T> {
  const db = await store();
  return db.runTx(async (tx) => {
    const batch = new LedgerBatch(tx);
    await batch.load([...userIds, HOUSE_ACCOUNT]);
    const result = await fn(batch, tx);
    batch.flush();
    return result;
  });
}

/* ------------------------------------------------------------------ */

/**
 * Sorted in memory on purpose: pairing `where` with `orderBy` on a different
 * field would require a deployed composite index, and this app is meant to run
 * against a fresh Firestore project with no index setup at all.
 */
export async function ledger(userId: string, max = 30): Promise<LedgerEntry[]> {
  const db = await store();
  const rows = await db.list<LedgerEntry>(COLLECTIONS.ledger, {
    where: [["userId", "==", userId]],
  });
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, max);
}

export const houseBalance = () => getWallet(HOUSE_ACCOUNT);
