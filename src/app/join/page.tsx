import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, WELCOME_BONUS_CENTS } from "@/lib/auth";
import { MIN_AGE } from "@/lib/compliance";
import { JoinForm } from "@/components/JoinForm";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = { title: "Join" };
export const dynamic = "force-dynamic";

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await currentUser();
  const { next } = await searchParams;
  if (user) redirect(next ?? "/");

  return (
    <div className="mx-auto flex max-w-md flex-col justify-center px-6 py-16">
      <h1 className="display display-hero text-5xl">
        Join the <span className="text-lime">arcade</span>
      </h1>
      <p className="mt-5 text-muted">
        Three details, no password. Date of birth and country aren&apos;t decoration — staked games are{" "}
        {MIN_AGE}+ and region-restricted.
      </p>
      {WELCOME_BONUS_CENTS > 0 && (
        <p className="mt-5 rounded-2xl border border-lime/30 bg-lime/5 px-5 py-4 text-sm text-lime">
          You&apos;ll start with <strong className="font-semibold">{formatCents(WELCOME_BONUS_CENTS)}</strong>{" "}
          in simulated balance — enough for a $500 duel straight away.
        </p>
      )}
      <JoinForm next={next ?? "/"} />
    </div>
  );
}
