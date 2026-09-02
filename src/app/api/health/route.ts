import { COLLECTIONS, store } from "@/lib/firestore";
import { nowMs } from "@/lib/clock";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Deployment smoke test. Hit /api/health after deploying to see which Firestore
 * backend is live and whether it can actually read — far quicker than guessing
 * at a generic 500.
 */
export async function GET() {
  const started = nowMs();
  const report: Record<string, unknown> = {
    ok: false,
    at: started,
    node: process.version,
    env: {
      hasServiceAccount: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT),
      hasAppDefaultCreds: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "my-pro-35d45",
    },
  };

  try {
    const db = await store();
    report.storeMode = db.mode;
    const users = await db.count(COLLECTIONS.users);
    report.users = users;
    report.ok = true;
    report.ms = nowMs() - started;
    return json(report);
  } catch (error) {
    report.ms = nowMs() - started;
    report.error = error instanceof Error ? error.message : String(error);
    report.stack = error instanceof Error ? error.stack?.split("\n").slice(0, 4) : undefined;
    console.error("[health]", error);
    return json(report, { status: 500 });
  }
}
