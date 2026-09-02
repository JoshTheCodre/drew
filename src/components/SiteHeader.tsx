"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { User } from "@/lib/auth";
import { formatCents } from "@/lib/format";

const NAV = [
  { href: "/games/price-prediction", label: "Predict" },
  { href: "/games/wordle-duel", label: "Wordle" },
  { href: "/games/chess", label: "Chess" },
  { href: "/wallet", label: "Wallet" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function SiteHeader({ user }: { user: User | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  // Keep the balance honest as matches settle underneath the player.
  useEffect(() => {
    if (!user) {
      setBalance(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/wallet", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setBalance(data.wallet.availableCents);
      } catch {
        /* transient */
      }
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [user, pathname]);

  function switchPlayer() {
    start(async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      router.refresh();
      router.push("/join");
    });
  }

  return (
    <header className="sticky top-0 z-50 border-b border-line-soft bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-5 px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-lime">
            <span className="h-3.5 w-3.5 rotate-45 rounded-[4px] bg-bg" />
          </span>
          <span className="display hidden text-lg sm:inline">Drew Arcade</span>
        </Link>

        <nav className="hidden items-center gap-1 rounded-full border border-line-soft bg-panel/60 p-1 md:flex">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-accent text-bg" : "text-muted hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {user ? (
            <>
              <Link
                href="/wallet"
                className="flex items-center gap-2 rounded-full border border-line-soft bg-panel/70 px-4 py-2 transition-colors hover:border-lime/50"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-lime" />
                <span className="tabular text-sm font-semibold">
                  {balance === null ? "—" : formatCents(balance)}
                </span>
              </Link>
              <div className="hidden text-right leading-tight sm:block">
                <div className="text-sm font-semibold">{user.display_name}</div>
                <button
                  onClick={switchPlayer}
                  disabled={pending}
                  className="text-xs text-dim transition-colors hover:text-bad disabled:opacity-50"
                >
                  {pending ? "…" : "switch player"}
                </button>
              </div>
            </>
          ) : (
            <Link
              href="/join"
              className="display rounded-full bg-lime px-5 py-2.5 text-sm text-bg transition-transform hover:-translate-y-0.5"
            >
              Join
            </Link>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            className="rounded-xl border border-line-soft px-3 py-2 text-muted md:hidden"
          >
            ☰
          </button>
        </div>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-line-soft px-6 py-3 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="rounded-xl px-3 py-2.5 text-sm text-muted hover:bg-panel/60 hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
          {user && (
            <button
              onClick={switchPlayer}
              className="rounded-xl px-3 py-2.5 text-left text-sm text-dim hover:text-bad"
            >
              Switch player
            </button>
          )}
        </nav>
      )}
    </header>
  );
}
