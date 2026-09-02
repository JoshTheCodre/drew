import type { Metadata } from "next";
import { Geist, Geist_Mono, Archivo_Black } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { SiteHeader } from "@/components/SiteHeader";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Archivo_Black({ variable: "--font-display", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: { default: "Drew Arcade", template: "%s · Drew Arcade" },
  description: "A home for skill games. Predict live market prices, duel for the pot, climb the board.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${display.variable} antialiased`}>
        <div className="flex min-h-screen flex-col">
          <SiteHeader user={user} />
          <main className="flex-1">{children}</main>
          <footer className="mt-20 border-t border-line-soft px-6 py-10 text-sm text-dim">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="display text-lg text-muted">Drew Arcade</div>
                <p className="mt-1 max-w-md">
                  Prices from the public CoinGecko API. Balances are simulated — no real money moves
                  through this build.
                </p>
              </div>
              <div className="flex gap-5">
                <Link href="/games/price-prediction" className="transition-colors hover:text-lime">
                  Price Prediction
                </Link>
                <Link href="/games/wordle-duel" className="transition-colors hover:text-lime">
                  Wordle Duel
                </Link>
                <Link href="/leaderboard" className="transition-colors hover:text-lime">
                  Leaderboard
                </Link>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
