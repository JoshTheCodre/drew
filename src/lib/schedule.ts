import "server-only";
import { after } from "next/server";
import { nowMs } from "./clock";
import { tick } from "./games/price-prediction/engine";
import { sweep as sweepDuels } from "./games/wordle-duel/engine";
import { sweep as sweepChess } from "./games/chess/engine";

/**
 * Housekeeping — advancing rounds, settling expired matches — used to run on
 * the critical path of every render, which made the home page slow enough to
 * trip serverless execution limits.
 *
 * Now it runs *after* the response is sent, and at most once every few seconds
 * per process. Nothing a visitor waits for depends on it: the client polls the
 * state endpoints a moment later and picks up whatever changed.
 */

const EVERY_MS = Number(process.env.SCHEDULE_THROTTLE_MS ?? 4000);

type Slot = { lastRun: number; inflight: Promise<void> | null };
const g = globalThis as unknown as { __schedule?: Map<string, Slot> };
const slots: Map<string, Slot> = (g.__schedule ??= new Map());

function throttle(key: string, job: () => Promise<void>): Promise<void> {
  const slot = slots.get(key) ?? { lastRun: 0, inflight: null };
  slots.set(key, slot);

  // Coalesce: concurrent callers share one run instead of stampeding.
  if (slot.inflight) return slot.inflight;
  if (nowMs() - slot.lastRun < EVERY_MS) return Promise.resolve();

  slot.inflight = job()
    .catch((error) => console.error(`[schedule:${key}]`, error))
    .finally(() => {
      slot.lastRun = nowMs();
      slot.inflight = null;
    });
  return slot.inflight;
}

/** Every job, run inline. Used by /api/cron/tick. */
export async function runSchedulers(): Promise<void> {
  await Promise.all([
    tick().catch((e) => console.error("[schedule:tick]", e)),
    sweepDuels().catch((e) => console.error("[schedule:duels]", e)),
    sweepChess().catch((e) => console.error("[schedule:chess]", e)),
  ]);
}

/**
 * Queue housekeeping to run once this response has been sent. Safe to call from
 * any page or route handler — it never blocks and never throws.
 */
export function scheduleHousekeeping(): void {
  try {
    after(async () => {
      await Promise.all([
        throttle("pp-tick", tick),
        throttle("wd-sweep", sweepDuels),
        throttle("chess-sweep", sweepChess),
      ]);
    });
  } catch {
    // `after` is unavailable outside a request scope; skipping is fine.
  }
}
