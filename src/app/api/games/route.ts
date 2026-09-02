import { GAMES } from "@/lib/games/registry";
import { json } from "@/lib/api";

export async function GET() {
  return json({ games: GAMES });
}
