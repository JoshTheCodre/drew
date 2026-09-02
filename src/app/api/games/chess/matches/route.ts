import { requireUser } from "@/lib/auth";
import { fail, json, readJson } from "@/lib/api";
import { createMatch, viewMatch } from "@/lib/games/chess/engine";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await readJson(req);
    const stakeCents = Math.round(Number(body.stakeCents));
    const id = await createMatch(user, stakeCents);
    return json({ match: await viewMatch(id, user.id) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
