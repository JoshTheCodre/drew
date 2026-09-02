"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RoundView } from "@/lib/games/price-prediction/engine";
import type { LobbyEntry } from "@/lib/games/wordle-duel/engine";
import type { Market } from "@/lib/markets";
import { countdown, formatCents, money, relativeTime } from "@/lib/format";

type MarketView = Market & { price: number | null };

export type ArcadeLiveState = {
  now: number;
  signedIn: boolean;
  markets: MarketView[];
  rounds: RoundView[];
  challenges: LobbyEntry[];
};

const POLL_MS = 5000;

/**
 * The landing page's live half: real open rounds and real open duels, both
 * actionable without leaving the page.
 */
export function ArcadeLive({ initial }: { initial: ArcadeLiveState }) {
  const [state, setState] = useState(initial);
  const [now, setNow] = useState(initial.now);
  const inFlight = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1000), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [pp, wd] = await Promise.all([
        fetch("/api/games/price-prediction/state", { cache: "no-store" }),
        fetch("/api/games/wordle-duel/state", { cache: "no-store" }),
      ]);
      if (!pp.ok || !wd.ok) return;
      const ppData = await pp.json();
      const wdData = await wd.json();
      setState({
        now: ppData.now,
        signedIn: Boolean(ppData.user),
        markets: ppData.markets,
        rounds: ppData.active,
        challenges: wdData.challenges,
      });
      setNow(ppData.now);
    } catch {
      /* next tick */
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="space-y-14">
      {/* Ticker */}
      <div className="panel grid grid-cols-1 divide-y divide-line-soft sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {state.markets.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-4 px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="h-9 w-1 rounded-full" style={{ background: m.accent }} />
              <div>
                <div className="text-sm font-semibold">
                  {m.symbol} <span className="text-xs font-normal text-dim">/ {m.quote}</span>
                </div>
                <div className="text-xs text-dim">{m.name}</div>
              </div>
            </div>
            <div className="tabular text-lg font-semibold">{money(m.price, m.decimals)}</div>
          </div>
        ))}
      </div>

      {/* Open prediction rounds */}
      <section>
        <div className="flex items-end justify-between">
          <h2 className="display flex items-center gap-3 text-3xl sm:text-4xl">
            <span className="live-dot h-2.5 w-2.5 rounded-full bg-lime" />
            Rounds open now
          </h2>
          <Link href="/games/price-prediction" className="text-sm text-muted transition-colors hover:text-lime">
            Open the game →
          </Link>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.rounds.length === 0 && (
            <div className="panel col-span-full px-6 py-12 text-center text-sm text-dim">
              Opening the next rounds…
            </div>
          )}
          {state.rounds.map((round) => {
            const open = round.status === "open" && round.locksAt > now;
            return (
              <Link key={round.id} href="/games/price-prediction" className="panel panel-lift overflow-hidden">
                <div className="flex items-center justify-between px-5 pt-5">
                  <span className="flex items-center gap-2.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: round.market?.accent ?? "#888" }}
                    />
                    <span className="display text-lg">{round.market?.symbol}</span>
                  </span>
                  <span className={`chip ${open ? "bg-lime/15 text-lime" : "bg-warn/15 text-warn"}`}>
                    {open ? "Open" : "Locked"}
                  </span>
                </div>

                <div className="px-5 pb-5 pt-4">
                  <div className="text-xs uppercase tracking-widest text-dim">
                    {open ? "Entries close in" : "Settles in"}
                  </div>
                  <div className="display tabular mt-1 text-4xl text-ink">
                    {countdown(open ? round.locksAt - now : round.resolvesAt - now)}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-line-soft pt-3.5 text-xs">
                    <span className="text-dim">
                      {round.entryCount} in · open{" "}
                      <span className="tabular">{money(round.openPrice, round.market?.decimals ?? 2)}</span>
                    </span>
                    <span className="font-semibold text-lime">
                      {round.yourPrediction ? "You're in" : open ? "Predict →" : "Watch →"}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Open duels */}
      <section>
        <div className="flex items-end justify-between">
          <h2 className="display flex items-center gap-3 text-3xl sm:text-4xl">
            <span className="live-dot h-2.5 w-2.5 rounded-full bg-accent" />
            Duels for the taking
          </h2>
          <Link href="/games/wordle-duel" className="text-sm text-muted transition-colors hover:text-lime">
            Open the lobby →
          </Link>
        </div>

        <div className="panel mt-7 overflow-hidden">
          {state.challenges.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm text-dim">Nobody is waiting right now.</p>
              <Link
                href="/games/wordle-duel"
                className="display mt-5 inline-block rounded-2xl bg-accent px-6 py-3 text-bg transition-transform hover:-translate-y-0.5"
              >
                Open the first one
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-line-soft">
              {state.challenges.slice(0, 5).map((entry) => (
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
                  <Link
                    href={
                      state.signedIn
                        ? `/games/wordle-duel/${entry.id}`
                        : `/join?next=/games/wordle-duel/${entry.id}`
                    }
                    className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-transform hover:-translate-y-0.5 ${
                      entry.isYours ? "border border-line text-muted" : "bg-lime text-bg"
                    }`}
                  >
                    {entry.isYours ? "Manage" : "Accept"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
