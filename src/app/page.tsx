import Link from "next/link";
import { GAMES } from "@/lib/games/registry";
import { MARKETS, getPrices } from "@/lib/markets";
import { activeRounds, leaderboard } from "@/lib/games/price-prediction/engine";
import { openChallenges } from "@/lib/games/wordle-duel/engine";
import { currentUser } from "@/lib/auth";
import { arcadeStats, EMPTY_STATS } from "@/lib/stats";
import { nowMs } from "@/lib/clock";
import { formatCents } from "@/lib/format";
import { ArcadeLive } from "@/components/ArcadeLive";
import { Marquee } from "@/components/Marquee";
import { scheduleHousekeeping } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  scheduleHousekeeping();

  const user = await currentUser();
  const prices = await getPrices();

  /*
   * The home page is the front door: a slow or unreachable database should
   * degrade it, never blank it. Each section falls back to empty and the page
   * still renders, so visitors see the arcade instead of an error screen.
   */
  const [top, stats, rounds, challenges] = await Promise.all([
    leaderboard(null, 5).catch(() => []),
    arcadeStats().catch(() => EMPTY_STATS),
    activeRounds(user?.id).catch(() => []),
    openChallenges(user?.id).catch(() => []),
  ]);
  const liveGames = GAMES.filter((g) => g.status === "live");

  const tiles = [
    { value: String(liveGames.length), label: "Games live" },
    { value: String(stats.openRounds + stats.openDuels), label: "Open right now" },
    { value: formatCents(stats.paidOutCents), label: "Paid out" },
    { value: String(stats.players), label: "Players" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 pb-10 pt-8 sm:pt-12">
      {/* Hero */}
      <section className="rise">
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/70 px-3.5 py-1.5 text-xs text-muted">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-lime" />
          {liveGames.length} games live · rounds settle themselves
        </div>

        <h1 className="display display-hero mt-6 max-w-4xl text-[13vw] leading-[0.88] sm:text-7xl lg:text-8xl">
          Play for
          <br />
          <span className="text-lime">real stakes</span>
        </h1>

        <p className="mt-6 max-w-xl text-lg text-muted">
          Two live games, settled by data instead of opinion. Call the market, or race someone for
          the pot — no download, no password.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={liveGames[0]?.href ?? "/games/price-prediction"}
            className="display rounded-2xl bg-lime px-7 py-4 text-lg text-bg transition-transform hover:-translate-y-0.5"
          >
            Play now
          </Link>
          <Link
            href="/games/wordle-duel"
            className="display rounded-2xl border border-line bg-panel/60 px-7 py-4 text-lg text-ink transition-transform hover:-translate-y-0.5"
          >
            Duel for cash
          </Link>
          {!user && (
            <Link
              href="/join"
              className="rounded-2xl px-5 py-4 text-sm font-semibold text-muted transition-colors hover:text-lime"
            >
              Join in 10 seconds →
            </Link>
          )}
        </div>
      </section>

      {/* Stat tiles */}
      <section className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {tiles.map((tile, i) => (
          <div
            key={tile.label}
            className={`rounded-2xl px-5 py-6 ${
              i === 0 ? "bg-accent text-bg" : "border border-line-soft bg-panel/70"
            }`}
          >
            <div className={`display text-3xl sm:text-4xl ${i === 0 ? "" : "text-lime"}`}>
              {tile.value}
            </div>
            <div className={`mt-1.5 text-xs uppercase tracking-widest ${i === 0 ? "opacity-70" : "text-dim"}`}>
              {tile.label}
            </div>
          </div>
        ))}
      </section>

      <div className="mt-6">
        <Marquee items={["Play now", "Closest call wins", "First to solve takes the pot", "Settled by real data"]} />
      </div>

      {/* Everything happening right now */}
      <div className="mt-14">
        <ArcadeLive
          initial={{
            now: nowMs(),
            signedIn: Boolean(user),
            markets: MARKETS.map((m) => ({ ...m, price: prices.get(m.id) ?? null })),
            rounds,
            challenges,
          }}
        />
      </div>

      {/* Catalogue */}
      <section className="mt-20">
        <div className="flex items-end justify-between">
          <h2 className="display text-3xl sm:text-4xl">The lineup</h2>
          <span className="text-sm text-dim">{GAMES.length} games</span>
        </div>

        <div className="mt-7 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((game) => {
            const live = game.status === "live";
            const preview = game.status === "preview";
            const openable = live || preview;
            const card = (
              <article
                className={`panel relative h-full overflow-hidden ${openable ? "panel-lift" : "opacity-55"}`}
              >
                {/* Art block */}
                <div
                  className="relative flex h-32 items-center justify-center overflow-hidden"
                  style={{
                    background: `radial-gradient(120% 120% at 50% 120%, ${game.accent}55, transparent 70%), linear-gradient(160deg, ${game.accent}22, transparent)`,
                  }}
                >
                  <span className="text-6xl drop-shadow-lg">{game.emoji}</span>
                  <div className="absolute right-3 top-3 flex gap-1.5">
                    {game.stakes === "money" && live && <span className="chip bg-lime text-bg">Cash</span>}
                    <span
                      className={`chip bg-bg/70 ${
                        live ? "text-lime" : preview ? "text-warn" : "text-dim"
                      }`}
                    >
                      {live ? "Live" : preview ? "Preview" : "Soon"}
                    </span>
                  </div>
                </div>

                <div className="p-6">
                  <h3 className="display text-2xl">{game.name}</h3>
                  <p className="mt-1.5 text-sm font-medium" style={{ color: game.accent }}>
                    {game.tagline}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{game.description}</p>
                  <dl className="mt-5 flex gap-6 border-t border-line-soft pt-4 text-xs">
                    <div>
                      <dt className="text-dim">Players</dt>
                      <dd className="mt-0.5 text-muted">{game.players}</dd>
                    </div>
                    <div>
                      <dt className="text-dim">Round</dt>
                      <dd className="mt-0.5 text-muted">{game.length}</dd>
                    </div>
                    <div>
                      <dt className="text-dim">Plays for</dt>
                      <dd className="mt-0.5 text-muted">{game.stakes === "money" ? "Money" : "Points"}</dd>
                    </div>
                  </dl>
                </div>
              </article>
            );

            return openable ? (
              <Link key={game.id} href={game.href} className="block">
                {card}
              </Link>
            ) : (
              <div key={game.id}>{card}</div>
            );
          })}
        </div>
      </section>

      {/* Standings */}
      <section className="mt-20">
        <div className="flex items-end justify-between">
          <h2 className="display text-3xl sm:text-4xl">Top players</h2>
          <Link href="/leaderboard" className="text-sm text-muted transition-colors hover:text-lime">
            Full board →
          </Link>
        </div>
        <div className="panel mt-7 overflow-hidden">
          {top.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-dim">
              No scores yet. The first settled round writes the first name here.
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {top.map((row) => (
                <li key={row.userId} className="flex items-center gap-4 px-6 py-4">
                  <span
                    className={`display grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm ${
                      row.rank === 1 ? "bg-lime text-bg" : "bg-panel-2 text-muted"
                    }`}
                  >
                    {row.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{row.displayName}</div>
                    <div className="text-xs text-dim">@{row.username}</div>
                  </div>
                  <div className="text-right">
                    <div className="tabular text-sm font-semibold text-lime">{row.points} pts</div>
                    <div className="text-xs text-dim">
                      {row.wins} win{row.wins === 1 ? "" : "s"} · {row.plays} played
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
