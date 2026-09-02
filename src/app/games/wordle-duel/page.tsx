import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { getWallet } from "@/lib/wallet";
import { nowMs } from "@/lib/clock";
import {
  MATCH_SECONDS,
  MAX_GUESSES,
  RAKE_BPS,
  STAKE_PRESETS_CENTS,
  duelStandings,
  economics,
  myMatches,
  openChallenges,
  sweep,
} from "@/lib/games/wordle-duel/engine";
import { DuelLobby } from "@/components/wordle-duel/DuelLobby";

export const metadata: Metadata = { title: "Wordle Duel" };
export const dynamic = "force-dynamic";

export default async function WordleDuelPage() {
  await sweep();
  const user = await currentUser();

  const [wallet, challenges, mine, standings] = await Promise.all([
    user ? getWallet(user.id) : Promise.resolve(null),
    openChallenges(user?.id),
    user ? myMatches(user.id) : Promise.resolve([]),
    duelStandings(),
  ]);

  return (
    <DuelLobby
      initial={{
        now: nowMs(),
        user,
        wallet,
        challenges,
        mine,
        standings,
        config: {
          stakePresets: STAKE_PRESETS_CENTS.map((cents) => ({ cents, ...economics(cents) })),
          rakeBps: RAKE_BPS,
          matchSeconds: MATCH_SECONDS,
          maxGuesses: MAX_GUESSES,
        },
      }}
    />
  );
}
