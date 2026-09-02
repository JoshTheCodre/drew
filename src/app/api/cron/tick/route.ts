import { fail, json } from "@/lib/api";
import { tick } from "@/lib/games/price-prediction/engine";

export const dynamic = "force-dynamic";

/**
 * Round scheduler. Rounds also advance lazily on any read, so this only
 * matters for keeping things moving while nobody is watching.
 * Set CRON_SECRET and send it as ?secret= or an Authorization: Bearer header.
 */
async function run(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const url = new URL(req.url);
      const provided =
        url.searchParams.get("secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (provided !== secret) return json({ error: "Unauthorized" }, { status: 401 });
    }
    await tick();
    return json({ ok: true, at: Date.now() });
  } catch (error) {
    return fail(error);
  }
}

export const GET = run;
export const POST = run;
