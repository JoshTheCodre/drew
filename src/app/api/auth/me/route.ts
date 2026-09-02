import { currentUser } from "@/lib/auth";
import { fail, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ user: await currentUser() });
  } catch (error) {
    return fail(error);
  }
}
