import { currentUser } from "@/lib/auth";
import { fail, json } from "@/lib/api";
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
  sweep,
} from "@/lib/games/chess/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sweep();
    const user = await currentUser();

    const [wallet, challenges, mine] = await Promise.all([
      user ? getWallet(user.id) : Promise.resolve(null),
      openChallenges(user?.id),
      user ? myMatches(user.id) : Promise.resolve([]),
    ]);

    return json({
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
    });
  } catch (error) {
    return fail(error);
  }
}
