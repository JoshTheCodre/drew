import { currentUser, requireUser } from "@/lib/auth";
import { fail, json, readJson } from "@/lib/api";
import { getWallet } from "@/lib/wallet";
import {
  DuelError,
  cancelMatch,
  forfeitMatch,
  joinMatch,
  submitGuess,
  sweep,
  viewMatch,
} from "@/lib/games/wordle-duel/engine";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    sweep();
    const { id } = await ctx.params;
    const user = await currentUser();
    const match = viewMatch(id, user?.id);
    if (!match) return json({ error: "Match not found." }, { status: 404 });
    return json({ match, now: Date.now(), user, wallet: user ? getWallet(user.id) : null });
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
        joinMatch(id, user.id);
        break;
      case "guess":
        submitGuess(id, user.id, String(body.guess ?? ""));
        break;
      case "cancel":
        cancelMatch(id, user.id);
        break;
      case "forfeit":
        forfeitMatch(id, user.id);
        break;
      default:
        throw new DuelError(`Unknown action "${action}".`);
    }

    return json({ match: viewMatch(id, user.id), wallet: getWallet(user.id), now: Date.now() });
  } catch (error) {
    return fail(error);
  }
}
