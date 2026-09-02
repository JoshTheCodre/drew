import { requireUser } from "@/lib/auth";
import { fail, json, readJson } from "@/lib/api";
import { payoutHistory, requestWithdrawal } from "@/lib/payments";
import { ledger } from "@/lib/wallet";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await readJson(req);
    const cents = Math.round(Number(body.amountCents));
    const destination = String(body.destination ?? "").trim() || "simulated-account";
    const wallet = await requestWithdrawal(user.id, cents, destination);
    return json({ wallet, ledger: ledger(user.id, 30), payouts: payoutHistory(user.id) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
