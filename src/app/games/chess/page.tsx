import type { Metadata } from "next";
import Link from "next/link";
import { ChessBoard } from "@/components/chess/ChessBoard";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = { title: "Chess" };

/**
 * Design preview. Every number on this page is a placeholder — there is no
 * chess engine, no clock and no wallet call behind it yet.
 */

const MOVES = [
  ["e4", "e5"],
  ["Nf3", "Nc6"],
  ["Bb5", "a6"],
  ["Ba4", "Nf6"],
  ["O-O", "Be7"],
  ["Re1", "b5"],
];

export default function ChessPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="rounded-2xl border border-warn/30 bg-warn/5 px-5 py-3.5 text-sm text-warn">
        <strong className="font-semibold">Design preview.</strong> The board is interactive enough to
        click around, but there are no rules, no clock and no stakes wired up yet.
      </div>

      <header className="mt-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/70 px-3.5 py-1.5 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-warn" />
            Coming soon
          </div>
          <h1 className="display display-hero mt-5 text-5xl sm:text-6xl">
            Chess <span className="text-lime">Stakes</span>
          </h1>
          <p className="mt-4 max-w-xl text-muted">
            Blitz chess for the pot. Same escrow, same rake, same instant settlement as Wordle Duel —
            just a longer game.
          </p>
        </div>
        <div className="panel px-6 py-4 text-right opacity-60">
          <div className="text-xs uppercase tracking-widest text-dim">Pot</div>
          <div className="display text-3xl text-lime">{formatCents(100_000)}</div>
          <div className="mt-0.5 text-xs text-dim">{formatCents(50_000)} each</div>
        </div>
      </header>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <PlayerBar name="Nadia K." rating={1842} clock="4:58" captured="♟♟♝" />
          <div className="my-3">
            <ChessBoard />
          </div>
          <PlayerBar name="You" rating={1790} clock="5:00" captured="♙♙" you />
        </div>

        <aside className="space-y-6">
          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-line-soft px-5 py-4">
              <h2 className="display text-xl">Moves</h2>
              <span className="chip bg-panel-2 text-dim">Sample</span>
            </div>
            <ol className="max-h-80 overflow-y-auto px-2 py-2">
              {MOVES.map(([white, black], i) => (
                <li
                  key={i}
                  className="tabular flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-panel-2/60"
                >
                  <span className="w-6 text-xs text-dim">{i + 1}.</span>
                  <span className="flex-1 font-semibold">{white}</span>
                  <span className="flex-1 text-muted">{black}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel px-5 py-5">
            <h2 className="display text-xl">Planned rules</h2>
            <ul className="mt-4 space-y-3 text-sm text-muted">
              {[
                "5+3 blitz, both stakes escrowed at the start",
                "Win, and you take the pot minus the house fee",
                "Draw returns both stakes in full",
                "Flagging on time counts as a win",
                "Resign any time — the pot goes to your opponent",
              ].map((rule) => (
                <li key={rule} className="flex gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
                  {rule}
                </li>
              ))}
            </ul>
          </section>

          <div className="panel px-5 py-6 text-center">
            <p className="text-sm text-muted">Want to play something for real money today?</p>
            <Link
              href="/games/wordle-duel"
              className="display mt-4 inline-block rounded-2xl bg-lime px-6 py-3 text-bg transition-transform hover:-translate-y-0.5"
            >
              Open a duel
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PlayerBar({
  name,
  rating,
  clock,
  captured,
  you,
}: {
  name: string;
  rating: number;
  clock: string;
  captured: string;
  you?: boolean;
}) {
  return (
    <div className={`panel flex items-center gap-4 px-5 py-3.5 ${you ? "border-accent/40" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">
          {name} <span className="text-xs font-normal text-dim">{rating}</span>
        </div>
        <div className="text-base leading-tight text-dim">{captured}</div>
      </div>
      <div
        className={`display tabular rounded-xl px-4 py-2 text-2xl ${
          you ? "bg-lime text-bg" : "bg-panel-2 text-ink"
        }`}
      >
        {clock}
      </div>
    </div>
  );
}
