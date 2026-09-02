"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LeaderboardRow, RoundView } from "@/lib/games/price-prediction/engine";
import type { Market } from "@/lib/markets";
import type { User } from "@/lib/auth";
import { clockTime, countdown, money } from "@/lib/format";

type MarketView = Market & { price: number | null; history: { ts: number; price: number }[] };

export type GameState = {
  now: number;
  user: User | null;
  markets: MarketView[];
  active: RoundView[];
  recent: RoundView[];
  leaderboard: LeaderboardRow[];
};

const POLL_MS = 5000;

export function PricePredictionClient({ initial }: { initial: GameState }) {
  const [state, setState] = useState<GameState>(initial);
  const [now, setNow] = useState(initial.now);
  const [selected, setSelected] = useState<string>(initial.active[0]?.id ?? "");
  const inFlight = useRef(false);

  // Local clock so countdowns stay smooth between polls.
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1000), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/games/price-prediction/state", { cache: "no-store" });
      if (res.ok) {
        const data: GameState = await res.json();
        setState(data);
        setNow(data.now);
      }
    } catch {
      /* the next poll catches up */
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!state.active.some((r) => r.id === selected)) setSelected(state.active[0]?.id ?? "");
  }, [state.active, selected]);

  const round = useMemo(
    () => state.active.find((r) => r.id === selected) ?? state.active[0] ?? null,
    [state.active, selected],
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/70 px-3.5 py-1.5 text-xs text-muted">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-lime" />
            Live game · settles on real market data
          </div>
          <h1 className="display display-hero mt-5 text-5xl sm:text-6xl">
            Price <span className="text-lime">Prediction</span>
          </h1>
          <p className="mt-4 max-w-xl text-muted">
            Call the price at settlement. Closest number to the real market takes the round.
          </p>
        </div>
        {!state.user && (
          <Link
            href="/join?next=/games/price-prediction"
            className="display rounded-2xl bg-lime px-7 py-4 text-lg text-bg transition-transform hover:-translate-y-0.5"
          >
            Join to play
          </Link>
        )}
      </header>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <MarketStrip
            markets={state.markets}
            rounds={state.active}
            selected={round?.id}
            onSelect={setSelected}
          />
          {round ? (
            <RoundPanel round={round} now={now} user={state.user} onDone={refresh} />
          ) : (
            <div className="panel px-6 py-16 text-center text-sm text-dim">
              Opening the next round… hang tight.
            </div>
          )}
          <HowItWorks />
        </div>

        <aside className="space-y-6">
          <Standings rows={state.leaderboard} youId={state.user?.id} />
          <RecentRounds rounds={state.recent} />
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MarketStrip({
  markets,
  rounds,
  selected,
  onSelect,
}: {
  markets: MarketView[];
  rounds: RoundView[];
  selected?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {rounds.map((round) => {
        const market = markets.find((m) => m.id === round.market?.id);
        if (!market) return null;
        const active = round.id === selected;
        const drift =
          round.openPrice && market.price ? (market.price - round.openPrice) / round.openPrice : null;

        return (
          <button
            key={round.id}
            onClick={() => onSelect(round.id)}
            className={`panel px-5 py-4 text-left transition-all ${
              active ? "border-lime/60 shadow-lg shadow-lime/5" : "panel-lift"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: market.accent }} />
                <span className="display text-lg">{market.symbol}</span>
              </span>
              {round.yourPrediction && <span className="chip bg-lime/15 text-lime">In</span>}
            </div>
            <div className="tabular mt-3 text-xl font-semibold">{money(market.price, market.decimals)}</div>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span className={drift === null ? "text-dim" : drift >= 0 ? "text-good" : "text-bad"}>
                {drift === null ? "—" : `${drift >= 0 ? "+" : ""}${(drift * 100).toFixed(2)}%`}
              </span>
              <span className="text-dim">· {round.entryCount} in</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RoundPanel({
  round,
  now,
  user,
  onDone,
}: {
  round: RoundView;
  now: number;
  user: User | null;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const market = round.market;
  const open = round.status === "open" && round.locksAt > now;
  const msToLock = round.locksAt - now;
  const msToSettle = round.resolvesAt - now;

  useEffect(() => {
    setValue("");
    setError(null);
    setFlash(null);
  }, [round.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/games/price-prediction/predict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roundId: round.id, value: Number(value) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not submit that prediction.");
      } else {
        setFlash(round.yourPrediction ? "Prediction updated." : "You're in this round.");
        setValue("");
        onDone();
      }
    } catch {
      setError("Network hiccup — try that again.");
    } finally {
      setSaving(false);
    }
  }

  const total = round.resolvesAt - round.opensAt;
  const elapsed = Math.min(Math.max(now - round.opensAt, 0), total);
  const progress = total > 0 ? (elapsed / total) * 100 : 0;
  const lockMark = total > 0 ? ((round.locksAt - round.opensAt) / total) * 100 : 0;

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-5 border-b border-line-soft px-6 py-5">
        <div>
          <h2 className="display text-2xl">
            {market?.name} <span className="text-dim">{market?.symbol}/{market?.quote}</span>
          </h2>
          <p className="mt-1.5 text-sm text-dim">
            Settles at {clockTime(round.resolvesAt)} against the live market price.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-dim">
            {open ? "Entries close in" : "Settles in"}
          </div>
          <div className={`display tabular text-4xl ${open ? "text-ink" : "text-warn"}`}>
            {countdown(open ? msToLock : msToSettle)}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="px-6 pt-6">
        <div className="relative h-2 overflow-hidden rounded-full bg-panel-2">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-lime transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress}%` }}
          />
          <div className="absolute top-0 h-full w-0.5 bg-warn" style={{ left: `${lockMark}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-dim">
          <span>Opened {clockTime(round.opensAt)}</span>
          <span>Lock {clockTime(round.locksAt)}</span>
          <span>Settle {clockTime(round.resolvesAt)}</span>
        </div>
      </div>

      <div className="grid gap-6 px-6 py-6 md:grid-cols-2">
        <div className="space-y-5">
          <div>
            <div className="text-xs uppercase tracking-widest text-dim">Price when the round opened</div>
            <div className="display tabular mt-1 text-3xl">
              {money(round.openPrice, market?.decimals ?? 2)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-dim">Players in</div>
            <div className="display tabular mt-1 text-3xl">{round.entryCount}</div>
          </div>
          {round.yourPrediction && (
            <div className="rounded-2xl border border-lime/40 bg-lime/5 px-5 py-4">
              <div className="text-xs uppercase tracking-widest text-lime/80">Your call</div>
              <div className="display tabular mt-1 text-3xl text-lime">
                {money(round.yourPrediction.value, market?.decimals ?? 2)}
              </div>
              <div className="mt-1.5 text-xs text-dim">
                Locked in at {clockTime(round.yourPrediction.submittedAt)}
                {open ? " · still changeable" : ""}
              </div>
            </div>
          )}
        </div>

        <div>
          {!user ? (
            <div className="flex h-full flex-col justify-center rounded-2xl border border-dashed border-line px-5 py-10 text-center">
              <p className="text-sm text-muted">Join to put a number on the board.</p>
              <Link
                href="/join?next=/games/price-prediction"
                className="display mt-5 self-center rounded-2xl bg-lime px-6 py-3 text-bg"
              >
                Join in 10 seconds
              </Link>
            </div>
          ) : !open ? (
            <div className="flex h-full flex-col justify-center rounded-2xl border border-dashed border-line px-5 py-10 text-center text-sm text-muted">
              Entries are closed for this round. Results land when the clock hits zero — another market is
              already taking entries.
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <label className="block text-sm text-muted" htmlFor="prediction">
                Your prediction for {market?.symbol} at {clockTime(round.resolvesAt)}
              </label>
              <div className="flex items-center gap-2 rounded-2xl border border-line bg-bg-soft px-5 py-4 focus-within:border-lime/60">
                <span className="text-dim">$</span>
                <input
                  id="prediction"
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={round.openPrice ? round.openPrice.toFixed(market?.decimals ?? 2) : "0.00"}
                  className="tabular w-full bg-transparent text-xl outline-none placeholder:text-dim/50"
                />
              </div>
              <button
                type="submit"
                disabled={saving || !value}
                className="display w-full rounded-2xl bg-lime py-4 text-lg text-bg transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
              >
                {saving ? "Submitting…" : round.yourPrediction ? "Update call" : "Lock it in"}
              </button>
              {error && <p className="text-sm font-semibold text-bad">{error}</p>}
              {flash && <p className="text-sm font-semibold text-lime">{flash}</p>}
              <p className="text-xs text-dim">
                Everyone else&apos;s numbers stay sealed until the round settles.
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Standings({ rows, youId }: { rows: LeaderboardRow[]; youId?: string }) {
  return (
    <div className="panel overflow-hidden">
      <h3 className="display border-b border-line-soft px-5 py-4 text-xl">Standings</h3>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-dim">Nobody has settled a round yet.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {rows.map((row) => (
            <li
              key={row.userId}
              className={`flex items-center gap-3 px-5 py-3.5 ${row.userId === youId ? "bg-lime/5" : ""}`}
            >
              <span
                className={`display grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs ${
                  row.rank === 1 ? "bg-lime text-bg" : "bg-panel-2 text-muted"
                }`}
              >
                {row.rank}
              </span>
              <span className="flex-1 truncate text-sm font-semibold">{row.displayName}</span>
              <span className="tabular text-sm font-semibold text-lime">{row.points}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentRounds({ rounds }: { rounds: RoundView[] }) {
  return (
    <div className="panel overflow-hidden">
      <h3 className="display border-b border-line-soft px-5 py-4 text-xl">Settled rounds</h3>
      {rounds.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-dim">Results show up here once a round closes.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {rounds.map((round) => {
            const winner = round.entries.find((e) => e.placement === 1);
            return (
              <li key={round.id} className="px-5 py-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="display text-base">{round.market?.symbol}</span>
                  <span className="tabular font-semibold">
                    {money(round.finalPrice, round.market?.decimals ?? 2)}
                  </span>
                </div>
                <div className="mt-1.5 text-xs text-dim">
                  {round.status === "void" ? (
                    "Voided — price feed unavailable"
                  ) : winner ? (
                    <>
                      <span className="font-semibold text-lime">{winner.displayName}</span> called{" "}
                      <span className="tabular">{money(winner.value, round.market?.decimals ?? 2)}</span>, off
                      by <span className="tabular">{money(winner.absError, round.market?.decimals ?? 2)}</span>
                    </>
                  ) : (
                    "No entries"
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HowItWorks() {
  const steps: [string, string][] = [
    ["Pick a market", "Each market runs its own rolling round on Bitcoin, Ethereum or Solana."],
    ["Submit a number", "Predict the price at settlement. Change it as often as you like until the lock."],
    ["Wait for the lock", "Entries close, every number stays sealed, and the clock runs down."],
    ["Closest wins", "We pull the live price at settlement. Nearest prediction takes first place."],
  ];
  return (
    <section className="panel px-6 py-7">
      <h3 className="display text-2xl">How a round works</h3>
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
      <p className="mt-6 border-t border-line-soft pt-4 text-xs text-dim">
        Scoring: 10 points for playing, up to 60 for accuracy, plus 120 / 70 / 40 for the top three places.
      </p>
    </section>
  );
}
