import { requireUser } from "@/lib/auth";
import { fail, json } from "@/lib/api";
import { getWallet, ledger } from "@/lib/wallet";
import { getCompliance, KYC_THRESHOLD_CENTS } from "@/lib/compliance";
import {
  MAX_DEPOSIT_CENTS,
  MIN_DEPOSIT_CENTS,
  MIN_WITHDRAWAL_CENTS,
  SIMULATED,
  payoutHistory,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const [wallet, entries, compliance, payouts] = await Promise.all([
      getWallet(user.id),
      ledger(user.id, 30),
      getCompliance(user.id),
      payoutHistory(user.id),
    ]);

    return json({
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
    });
  } catch (error) {
    return fail(error);
  }
}
