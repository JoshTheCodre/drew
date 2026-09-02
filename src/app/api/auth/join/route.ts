import { cookies } from "next/headers";
import { createSession, joinAsPlayer, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { fail, json, readJson } from "@/lib/api";
import { getWallet } from "@/lib/wallet";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const user = await joinAsPlayer({
      name: String(body.name ?? ""),
      dateOfBirth: String(body.dateOfBirth ?? ""),
      country: String(body.country ?? ""),
    });
    const session = await createSession(user.id);
    (await cookies()).set(SESSION_COOKIE, session.id, sessionCookieOptions(session.expiresAt));
    return json({ user, wallet: await getWallet(user.id) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
