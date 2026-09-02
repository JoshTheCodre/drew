import { currentUser } from "@/lib/auth";
import { fail, json } from "@/lib/api";
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

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    sweep();
    const user = await currentUser();
    return json({
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
    });
  } catch (error) {
    return fail(error);
  }
}
