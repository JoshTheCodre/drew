import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getWallet, ledger } from "@/lib/wallet";
import { getCompliance, KYC_THRESHOLD_CENTS } from "@/lib/compliance";
import { MAX_DEPOSIT_CENTS, MIN_DEPOSIT_CENTS, MIN_WITHDRAWAL_CENTS, SIMULATED, payoutHistory } from "@/lib/payments";
import { WalletClient } from "@/components/WalletClient";

export const metadata: Metadata = { title: "Wallet" };
export const dynamic = "force-dynamic";

export default async function WalletPage() {
  const user = await currentUser();
  if (!user) redirect("/join?next=/wallet");

  return (
    <WalletClient
      initial={{
        wallet: getWallet(user.id),
        ledger: ledger(user.id, 30),
        compliance: getCompliance(user.id),
        payouts: payoutHistory(user.id),
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
