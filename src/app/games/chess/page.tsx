import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { getWallet } from "@/lib/wallet";
import { nowMs } from "@/lib/clock";
import {
  BASE_SECONDS,
  INCREMENT_SECONDS,
  RAKE_BPS,
  STAKE_PRESETS_CENTS,
  economics,
  myMatches,
  openChallenges,
} from "@/lib/games/chess/engine";
import { ChessLobby } from "@/components/chess/ChessLobby";
import { scheduleHousekeeping } from "@/lib/schedule";

export const metadata: Metadata = { title: "Chess Stakes" };
export const dynamic = "force-dynamic";

export default async function ChessPage() {
  scheduleHousekeeping();
  const user = await currentUser();

  const [wallet, challenges, mine] = await Promise.all([
    user ? getWallet(user.id) : Promise.resolve(null),
    openChallenges(user?.id),
    user ? myMatches(user.id) : Promise.resolve([]),
  ]);

  return (
    <ChessLobby
      initial={{
        now: nowMs(),
        user,
        wallet,
        challenges,
        mine,
        config: {
          stakePresets: STAKE_PRESETS_CENTS.map((cents) => ({ cents, ...economics(cents) })),
          rakeBps: RAKE_BPS,
          baseSeconds: BASE_SECONDS,
          incrementSeconds: INCREMENT_SECONDS,
        },
      }}
    />
  );
}
