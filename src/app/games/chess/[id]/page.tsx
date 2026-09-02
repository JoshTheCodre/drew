import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { nowMs } from "@/lib/clock";
import { sweep, viewMatch } from "@/lib/games/chess/engine";
import { ChessGame } from "@/components/chess/ChessGame";

export const metadata: Metadata = { title: "Chess" };
export const dynamic = "force-dynamic";

export default async function ChessMatchPage({ params }: { params: Promise<{ id: string }> }) {
  await sweep();
  const { id } = await params;
  const user = await currentUser();
  const match = await viewMatch(id, user?.id);
  if (!match) notFound();

  return <ChessGame initial={match} viewer={user} startedNow={nowMs()} />;
}
