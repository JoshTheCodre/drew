import { currentUser, requireUser } from "@/lib/auth";
import { fail, json, readJson } from "@/lib/api";
import { getWallet } from "@/lib/wallet";
import { nowMs } from "@/lib/clock";
import {
  ChessError,
  cancelMatch,
  joinMatch,
  playMove,
  resign,
  viewMatch,
} from "@/lib/games/chess/engine";
import { scheduleHousekeeping } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    scheduleHousekeeping();
    const { id } = await ctx.params;
    const user = await currentUser();
    const match = await viewMatch(id, user?.id);
    if (!match) return json({ error: "Game not found." }, { status: 404 });
    return json({ match, now: nowMs(), user, wallet: user ? await getWallet(user.id) : null });
  } catch (error) {
    return fail(error);
  }
}

/** join | move | resign | cancel */
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
      case "move":
        await playMove(id, user.id, {
          from: String(body.from ?? ""),
          to: String(body.to ?? ""),
          promotion: body.promotion ? String(body.promotion) : undefined,
        });
        break;
      case "resign":
        await resign(id, user.id);
        break;
      case "cancel":
        await cancelMatch(id, user.id);
        break;
      default:
        throw new ChessError(`Unknown action "${action}".`);
    }

    return json({ match: await viewMatch(id, user.id), wallet: await getWallet(user.id), now: nowMs() });
  } catch (error) {
    return fail(error);
  }
}
