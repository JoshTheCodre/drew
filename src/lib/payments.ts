import "server-only";
import { COLLECTIONS, store } from "./firestore";
import { newId } from "./ids";
import { nowMs } from "./clock";
import { formatCents, getWallet, withLedger, type Wallet } from "./wallet";

/**
 * Payment rail. The simulated provider settles instantly and moves fake money;
 * a real provider (Stripe, Adyen, a payout API) implements the same two methods
 * and nothing above this file changes.
 */

export const PROVIDER_ID = process.env.PAYMENTS_PROVIDER ?? "simulated";
export const SIMULATED = PROVIDER_ID === "simulated";

export const MIN_DEPOSIT_CENTS = 500; // $5
export const MAX_DEPOSIT_CENTS = Number(process.env.MAX_DEPOSIT_CENTS ?? 500_000); // $5,000
export const MIN_WITHDRAWAL_CENTS = 500;

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type ChargeResult = { ok: true; reference: string } | { ok: false; reason: string };
export type PayoutResult =
  | { ok: true; reference: string; status: "paid" | "pending" }
  | { ok: false; reason: string };

export interface PaymentProvider {
  readonly id: string;
  readonly simulated: boolean;
  charge(userId: string, cents: number): Promise<ChargeResult>;
  sendPayout(userId: string, cents: number, destination: string): Promise<PayoutResult>;
}

/** Deposits of exactly $13.13 are declined, so the failure path is testable. */
const DECLINE_AMOUNT_CENTS = 1313;

const simulatedProvider: PaymentProvider = {
  id: "simulated",
  simulated: true,
  async charge(_userId, cents) {
    if (cents === DECLINE_AMOUNT_CENTS) {
      return { ok: false, reason: "Card declined by issuer (simulated)." };
    }
    return { ok: true, reference: newId("ch") };
  },
  async sendPayout() {
    return { ok: true, reference: newId("po"), status: "paid" };
  },
};

export const payments: PaymentProvider = simulatedProvider;

/* ------------------------------------------------------------------ */

export async function makeDeposit(userId: string, cents: number): Promise<Wallet> {
  if (!Number.isInteger(cents) || cents <= 0) throw new PaymentError("Enter an amount to add.");
  if (cents < MIN_DEPOSIT_CENTS) {
    throw new PaymentError(`Minimum deposit is ${formatCents(MIN_DEPOSIT_CENTS)}.`);
  }
  if (cents > MAX_DEPOSIT_CENTS) {
    throw new PaymentError(`Maximum deposit is ${formatCents(MAX_DEPOSIT_CENTS)}.`);
  }

  const result = await payments.charge(userId, cents);
  if (!result.ok) throw new PaymentError(result.reason, 402);

  return withLedger([userId], (batch) => {
    batch.deposit(userId, cents, result.reference, `Deposit via ${payments.id}`);
    return batch.balance(userId);
  });
}

export async function requestWithdrawal(
  userId: string,
  cents: number,
  destination: string,
): Promise<Wallet> {
  if (!Number.isInteger(cents) || cents <= 0) throw new PaymentError("Enter an amount to withdraw.");
  if (cents < MIN_WITHDRAWAL_CENTS) {
    throw new PaymentError(`Minimum withdrawal is ${formatCents(MIN_WITHDRAWAL_CENTS)}.`);
  }

  const wallet = await getWallet(userId);
  if (wallet.availableCents < cents) {
    throw new PaymentError(
      `You can withdraw up to ${formatCents(wallet.availableCents)} — the rest is staked in live matches.`,
      402,
    );
  }

  const result = await payments.sendPayout(userId, cents, destination);
  if (!result.ok) throw new PaymentError(result.reason, 402);

  const payoutId = newId("pay");
  const at = nowMs();

  return withLedger([userId], (batch, tx) => {
    // Throws before anything is written if the balance moved underneath us.
    batch.withdraw(userId, cents, payoutId, `Withdrawal via ${payments.id}`);
    tx.set(COLLECTIONS.payouts, payoutId, {
      userId,
      amountCents: cents,
      status: result.status,
      destination,
      providerRef: result.reference,
      createdAt: at,
      settledAt: result.status === "paid" ? at : null,
    });
    return batch.balance(userId);
  });
}

export type PayoutRecord = {
  id: string;
  amountCents: number;
  status: string;
  destination: string | null;
  createdAt: number;
};

export async function payoutHistory(userId: string, max = 10): Promise<PayoutRecord[]> {
  const db = await store();
  const rows = await db.list<PayoutRecord>(COLLECTIONS.payouts, {
    where: [["userId", "==", userId]],
  });
  // Sorted here rather than in the query, so no composite index is needed.
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, max);
}
