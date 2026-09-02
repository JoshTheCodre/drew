import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { sweep, viewMatch } from "@/lib/games/wordle-duel/engine";
import { DuelBoard } from "@/components/wordle-duel/DuelBoard";

export const metadata: Metadata = { title: "Duel" };
export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  sweep();
  const { id } = await params;
  const user = await currentUser();
  const match = viewMatch(id, user?.id);
  if (!match) notFound();

  return <DuelBoard initial={match} viewer={user} startedNow={Date.now()} />;
}
