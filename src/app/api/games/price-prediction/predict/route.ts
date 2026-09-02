import { requireUser } from "@/lib/auth";
import { fail, json, readJson } from "@/lib/api";
import { GameError, roundById, submitPrediction, tick } from "@/lib/games/price-prediction/engine";

export async function POST(req: Request) {
  try {
    await tick();
    const user = await requireUser();
    const body = await readJson(req);

    const roundId = String(body.roundId ?? "");
    const value = Number(body.value);
    if (!roundId) throw new GameError("Which round are you predicting?");

    submitPrediction(roundId, user.id, value);
    return json({ round: roundById(roundId, user.id) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
