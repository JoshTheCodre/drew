import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE } from "@/lib/auth";
import { fail, json } from "@/lib/api";

export async function POST() {
  try {
    const jar = await cookies();
    const sid = jar.get(SESSION_COOKIE)?.value;
    if (sid) destroySession(sid);
    jar.delete(SESSION_COOKIE);
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
