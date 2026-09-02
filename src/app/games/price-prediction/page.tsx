import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { MARKETS, readPrices } from "@/lib/markets";
import {
  activeRounds,
  leaderboard,
  recentRounds,
  sparkline,
} from "@/lib/games/price-prediction/engine";
import { nowMs } from "@/lib/clock";
import { PricePredictionClient } from "@/components/price-prediction/GameClient";
import { scheduleHousekeeping } from "@/lib/schedule";

export const metadata: Metadata = { title: "Price Prediction" };
export const dynamic = "force-dynamic";

export default async function PricePredictionPage() {
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

  return (
    <PricePredictionClient
      initial={{ now: nowMs(), user, markets, active, recent, leaderboard: standings }}
    />
  );
}
