"use client";

import { useState } from "react";
import type { LedgerEntry, Wallet } from "@/lib/wallet";
import type { ComplianceRecord } from "@/lib/compliance";
import type { PayoutRecord } from "@/lib/payments";
import { clockTime, formatCents } from "@/lib/format";

type WalletState = {
  wallet: Wallet;
  ledger: LedgerEntry[];
  compliance: ComplianceRecord;
  payouts: PayoutRecord[];
  config: {
    simulated: boolean;
    minDepositCents: number;
    maxDepositCents: number;
    minWithdrawalCents: number;
    kycThresholdCents: number;
  };
};

const LABELS: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  stake_hold: "Stake held",
  stake_release: "Stake returned",
  stake_forfeit: "Stake lost",
  payout: "Winnings",
  rake: "House fee",
  refund: "Refund",
};

const TOP_UPS = [2_500, 10_000, 25_000, 50_000, 100_000];

export function WalletClient({ initial }: { initial: WalletState }) {
  const [state, setState] = useState(initial);
  const [amount, setAmount] = useState("100");
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFlash(null);
    setBusy(true);
    const cents = Math.round(Number(amount) * 100);
    try {
      const res = await fetch(`/api/wallet/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents: cents, destination: "simulated-account" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That didn't work.");
        return;
      }
      setState((s) => ({ ...s, wallet: data.wallet, ledger: data.ledger, payouts: data.payouts ?? s.payouts }));
      setFlash(
        mode === "deposit" ? `Added ${formatCents(cents)} to your balance.` : `Withdrew ${formatCents(cents)}.`,
      );
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  const { wallet, config, compliance } = state;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="display display-hero text-5xl sm:text-6xl">Wallet</h1>

      {config.simulated && (
        <p className="mt-6 rounded-2xl border border-warn/30 bg-warn/5 px-5 py-4 text-sm text-warn">
          <strong className="font-semibold">Simulated money.</strong> Deposits and withdrawals run through a
          fake provider — no card is charged and no real funds move. The accounting underneath is real:
          every movement is written to an append-only ledger.
        </p>
      )}

      <div className="mt-7 grid gap-4 sm:grid-cols-3">
        <Card label="Available" value={formatCents(wallet.availableCents)} tone="lime" />
        <Card label="In escrow" value={formatCents(wallet.escrowCents)} tone="warn" />
        <Card label="Total" value={formatCents(wallet.availableCents + wallet.escrowCents)} tone="plain" />
      </div>

      <div className="panel mt-6 p-7">
        <div className="grid max-w-xs grid-cols-2 gap-1 rounded-2xl border border-line-soft bg-bg-soft p-1">
          {(["deposit", "withdraw"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError(null);
                setFlash(null);
              }}
              className={`rounded-xl py-2.5 text-sm font-semibold capitalize transition-colors ${
                mode === m ? "bg-accent text-bg" : "text-muted hover:text-ink"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "deposit" && (
          <div className="mt-6 flex flex-wrap gap-2">
            {TOP_UPS.map((cents) => (
              <button
                key={cents}
                onClick={() => setAmount(String(cents / 100))}
                className="tabular rounded-xl border border-line-soft px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-lime/50 hover:text-ink"
              >
                {formatCents(cents)}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="mt-6 flex flex-wrap items-end gap-4">
          <label className="min-w-[200px] flex-1">
            <span className="text-xs uppercase tracking-widest text-dim">Amount</span>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-line bg-bg-soft px-5 py-3.5 focus-within:border-lime/60">
              <span className="text-dim">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular w-full bg-transparent text-xl outline-none"
              />
            </div>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="display rounded-2xl bg-lime px-8 py-4 text-lg text-bg transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
          >
            {busy ? "…" : mode === "deposit" ? "Add funds" : "Withdraw"}
          </button>
        </form>

        {error && <p className="mt-4 text-sm font-semibold text-bad">{error}</p>}
        {flash && <p className="mt-4 text-sm font-semibold text-lime">{flash}</p>}

        <p className="mt-4 text-xs text-dim">
          {mode === "deposit"
            ? `Between ${formatCents(config.minDepositCents)} and ${formatCents(config.maxDepositCents)}. A deposit of exactly $13.13 is declined on purpose, so the failure path is reachable.`
            : `Minimum ${formatCents(config.minWithdrawalCents)}. Money locked in a live match can't be withdrawn until it settles.`}
        </p>
      </div>

      {/* Compliance */}
      <div className="panel mt-6 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="display text-xl">Identity check</h2>
            <p className="mt-1.5 text-sm text-muted">
              Required for stakes of {formatCents(config.kycThresholdCents)} and up. Run against a simulated
              vendor when you joined.
            </p>
          </div>
          <span
            className={`chip ${
              compliance.kycStatus === "verified"
                ? "bg-lime/15 text-lime"
                : compliance.kycStatus === "rejected"
                  ? "bg-bad/15 text-bad"
                  : "bg-panel-2 text-dim"
            }`}
          >
            {compliance.kycStatus}
          </span>
        </div>
        {compliance.kycStatus === "verified" && (
          <p className="mt-3 text-xs text-dim">
            {compliance.legalName} · {compliance.country} · born {compliance.dateOfBirth}
          </p>
        )}
      </div>

      {/* Ledger */}
      <div className="panel mt-6 overflow-hidden">
        <h2 className="display border-b border-line-soft px-6 py-4 text-xl">Transaction history</h2>
        {state.ledger.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-dim">Nothing here yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {state.ledger.map((entry) => {
              const net = entry.availableDelta;
              return (
                <li key={entry.id} className="flex items-center gap-4 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{LABELS[entry.kind] ?? entry.kind}</div>
                    <div className="truncate text-xs text-dim">
                      {entry.memo ?? entry.refId} · {clockTime(entry.createdAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`tabular text-sm font-semibold ${
                        net > 0 ? "text-lime" : net < 0 ? "text-bad" : "text-muted"
                      }`}
                    >
                      {net === 0 ? "—" : `${net > 0 ? "+" : "−"}${formatCents(Math.abs(net))}`}
                    </div>
                    <div className="tabular text-xs text-dim">bal {formatCents(entry.availableAfter)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone: "lime" | "warn" | "plain" }) {
  const color = tone === "lime" ? "text-lime" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="panel px-5 py-5">
      <div className="text-xs uppercase tracking-widest text-dim">{label}</div>
      <div className={`display mt-1.5 text-3xl ${color}`}>{value}</div>
    </div>
  );
}
