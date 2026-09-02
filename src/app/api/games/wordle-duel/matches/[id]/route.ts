import { currentUser, requireUser } from "@/lib/auth";
import { fail, json, readJson } from "@/lib/api";
import { getWallet } from "@/lib/wallet";
import { nowMs } from "@/lib/clock";
import {
  DuelError,
  cancelMatch,
  forfeitMatch,
  joinMatch,
  submitGuess,
  viewMatch,
} from "@/lib/games/wordle-duel/engine";
import { scheduleHousekeeping } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    scheduleHousekeeping();
    const { id } = await ctx.params;
    const user = await currentUser();
    const match = await viewMatch(id, user?.id);
    if (!match) return json({ error: "Match not found." }, { status: 404 });
    return json({
      match,
      now: nowMs(),
      user,
      wallet: user ? await getWallet(user.id) : null,
    });
  } catch (error) {
    return fail(error);
  }
}

/** join | guess | cancel | forfeit */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const body = await readJson(req);
    const action = String(body.action ?? "");

    switch (action) {
      case "join":
        await joinMatch(id, user);
        break;
      case "guess":
        await submitGuess(id, user.id, String(body.guess ?? ""));
        break;
      case "cancel":
        await cancelMatch(id, user.id);
        break;
      case "forfeit":
        await forfeitMatch(id, user.id);
        break;
      default:
        throw new DuelError(`Unknown action "${action}".`);
    }

    return json({
      match: await viewMatch(id, user.id),
      wallet: await getWallet(user.id),
      now: nowMs(),
    });
  } catch (error) {
    return fail(error);
  }
}
