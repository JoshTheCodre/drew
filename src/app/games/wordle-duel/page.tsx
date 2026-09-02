import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { getWallet } from "@/lib/wallet";
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
  sweep();
  const user = await currentUser();

  return (
    <DuelLobby
      initial={{
        now: Date.now(),
        user,
        wallet: user ? getWallet(user.id) : null,
        challenges: openChallenges(user?.id),
        mine: user ? myMatches(user.id) : [],
        standings: duelStandings(),
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
