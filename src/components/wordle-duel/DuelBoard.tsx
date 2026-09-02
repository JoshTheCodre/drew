"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MatchView } from "@/lib/games/wordle-duel/engine";
import type { User } from "@/lib/auth";
import { countdown, formatCents } from "@/lib/format";
import { Board, FLIP_TOTAL_MS, Keyboard } from "./Tiles";

const POLL_MS = 1500;
const MAX_GUESSES = 6;

/**
 * Drives the reveal choreography for one board: when a new row arrives, flip it
 * open, then bounce it if it solved. The ref starts at the row count we were
 * handed, so rows that already existed on load don't replay their animation.
 */
function useRowReveal(rows: { pattern: string }[]) {
  const [revealRow, setRevealRow] = useState<number | null>(null);
  const [bounceRow, setBounceRow] = useState<number | null>(null);
  const seen = useRef(rows.length);

  useEffect(() => {
    if (rows.length <= seen.current) return;
    const index = rows.length - 1;
    seen.current = rows.length;
    setRevealRow(index);

    const done = setTimeout(() => {
      setRevealRow(null);
      if (rows[index]?.pattern === "ggggg") setBounceRow(index);
    }, FLIP_TOTAL_MS);
    return () => clearTimeout(done);
  }, [rows]);

  return { revealRow, bounceRow };
}

