import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { MARKETS, getPrices } from "@/lib/markets";
import { activeRounds, leaderboard, recentRounds, sparkline, tick } from "@/lib/games/price-prediction/engine";
import { PricePredictionClient } from "@/components/price-prediction/GameClient";

export const metadata: Metadata = { title: "Price Prediction" };
export const dynamic = "force-dynamic";

export default async function PricePredictionPage() {
  await tick();
  const user = await currentUser();
  const prices = await getPrices();

  const initial = {
    now: Date.now(),
    user,
    markets: MARKETS.map((m) => ({ ...m, price: prices.get(m.id) ?? null, history: sparkline(m.id, 90) })),
    active: activeRounds(user?.id),
    recent: recentRounds(6, user?.id),
    leaderboard: leaderboard("price-prediction", 10),
  };

  return <PricePredictionClient initial={initial} />;
}
