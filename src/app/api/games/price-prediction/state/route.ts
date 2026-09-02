import { currentUser } from "@/lib/auth";
import { fail, json } from "@/lib/api";
import { MARKETS, getPrices } from "@/lib/markets";
import { activeRounds, leaderboard, recentRounds, sparkline, tick } from "@/lib/games/price-prediction/engine";

export const dynamic = "force-dynamic";

/** One call powers the whole game screen: rounds, prices, history, standings. */
export async function GET() {
  try {
    await tick();
    const user = await currentUser();
    const prices = await getPrices();

    return json({
      now: Date.now(),
      user,
      markets: MARKETS.map((m) => ({
        ...m,
        price: prices.get(m.id) ?? null,
        history: sparkline(m.id, 90),
      })),
      active: activeRounds(user?.id),
      recent: recentRounds(6, user?.id),
      leaderboard: leaderboard("price-prediction", 10),
    });
  } catch (error) {
    return fail(error);
  }
}
