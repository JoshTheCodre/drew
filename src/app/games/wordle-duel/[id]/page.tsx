import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { nowMs } from "@/lib/clock";
import { viewMatch } from "@/lib/games/wordle-duel/engine";
import { DuelBoard } from "@/components/wordle-duel/DuelBoard";
import { scheduleHousekeeping } from "@/lib/schedule";

export const metadata: Metadata = { title: "Duel" };
export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  scheduleHousekeeping();
  const { id } = await params;
  const user = await currentUser();
  const match = await viewMatch(id, user?.id);
  if (!match) notFound();

  return <DuelBoard initial={match} viewer={user} startedNow={nowMs()} />;
}
