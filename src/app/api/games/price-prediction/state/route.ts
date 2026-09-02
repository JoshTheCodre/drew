import { currentUser } from "@/lib/auth";
import { fail, json } from "@/lib/api";
import { MARKETS, readPrices } from "@/lib/markets";
import {
  activeRounds,
  leaderboard,
  recentRounds,
  sparkline,
} from "@/lib/games/price-prediction/engine";
import { nowMs } from "@/lib/clock";
import { scheduleHousekeeping } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/** One call powers the whole game screen: rounds, prices, history, standings. */
export async function GET() {
  try {
    scheduleHousekeeping();
    const user = await currentUser();
    const prices = await readPrices();

    const markets = await Promise.all(
      MARKETS.map(async (m) => ({
        ...m,
        price: prices.get(m.id) ?? null,
        history: await sparkline(m.id, 90),
      })),
    );

    const [active, recent, standings] = await Promise.all([
      activeRounds(user?.id),
      recentRounds(6, user?.id),
      leaderboard("price-prediction", 10),
    ]);

    return json({ now: nowMs(), user, markets, active, recent, leaderboard: standings });
  } catch (error) {
    return fail(error);
  }
}
