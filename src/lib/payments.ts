import { db, tx } from "./db";
import { newId } from "./ids";
import { deposit as creditWallet, withdraw as debitWallet, ensureWallet, formatCents } from "./wallet";

/**
 * Payment rail. The simulated provider settles instantly and moves fake money;
 * a real provider (Stripe, Adyen, a payout API) implements the same two methods
 * and everything above this file is unchanged.
 */

export const PROVIDER_ID = process.env.PAYMENTS_PROVIDER ?? "simulated";
export const SIMULATED = PROVIDER_ID === "simulated";

export const MIN_DEPOSIT_CENTS = 500; // $5
export const MAX_DEPOSIT_CENTS = Number(process.env.MAX_DEPOSIT_CENTS ?? 500_000); // $5,000
export const MIN_WITHDRAWAL_CENTS = 500;

export class PaymentError extends Error {
  constructor(message: string, readonly status = 400) {
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
  async sendPayout(_userId, _cents, _destination) {
    return { ok: true, reference: newId("po"), status: "paid" };
  },
};

export const payments: PaymentProvider = simulatedProvider;

/* ------------------------------------------------------------------ */

export async function makeDeposit(userId: string, cents: number) {
  if (!Number.isInteger(cents) || cents <= 0) throw new PaymentError("Enter an amount to add.");
  if (cents < MIN_DEPOSIT_CENTS) {
    throw new PaymentError(`Minimum deposit is ${formatCents(MIN_DEPOSIT_CENTS)}.`);
  }
  if (cents > MAX_DEPOSIT_CENTS) {
    throw new PaymentError(`Maximum deposit is ${formatCents(MAX_DEPOSIT_CENTS)}.`);
  }

  const result = await payments.charge(userId, cents);
  if (!result.ok) throw new PaymentError(result.reason, 402);

  return tx(() => creditWallet(userId, cents, result.reference, `Deposit via ${payments.id}`));
}

export async function requestWithdrawal(userId: string, cents: number, destination: string) {
  if (!Number.isInteger(cents) || cents <= 0) throw new PaymentError("Enter an amount to withdraw.");
  if (cents < MIN_WITHDRAWAL_CENTS) {
    throw new PaymentError(`Minimum withdrawal is ${formatCents(MIN_WITHDRAWAL_CENTS)}.`);
  }

  const wallet = ensureWallet(userId);
  if (wallet.availableCents < cents) {
    throw new PaymentError(
      `You can withdraw up to ${formatCents(wallet.availableCents)} — the rest is staked in live matches.`,
      402,
    );
  }

  const result = await payments.sendPayout(userId, cents, destination);
  if (!result.ok) throw new PaymentError(result.reason, 402);

  const payoutId = newId("pay");
  return tx(() => {
    db.prepare(
      `INSERT INTO payouts (id, user_id, amount_cents, status, destination, provider_ref, created_at, settled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      payoutId,
      userId,
      cents,
      result.status,
      destination,
      result.reference,
      Date.now(),
      result.status === "paid" ? Date.now() : null,
    );
    return debitWallet(userId, cents, payoutId, `Withdrawal via ${payments.id}`);
  });
}

export type PayoutRecord = {
  id: string;
  amountCents: number;
  status: string;
  destination: string | null;
  createdAt: number;
};

export function payoutHistory(userId: string, limit = 10): PayoutRecord[] {
  const rows = db
    .prepare(
      "SELECT id, amount_cents, status, destination, created_at FROM payouts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(userId, limit) as unknown as Array<{
      id: string;
      amount_cents: number;
      status: string;
      destination: string | null;
      created_at: number;
    }>;

  return rows.map((r) => ({
    id: r.id,
    amountCents: r.amount_cents,
    status: r.status,
    destination: r.destination,
    createdAt: r.created_at,
  }));
}
