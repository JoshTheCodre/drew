import { currentUser } from "@/lib/auth";
import { fail, json } from "@/lib/api";
import { roundById, tick } from "@/lib/games/price-prediction/engine";
import { nowMs } from "@/lib/clock";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await tick();
    const { id } = await ctx.params;
    const user = await currentUser();
    const round = await roundById(id, user?.id);
    if (!round) return json({ error: "Round not found." }, { status: 404 });
    return json({ round, now: nowMs() });
  } catch (error) {
    return fail(error);
  }
}