export function DuelBoard({
  initial,
  viewer,
  startedNow,
}: {
  initial: MatchView;
  viewer: User | null;
  startedNow: number;
}) {
  const [match, setMatch] = useState(initial);
  const [now, setNow] = useState(startedNow);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [jiggleRow, setJiggleRow] = useState<number | null>(null);
  const inFlight = useRef(false);

  const isPlayer = match.yourRole !== "spectator";
  const live = match.status === "active";
  const over = match.status === "finished" || match.status === "cancelled";

  const myRows = useMemo(() => match.you?.guesses ?? [], [match.you]);
  const oppRows = useMemo(() => match.opponent?.guesses ?? [], [match.opponent]);
  const mine = useRowReveal(myRows);
  const theirs = useRowReveal(oppRows);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/games/wordle-duel/matches/${initial.id}`, { cache: "no-store" });
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
        const res = await fetch(`/api/games/wordle-duel/matches/${initial.id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "That didn't work.");
          // 422 is "not in the word list" — jiggle the row and keep the letters.
          if (res.status === 422) {
            setJiggleRow(myRows.length);
            setTimeout(() => setJiggleRow(null), 520);
          } else {
            refresh();
          }
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
    [initial.id, refresh, myRows.length],
  );

  const canGuess = live && isPlayer && !match.you?.solved && myRows.length < MAX_GUESSES;

  const submit = useCallback(async () => {
    if (draft.length !== 5 || busy) return;
    if (await send("guess", { guess: draft })) setDraft("");
  }, [draft, busy, send]);

  const onKey = useCallback(
    (key: string) => {
      if (!canGuess || busy) return;
      setError(null);
      if (key === "enter") void submit();
      else if (key === "backspace") setDraft((d) => d.slice(0, -1));
      else if (/^[a-z]$/.test(key)) setDraft((d) => (d.length < 5 ? d + key : d));
    },
    [canGuess, busy, submit],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "enter" || key === "backspace" || /^[a-z]$/.test(key)) {
        e.preventDefault();
        onKey(key);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onKey]);

  const letterStates = useMemo(() => {
    const map: Record<string, string> = {};
    const rank: Record<string, number> = { b: 0, y: 1, g: 2 };
    for (const row of myRows) {
      if (!row.guess) continue;
      for (let i = 0; i < 5; i++) {
        const letter = row.guess[i];
        const state = row.pattern[i];
        if (!map[letter] || rank[state] > rank[map[letter]]) map[letter] = state;
      }
    }
    return map;
  }, [myRows]);

  const msLeft = match.deadlineAt ? match.deadlineAt - now : 0;
  const urgent = live && msLeft < 30_000;
  const youWon = over && match.winnerId === viewer?.id;
  const drawn = over && !match.winnerId;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Stakes bar */}
      <div className="panel flex flex-wrap items-center justify-between gap-6 px-6 py-5">
        <div>
          <div className="text-xs uppercase tracking-widest text-dim">Pot</div>
          <div className="display text-4xl text-lime">{formatCents(match.potCents)}</div>
          <div className="mt-1 text-xs text-dim">
            {formatCents(match.stakeCents)} each · winner takes {formatCents(match.takeCents)}
          </div>
        </div>

        {live && (
          <div className="text-center">
            <div className="text-xs uppercase tracking-widest text-dim">Time left</div>
            <div className={`display tabular text-5xl ${urgent ? "text-bad" : "text-ink"}`}>
              {countdown(msLeft)}
            </div>
          </div>
        )}

        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-dim">Status</div>
          <div className="mt-1.5">
            {match.status === "waiting" && <span className="chip bg-warn/15 text-warn">Waiting</span>}
            {match.status === "active" && <span className="chip bg-lime/15 text-lime">Racing</span>}
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
                    ? "Nobody solved it"
                    : youWon
                      ? "You took the pot"
                      : isPlayer
                        ? "Beaten to it"
                        : `${match.winnerId === match.host.userId ? match.host.displayName : match.guest?.displayName} won`}
              </h2>
              <p className="mt-2 text-sm text-muted">
                {match.word && (
                  <>
                    The word was <span className="display text-lg text-lime">{match.word}</span>.{" "}
                  </>
                )}
                {match.outcome === "expired" && "Time ran out — both stakes were returned. "}
                {match.outcome === "both_failed" && "Both players ran out of guesses — stakes returned. "}
                {match.outcome === "forfeit" && "The match was forfeited. "}
              </p>
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
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/games/wordle-duel"
              className="display rounded-2xl bg-lime px-6 py-3 text-bg transition-transform hover:-translate-y-0.5"
            >
              Play again
            </Link>
            <Link
              href="/wallet"
              className="rounded-2xl border border-line px-6 py-3 text-sm font-semibold text-muted transition-colors hover:text-ink"
            >
              View wallet
            </Link>
          </div>
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
              ? `Your ${formatCents(match.stakeCents)} is held in escrow. Share the link, or wait in the lobby — the board unlocks the moment someone joins.`
              : `Stake ${formatCents(match.stakeCents)} to accept ${match.host.displayName}'s challenge. Both boards unlock at the same second.`}
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
                href={`/join?next=/games/wordle-duel/${match.id}`}
                className="display rounded-2xl bg-lime px-7 py-3.5 text-bg"
              >
                Join to accept
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Boards */}
      {match.status !== "waiting" && (
        <div className="mt-6 grid gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
          <PlayerPanel
            title={isPlayer ? "You" : (match.you?.displayName ?? "Host")}
            subtitle={isPlayer ? (match.you?.displayName ?? "") : live ? "letters hidden" : "final board"}
            rows={myRows}
            current={isPlayer ? draft : ""}
            masked={!isPlayer && live}
            solved={match.you?.solved ?? false}
            solvedInTurns={match.you?.solvedInTurns ?? null}
            highlight={isPlayer}
            revealRow={mine.revealRow}
            bounceRow={mine.bounceRow}
            jiggleRow={jiggleRow}
          />
          <PlayerPanel
            title={match.opponent?.displayName ?? "Opponent"}
            subtitle={live ? "letters hidden until the end" : "final board"}
            rows={oppRows}
            masked={live}
            solved={match.opponent?.solved ?? false}
            solvedInTurns={match.opponent?.solvedInTurns ?? null}
            size={isPlayer ? "sm" : "md"}
            revealRow={theirs.revealRow}
            bounceRow={theirs.bounceRow}
          />
        </div>
      )}

      {/* Input */}
      {live && isPlayer && (
        <div className="mt-8">
          {error && <p className="mb-4 text-center text-sm font-semibold text-bad">{error}</p>}
          {canGuess ? (
            <>
              <Keyboard letterStates={letterStates} onKey={onKey} disabled={busy} />
              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => send("forfeit")}
                  disabled={busy}
                  className="text-xs text-dim transition-colors hover:text-bad disabled:opacity-40"
                >
                  Forfeit this match
                </button>
              </div>
            </>
          ) : (
            <p className="text-center text-sm text-muted">
              {match.you?.solved
                ? "You solved it — settling now."
                : "You're out of guesses. Your opponent can still win it."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PlayerPanel({
  title,
  subtitle,
  rows,
  current = "",
  masked,
  solved,
  solvedInTurns,
  size = "md",
  highlight,
  revealRow,
  bounceRow,
  jiggleRow,
}: {
  title: string;
  subtitle: string;
  rows: { guess: string | null; pattern: string }[];
  current?: string;
  masked: boolean;
  solved: boolean;
  solvedInTurns: number | null;
  size?: "sm" | "md";
  highlight?: boolean;
  revealRow?: number | null;
  bounceRow?: number | null;
  jiggleRow?: number | null;
}) {
  return (
    <section className={`panel px-5 py-5 ${highlight ? "border-accent/40" : ""}`}>
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h3 className="display truncate text-xl">{title}</h3>
          <p className="text-xs text-dim">{subtitle}</p>
        </div>
        <div className="shrink-0 text-right text-xs">
          {solved ? (
            <span className="chip bg-lime/15 text-lime">solved in {solvedInTurns}</span>
          ) : (
            <span className="tabular text-dim">{rows.length}/6</span>
          )}
        </div>
      </div>
      <div className="flex justify-center">
        <Board
          rows={rows}
          current={current}
          maxGuesses={6}
          masked={masked}
          size={size}
          revealRow={revealRow}
          bounceRow={bounceRow}
          jiggleRow={jiggleRow}
        />
      </div>
    </section>
  );
}

function CopyLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/games/wordle-duel/${id}`);
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
