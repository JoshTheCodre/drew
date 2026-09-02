"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DuelStanding, LobbyEntry, MatchView } from "@/lib/games/wordle-duel/engine";
import type { Wallet } from "@/lib/wallet";
import type { User } from "@/lib/auth";
import { countdown, formatCents, relativeTime } from "@/lib/format";

export type LobbyState = {
  now: number;
  user: User | null;
  wallet: Wallet | null;
  challenges: LobbyEntry[];
  mine: MatchView[];
  standings: DuelStanding[];
  config: {
    stakePresets: { cents: number; pot: number; rake: number; take: number }[];
    rakeBps: number;
    matchSeconds: number;
    maxGuesses: number;
  };
};

const POLL_MS = 3000;

export function DuelLobby({ initial }: { initial: LobbyState }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [stake, setStake] = useState(
    initial.config.stakePresets.find((p) => p.cents === 50_000)?.cents ?? initial.config.stakePresets[0].cents,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(initial.now);
  const inFlight = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/games/wordle-duel/state", { cache: "no-store" });
      if (res.ok) setState(await res.json());
    } catch {
      /* transient */
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Someone accepting your challenge should drop you straight onto the board.
  useEffect(() => {
    const justStarted = state.mine.find(
      (m) => m.status === "active" && m.startedAt && Date.now() - m.startedAt < 6000,
    );
    if (justStarted) router.push(`/games/wordle-duel/${justStarted.id}`);
  }, [state.mine, router]);

  async function createChallenge() {
    if (!state.user) {
      router.push("/join?next=/games/wordle-duel");
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const res = await fetch("/api/games/wordle-duel/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stakeCents: stake }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not open that challenge.");
        return;
      }
      router.push(`/games/wordle-duel/${data.match.id}`);
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function accept(entry: LobbyEntry) {
    if (!state.user) {
      router.push(`/join?next=/games/wordle-duel/${entry.id}`);
      return;
    }
    setBusy(entry.id);
    setError(null);
    try {
      const res = await fetch(`/api/games/wordle-duel/matches/${entry.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "join" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not join that match.");
        refresh();
        return;
      }
      router.push(`/games/wordle-duel/${entry.id}`);
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(null);
    }
  }

  const selected = state.config.stakePresets.find((p) => p.cents === stake) ?? state.config.stakePresets[0];
  const canAfford = !state.wallet || state.wallet.availableCents >= stake;
  const live = state.mine.filter((m) => m.status === "active" || m.status === "waiting");

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/70 px-3.5 py-1.5 text-xs text-muted">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-lime" />
            Head to head · winner takes the pot
          </div>
          <h1 className="display display-hero mt-5 text-5xl sm:text-6xl">
            Wordle <span className="text-lime">Duel</span>
          </h1>
          <p className="mt-4 max-w-xl text-muted">
            Same word, same second, six guesses each. First to solve it takes the pot.
          </p>
        </div>
        {state.wallet && (
          <Link href="/wallet" className="panel panel-lift px-6 py-4 text-right">
            <div className="text-xs uppercase tracking-widest text-dim">Available</div>
            <div className="display text-3xl text-lime">{formatCents(state.wallet.availableCents)}</div>
            {state.wallet.escrowCents > 0 && (
              <div className="mt-0.5 text-xs text-warn">
                {formatCents(state.wallet.escrowCents)} in escrow
              </div>
            )}
          </Link>
        )}
      </header>

      {live.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-dim">Your live matches</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((m) => (
              <Link
                key={m.id}
                href={`/games/wordle-duel/${m.id}`}
                className="panel panel-lift border-accent/40 px-5 py-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {m.status === "waiting" ? "Waiting for an opponent" : `vs ${m.opponent?.displayName}`}
                  </span>
                  <span className="tabular text-sm font-semibold text-lime">{formatCents(m.potCents)}</span>
                </div>
                <div className="tabular mt-1 text-xs text-dim">
                  {m.status === "active" && m.deadlineAt
                    ? `${countdown(m.deadlineAt - now)} left`
                    : `opened ${relativeTime(m.createdAt, now)}`}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {/* Create */}
          <section className="panel px-6 py-7">
            <h2 className="display text-2xl">Open a challenge</h2>
            <p className="mt-2 text-sm text-muted">
              Pick your stake. It sits in escrow until someone accepts — cancel before that and it comes
              straight back.
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {state.config.stakePresets.map((preset) => (
                <button
                  key={preset.cents}
                  onClick={() => setStake(preset.cents)}
                  className={`tabular rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                    preset.cents === stake
                      ? "border-lime bg-lime text-bg"
                      : "border-line-soft text-muted hover:border-line hover:text-ink"
                  }`}
                >
                  {formatCents(preset.cents)}
                </button>
              ))}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <Figure label="You stake" value={formatCents(selected.cents)} />
              <Figure label="Pot" value={formatCents(selected.pot)} />
              <Figure label="Winner takes" value={formatCents(selected.take)} accent />
            </div>

            <p className="mt-3 text-xs text-dim">
              House fee {(state.config.rakeBps / 100).toFixed(1)}% ({formatCents(selected.rake)}). A draw or
              timeout returns both stakes in full.
            </p>

            {error && <p className="mt-4 text-sm font-semibold text-bad">{error}</p>}

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={createChallenge}
                disabled={busy === "create" || !canAfford}
                className="display rounded-2xl bg-lime px-8 py-4 text-lg text-bg transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
              >
                {busy === "create"
                  ? "Opening…"
                  : !state.user
                    ? "Join to play"
                    : !canAfford
                      ? "Not enough balance"
                      : `Stake ${formatCents(selected.cents)}`}
              </button>
              {!canAfford && state.wallet && (
                <Link href="/wallet" className="text-sm font-semibold text-lime">
                  Top up your wallet →
                </Link>
              )}
            </div>
          </section>

          {/* Open challenges */}
          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-line-soft px-6 py-5">
              <h2 className="display text-2xl">Open challenges</h2>
              <span className="chip bg-panel-2 text-dim">{state.challenges.length} waiting</span>
            </div>
            {state.challenges.length === 0 ? (
              <p className="px-6 py-14 text-center text-sm text-dim">
                Nobody is waiting right now. Open one above and it shows up here for everyone.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {state.challenges.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {entry.hostName}
                        {entry.isYours && <span className="ml-2 text-xs font-normal text-dim">(you)</span>}
                      </div>
                      <div className="text-xs text-dim">opened {relativeTime(entry.createdAt, now)}</div>
                    </div>
                    <div className="text-right">
                      <div className="tabular text-sm font-semibold">{formatCents(entry.stakeCents)}</div>
                      <div className="text-xs text-lime">win {formatCents(entry.takeCents)}</div>
                    </div>
                    {entry.isYours ? (
                      <Link
                        href={`/games/wordle-duel/${entry.id}`}
                        className="rounded-xl border border-line px-5 py-2.5 text-sm font-semibold text-muted transition-colors hover:text-ink"
                      >
                        Manage
                      </Link>
                    ) : (
                      <button
                        onClick={() => accept(entry)}
                        disabled={busy === entry.id}
                        className="rounded-xl bg-lime px-5 py-2.5 text-sm font-semibold text-bg transition-transform hover:-translate-y-0.5 disabled:opacity-40"
                      >
                        {busy === entry.id ? "…" : "Accept"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <HowItWorks seconds={state.config.matchSeconds} maxGuesses={state.config.maxGuesses} />
        </div>

        <aside className="space-y-6">
          <section className="panel overflow-hidden">
            <h3 className="display border-b border-line-soft px-5 py-4 text-xl">Biggest winners</h3>
            {state.standings.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-dim">No duels settled yet.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {state.standings.map((row) => (
                  <li key={row.userId} className="flex items-center gap-3 px-5 py-3.5">
                    <span
                      className={`display grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs ${
                        row.rank === 1 ? "bg-lime text-bg" : "bg-panel-2 text-muted"
                      }`}
                    >
                      {row.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{row.displayName}</div>
                      <div className="text-xs text-dim">
                        {row.wins}W · {row.played} played
                      </div>
                    </div>
                    <span
                      className={`tabular text-sm font-semibold ${row.netCents >= 0 ? "text-lime" : "text-bad"}`}
                    >
                      {row.netCents >= 0 ? "+" : "−"}
                      {formatCents(Math.abs(row.netCents))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {state.mine.filter((m) => m.status === "finished").length > 0 && (
            <section className="panel overflow-hidden">
              <h3 className="display border-b border-line-soft px-5 py-4 text-xl">Your recent duels</h3>
              <ul className="divide-y divide-line-soft">
                {state.mine
                  .filter((m) => m.status === "finished")
                  .slice(0, 6)
                  .map((m) => {
                    const won = m.winnerId === state.user?.id;
                    const drawn = !m.winnerId;
                    return (
                      <li key={m.id}>
                        <Link
                          href={`/games/wordle-duel/${m.id}`}
                          className="flex items-center gap-3 px-5 py-3.5"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm">
                            vs {m.opponent?.displayName ?? "—"}
                          </span>
                          <span className="display text-xs text-dim">{m.word}</span>
                          <span
                            className={`tabular text-sm font-semibold ${
                              drawn ? "text-muted" : won ? "text-lime" : "text-bad"
                            }`}
                          >
                            {drawn
                              ? "±0"
                              : won
                                ? `+${formatCents(m.takeCents - m.stakeCents)}`
                                : `−${formatCents(m.stakeCents)}`}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-2xl px-5 py-4 ${
        accent ? "bg-accent text-bg" : "border border-line-soft bg-bg-soft/60"
      }`}
    >
      <div className={`text-xs uppercase tracking-widest ${accent ? "opacity-70" : "text-dim"}`}>
        {label}
      </div>
      <div className="display mt-1 text-2xl">{value}</div>
    </div>
  );
}

function HowItWorks({ seconds, maxGuesses }: { seconds: number; maxGuesses: number }) {
  const steps: [string, string][] = [
    ["Both stakes go into escrow", "Neither player can touch the money once a match starts."],
    ["Same word, same start", "The board unlocks for both players the second the challenge is accepted."],
    [`${maxGuesses} guesses each`, "You see your opponent's colours in real time, but never their letters."],
    [
      "First to solve takes the pot",
      `If the ${Math.round(seconds / 60)}-minute clock runs out, both stakes are returned.`,
    ],
  ];
  return (
    <section className="panel px-6 py-7">
      <h3 className="display text-2xl">How a duel works</h3>
      <ol className="mt-5 grid gap-5 sm:grid-cols-2">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3.5">
            <span className="display grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-panel-2 text-sm text-lime">
              {i + 1}
            </span>
            <div>
              <div className="text-sm font-semibold">{title}</div>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
