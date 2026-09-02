"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const COUNTRIES = [
  ["NG", "Nigeria"], ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"],
  ["GH", "Ghana"], ["KE", "Kenya"], ["ZA", "South Africa"], ["IN", "India"],
  ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"], ["IE", "Ireland"],
  ["AU", "Australia"], ["NZ", "New Zealand"], ["BR", "Brazil"], ["MX", "Mexico"],
  ["JP", "Japan"], ["SG", "Singapore"], ["AE", "United Arab Emirates"], ["OT", "Somewhere else"],
] as const;

export function JoinForm({ next }: { next: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [country, setCountry] = useState("NG");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, dateOfBirth, country }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That didn't work.");
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="panel mt-8 space-y-5 p-7">
      <Field label="Your name" hint="This is what opponents see">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={32}
          autoFocus
          placeholder="Drew"
          className="w-full bg-transparent text-lg outline-none placeholder:text-dim/50"
        />
      </Field>

      <Field label="Date of birth" hint="18+ only — checked before you can stake">
        <input
          type="date"
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
          required
          max={new Date().toISOString().slice(0, 10)}
          className="tabular w-full bg-transparent text-lg outline-none [color-scheme:dark]"
        />
      </Field>

      <Field label="Country" hint="Some regions can't play for stakes">
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="w-full bg-transparent text-lg outline-none"
        >
          {COUNTRIES.map(([code, label]) => (
            <option key={code} value={code} className="bg-panel text-ink">
              {label}
            </option>
          ))}
        </select>
      </Field>

      {error && <p className="text-sm font-semibold text-bad">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="display w-full rounded-2xl bg-lime py-4 text-lg text-bg transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40"
      >
        {busy ? "Joining…" : "Join and play"}
      </button>

      <p className="text-xs text-dim">
        Balances in this build are simulated. No payment details are collected or stored.
      </p>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-widest text-dim">{label}</span>
      <div className="mt-2 rounded-2xl border border-line bg-bg-soft px-5 py-3.5 focus-within:border-lime/60">
        {children}
      </div>
      {hint && <span className="mt-1.5 block text-xs text-dim">{hint}</span>}
    </label>
  );
}
