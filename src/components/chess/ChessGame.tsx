"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChessView } from "@/lib/games/chess/engine";
import type { User } from "@/lib/auth";
import { countdown, formatCents } from "@/lib/format";
import { ChessBoard } from "./ChessBoard";

const POLL_MS = 1500;

export function ChessGame({
  initial,
  viewer,
  startedNow,
}: {
  initial: ChessView;
  viewer: User | null;
  startedNow: number;
}) {
  const [match, setMatch] = useState(initial);
  const [now, setNow] = useState(startedNow);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const isPlayer = match.yourRole !== "spectator";
  const live = match.status === "active";
  const over = match.status === "finished" || match.status === "cancelled";

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/games/chess/matches/${initial.id}`, { cache: "no-store" });
      if (res.ok) setMatch((await res.json()).match);
    } catch {
      /* next poll picks it up */
    } finally {
      inFlight.current = false;
    }
  }, [initial.id]);

  useEffect(() => {
    if (over) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, over]);

  const send = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/games/chess/matches/${initial.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "That didn't work.");
          refresh();
          return false;
        }
        setMatch(data.match);
        return true;
      } catch {
        setError("Network hiccup — try again.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [initial.id, refresh],
  );

  const lastMove = match.moves.length ? match.moves[match.moves.length - 1] : null;

  // The side to move burns time between polls, so tick it down locally.
  const elapsed = live && match.turnStartedAt ? Math.max(0, now - match.turnStartedAt) : 0;
  const liveClock = (seat: typeof match.you) => {
    if (!seat) return 0;
    const running = live && seat.colour === match.turn;
    return Math.max(0, seat.clockMs - (running ? elapsed : 0));
  };

  const youWon = over && match.winnerId === viewer?.id;
  const drawn = over && !match.winnerId && match.status === "finished";

  const pairs: [string | undefined, string | undefined][] = [];
  for (let i = 0; i < match.moves.length; i += 2) {
    pairs.push([match.moves[i]?.san, match.moves[i + 1]?.san]);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Stakes */}
      <div className="panel flex flex-wrap items-center justify-between gap-6 px-6 py-5">
        <div>
          <div className="text-xs uppercase tracking-widest text-dim">Pot</div>
          <div className="display text-4xl text-lime">{formatCents(match.potCents)}</div>
          <div className="mt-1 text-xs text-dim">
            {formatCents(match.stakeCents)} each · winner takes {formatCents(match.takeCents)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-dim">Status</div>
          <div className="mt-1.5">
            {match.status === "waiting" && <span className="chip bg-warn/15 text-warn">Waiting</span>}
            {live && (
              <span className={`chip ${match.yourTurn ? "bg-lime/15 text-lime" : "bg-panel-2 text-muted"}`}>
                {match.inCheck ? "Check!" : match.yourTurn ? "Your move" : "Their move"}
              </span>
            )}
            {match.status === "cancelled" && <span className="chip bg-panel-2 text-dim">Cancelled</span>}
            {match.status === "finished" && (
              <span
                className={`chip ${
                  drawn ? "bg-warn/15 text-warn" : youWon ? "bg-lime/15 text-lime" : "bg-bad/15 text-bad"
                }`}
              >
                {drawn ? "Draw" : youWon ? "You won" : isPlayer ? "You lost" : "Finished"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Result */}
      {over && (
        <div
          className={`rise panel mt-4 border-2 px-6 py-6 ${
            youWon ? "border-lime/50" : drawn ? "border-warn/40" : "border-bad/40"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <h2 className="display text-3xl">
                {match.status === "cancelled"
                  ? "Challenge cancelled"
                  : drawn
                    ? "Drawn"
                    : youWon
                      ? "You took the pot"
                      : isPlayer
                        ? "You lost this one"
                        : "Game over"}
              </h2>
              <p className="mt-2 text-sm text-muted">{match.reason}</p>
            </div>
            {isPlayer && match.status === "finished" && (
              <div className="text-right">
                <div className="text-xs uppercase tracking-widest text-dim">Your result</div>
                <div className={`display text-4xl ${drawn ? "text-muted" : youWon ? "text-lime" : "text-bad"}`}>
                  {drawn
                    ? formatCents(0)
                    : youWon
                      ? `+${formatCents(match.takeCents - match.stakeCents)}`
                      : `−${formatCents(match.stakeCents)}`}
                </div>
              </div>
            )}
          </div>
          <Link
            href="/games/chess"
            className="display mt-5 inline-block rounded-2xl bg-lime px-6 py-3 text-bg transition-transform hover:-translate-y-0.5"
          >
            Play again
          </Link>
        </div>
      )}

      {/* Waiting room */}
      {match.status === "waiting" && (
        <div className="panel mt-4 px-6 py-12 text-center">
          <div className="live-dot mx-auto h-2.5 w-2.5 rounded-full bg-warn" />
          <h2 className="display mt-5 text-3xl">
            {match.yourRole === "host" ? "Waiting for a challenger" : "This challenge is open"}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted">
            {match.yourRole === "host"
              ? `Your ${formatCents(match.stakeCents)} is in escrow. Colours are drawn at random the moment someone joins.`
              : `Stake ${formatCents(match.stakeCents)} to accept ${match.host.displayName}'s challenge. Colours are drawn at random.`}
          </p>
          {error && <p className="mt-4 text-sm text-bad">{error}</p>}
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            {match.yourRole === "host" ? (
              <>
                <CopyLink id={match.id} />
                <button
                  onClick={() => send("cancel")}
                  disabled={busy}
                  className="rounded-2xl border border-line px-6 py-3 text-sm font-semibold text-muted transition-colors hover:text-bad disabled:opacity-40"
                >
                  Cancel and refund
                </button>
              </>
            ) : viewer ? (
              <button
                onClick={() => send("join")}
                disabled={busy}
                className="display rounded-2xl bg-lime px-7 py-3.5 text-bg transition-transform hover:-translate-y-0.5 disabled:opacity-40"
              >
                {busy ? "Joining…" : `Stake ${formatCents(match.stakeCents)}`}
              </button>
            ) : (
              <Link
                href={`/join?next=/games/chess/${match.id}`}
                className="display rounded-2xl bg-lime px-7 py-3.5 text-bg"
              >
                Join to accept
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Board */}
      {match.status !== "waiting" && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <SeatBar seat={match.opponent ?? match.guest} clockMs={liveClock(match.opponent)} active={live && match.opponent?.colour === match.turn} />
            <div className="my-3">
              <ChessBoard
                fen={match.fen}
                legalMoves={match.legalMoves}
                yourColour={match.yourColour}
                lastMove={lastMove}
                interactive={live && match.yourTurn && !busy}
                flipped={match.yourColour === "b"}
                onMove={(from, to, promotion) => send("move", { from, to, promotion })}
              />
            </div>
            <SeatBar seat={match.you ?? match.host} clockMs={liveClock(match.you)} active={live && match.you?.colour === match.turn} you />
            {error && <p className="mt-4 text-center text-sm font-semibold text-bad">{error}</p>}
          </div>

          <aside className="space-y-4">
            <section className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-line-soft px-5 py-4">
                <h2 className="display text-xl">Moves</h2>
                <span className="tabular text-xs text-dim">{match.moves.length}</span>
              </div>
              {pairs.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-dim">No moves yet.</p>
              ) : (
                <ol className="max-h-96 overflow-y-auto px-2 py-2">
                  {pairs.map(([white, black], i) => (
                    <li key={i} className="tabular flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm">
                      <span className="w-6 text-xs text-dim">{i + 1}.</span>
                      <span className="flex-1 font-semibold">{white}</span>
                      <span className="flex-1 text-muted">{black ?? ""}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {live && isPlayer && (
              <button
                onClick={() => send("resign")}
                disabled={busy}
                className="w-full rounded-2xl border border-line px-5 py-3 text-sm font-semibold text-muted transition-colors hover:text-bad disabled:opacity-40"
              >
                Resign
              </button>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function SeatBar({
  seat,
  clockMs,
  active,
  you,
}: {
  seat: { displayName: string; username: string; colour: "w" | "b" | null } | null;
  clockMs: number;
  active?: boolean;
  you?: boolean;
}) {
  const low = clockMs < 30_000;
  return (
    <div className={`panel flex items-center gap-4 px-5 py-3.5 ${active ? "border-lime/50" : ""}`}>
      <span
        className="h-4 w-4 shrink-0 rounded-full border"
        style={{
          background: seat?.colour === "b" ? "#1c1638" : "#fbfaff",
          borderColor: "#6b5ea8",
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">
          {seat?.displayName ?? "Opponent"}
          {you && <span className="ml-2 text-xs font-normal text-dim">(you)</span>}
        </div>
        <div className="text-xs text-dim">
          {seat?.colour === "w" ? "White" : seat?.colour === "b" ? "Black" : "—"}
        </div>
      </div>
      <div
        className={`display tabular rounded-xl px-4 py-2 text-2xl ${
          active ? (low ? "bg-bad text-bg" : "bg-lime text-bg") : "bg-panel-2 text-ink"
        }`}
      >
        {countdown(clockMs)}
      </div>
    </div>
  );
}

function CopyLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/games/chess/${id}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="display rounded-2xl bg-accent px-7 py-3.5 text-bg transition-transform hover:-translate-y-0.5"
    >
      {copied ? "Link copied" : "Copy invite link"}
    </button>
  );
}
