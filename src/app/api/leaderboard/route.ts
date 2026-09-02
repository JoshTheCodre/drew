import { fail, json } from "@/lib/api";
import { leaderboard } from "@/lib/games/price-prediction/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const game = new URL(req.url).searchParams.get("game");
    const scope = !game || game === "all" ? null : game;
    return json({ game: scope ?? "all", rows: leaderboard(scope, 50) });
  } catch (error) {
    return fail(error);
  }
}
