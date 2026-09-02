import { requireUser } from "@/lib/auth";
import { fail, json, readJson } from "@/lib/api";
import { makeDeposit } from "@/lib/payments";
import { ledger } from "@/lib/wallet";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await readJson(req);
    const cents = Math.round(Number(body.amountCents));
    const wallet = await makeDeposit(user.id, cents);
    return json({ wallet, ledger: ledger(user.id, 30) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
