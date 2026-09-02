import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getWallet, ledger } from "@/lib/wallet";
import { getCompliance, KYC_THRESHOLD_CENTS } from "@/lib/compliance";
import {
  MAX_DEPOSIT_CENTS,
  MIN_DEPOSIT_CENTS,
  MIN_WITHDRAWAL_CENTS,
  SIMULATED,
  payoutHistory,
} from "@/lib/payments";
import { WalletClient } from "@/components/WalletClient";

export const metadata: Metadata = { title: "Wallet" };
export const dynamic = "force-dynamic";

export default async function WalletPage() {
  const user = await currentUser();
  if (!user) redirect("/join?next=/wallet");

  const [wallet, entries, compliance, payouts] = await Promise.all([
    getWallet(user.id),
    ledger(user.id, 30),
    getCompliance(user.id),
    payoutHistory(user.id),
  ]);

  return (
    <WalletClient
      initial={{
        wallet,
        ledger: entries,
        compliance,
        payouts,
        config: {
          simulated: SIMULATED,
          minDepositCents: MIN_DEPOSIT_CENTS,
          maxDepositCents: MAX_DEPOSIT_CENTS,
          minWithdrawalCents: MIN_WITHDRAWAL_CENTS,
          kycThresholdCents: KYC_THRESHOLD_CENTS,
        },
      }}
    />
  );
}
