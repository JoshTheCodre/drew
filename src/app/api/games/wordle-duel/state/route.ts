import { currentUser } from "@/lib/auth";
import { fail, json } from "@/lib/api";
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
} from "@/lib/games/wordle-duel/engine";
import { scheduleHousekeeping } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    scheduleHousekeeping();
    const user = await currentUser();

    const [wallet, challenges, mine, standings] = await Promise.all([
      user ? getWallet(user.id) : Promise.resolve(null),
      openChallenges(user?.id),
      user ? myMatches(user.id) : Promise.resolve([]),
      duelStandings(),
    ]);

    return json({
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
    });
  } catch (error) {
    return fail(error);
  }
}
