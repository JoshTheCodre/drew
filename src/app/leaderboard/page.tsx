import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { GAMES } from "@/lib/games/registry";
import { leaderboard } from "@/lib/games/price-prediction/engine";
import { duelStandings } from "@/lib/games/wordle-duel/engine";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = { title: "Leaderboard" };
export const dynamic = "force-dynamic";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  const { game } = await searchParams;
  const scope = !game || game === "all" ? null : game;
  const user = await currentUser();

  const tabs = [
    { id: "all", name: "All games" },
    ...GAMES.filter((g) => g.status === "live").map((g) => ({ id: g.id, name: g.name })),
  ];

  // Wordle Duel ranks by money won; everything else ranks by points.
  const isDuel = scope === "wordle-duel";
  const pointRows = isDuel ? [] : leaderboard(scope, 50);
  const duelRows = isDuel ? duelStandings(50) : [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="display display-hero text-5xl sm:text-6xl">
        Leader<span className="text-lime">board</span>
      </h1>
      <p className="mt-4 text-muted">
        Points carry across the arcade. Wordle Duel ranks by money won instead.
      </p>

      <div className="mt-8 flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = (scope ?? "all") === t.id;
          return (
            <Link
              key={t.id}
              href={t.id === "all" ? "/leaderboard" : `/leaderboard?game=${t.id}`}
              className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors ${
                active ? "bg-accent text-bg" : "border border-line-soft text-muted hover:text-ink"
              }`}
            >
              {t.name}
            </Link>
          );
        })}
      </div>

      <div className="panel mt-7 overflow-hidden">
        {isDuel ? (
          duelRows.length === 0 ? (
            <Empty href="/games/wordle-duel" label="Play a duel" />
          ) : (
            <table className="w-full text-sm">
              <Head columns={["Player", "Wins", "Played", "Net"]} />
              <tbody className="divide-y divide-line-soft">
                {duelRows.map((row) => (
                  <tr key={row.userId} className={row.userId === user?.id ? "bg-lime/5" : ""}>
                    <Rank rank={row.rank} />
                    <td className="px-2 py-4">
                      <div className="font-semibold">{row.displayName}</div>
                      <div className="text-xs text-dim">@{row.username}</div>
                    </td>
                    <td className="tabular px-4 py-4 text-right text-muted">{row.wins}</td>
                    <td className="tabular px-4 py-4 text-right text-muted">{row.played}</td>
                    <td
                      className={`tabular px-6 py-4 text-right font-semibold ${
                        row.netCents >= 0 ? "text-lime" : "text-bad"
                      }`}
                    >
                      {row.netCents >= 0 ? "+" : "−"}
                      {formatCents(Math.abs(row.netCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : pointRows.length === 0 ? (
          <Empty href="/games/price-prediction" label="Play a round" />
        ) : (
          <table className="w-full text-sm">
            <Head columns={["Player", "Wins", "Played", "Points"]} />
            <tbody className="divide-y divide-line-soft">
              {pointRows.map((row) => (
                <tr key={row.userId} className={row.userId === user?.id ? "bg-lime/5" : ""}>
                  <Rank rank={row.rank} />
                  <td className="px-2 py-4">
                    <div className="font-semibold">{row.displayName}</div>
                    <div className="text-xs text-dim">@{row.username}</div>
                  </td>
                  <td className="tabular px-4 py-4 text-right text-muted">{row.wins}</td>
                  <td className="tabular px-4 py-4 text-right text-muted">{row.plays}</td>
                  <td className="tabular px-6 py-4 text-right font-semibold text-lime">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Head({ columns }: { columns: string[] }) {
  return (
    <thead className="border-b border-line-soft text-left text-xs uppercase tracking-widest text-dim">
      <tr>
        <th className="px-6 py-4 font-medium">#</th>
        {columns.map((c, i) => (
          <th
            key={c}
            className={`py-4 font-medium ${i === 0 ? "px-2" : "px-4 text-right"} ${
              i === columns.length - 1 ? "pr-6" : ""
            }`}
          >
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function Rank({ rank }: { rank: number }) {
  return (
    <td className="px-6 py-4">
      <span
        className={`display grid h-8 w-8 place-items-center rounded-lg text-xs ${
          rank === 1 ? "bg-lime text-bg" : rank <= 3 ? "bg-panel-2 text-lime" : "bg-panel-2 text-muted"
        }`}
      >
        {rank}
      </span>
    </td>
  );
}

function Empty({ href, label }: { href: string; label: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-sm text-dim">Nothing here yet.</p>
      <Link
        href={href}
        className="display mt-5 inline-block rounded-2xl bg-lime px-6 py-3 text-bg transition-transform hover:-translate-y-0.5"
      >
        {label}
      </Link>
    </div>
  );
}
