import { db } from "./db";

export type Market = {
  id: string;          // internal + CoinGecko id
  symbol: string;      // BTC
  name: string;        // Bitcoin
  quote: string;       // USD
  decimals: number;    // display precision
  accent: string;      // tailwind-ish hex for UI
};

/** Public markets the platform tracks. Add a row here to add a market. */
export const MARKETS: Market[] = [
  { id: "bitcoin",  symbol: "BTC", name: "Bitcoin",  quote: "USD", decimals: 2, accent: "#f7931a" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", quote: "USD", decimals: 2, accent: "#8a92b2" },
  { id: "solana",   symbol: "SOL", name: "Solana",   quote: "USD", decimals: 2, accent: "#14f195" },
];

export const marketById = (id: string) => MARKETS.find((m) => m.id === id);

const SOURCE_URL =
  process.env.PRICE_API_URL ?? "https://api.coingecko.com/api/v3/simple/price";
const CACHE_MS = Number(process.env.PRICE_CACHE_MS ?? 15_000);

type CacheEntry = { price: number; ts: number };
const g = globalThis as unknown as { __priceCache?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = g.__priceCache ?? (g.__priceCache = new Map());

function recordTick(marketId: string, price: number, ts: number) {
  // bucket to the second so the PK dedupes bursts
  const bucket = Math.floor(ts / 1000) * 1000;
  db.prepare("INSERT OR REPLACE INTO price_ticks (market_id, ts, price) VALUES (?, ?, ?)")
    .run(marketId, bucket, price);
}

/** Fetch live prices for every tracked market. Throws if the feed is unreachable. */
export async function fetchPrices(ids: string[] = MARKETS.map((m) => m.id)): Promise<Map<string, number>> {
  const url = `${SOURCE_URL}?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Price feed returned ${res.status}`);
  const body = (await res.json()) as Record<string, { usd?: number }>;

  const out = new Map<string, number>();
  const now = Date.now();
  for (const id of ids) {
    const price = body?.[id]?.usd;
    if (typeof price === "number" && Number.isFinite(price)) {
      out.set(id, price);
      cache.set(id, { price, ts: now });
      recordTick(id, price, now);
    }
  }
  if (out.size === 0) throw new Error("Price feed returned no usable prices");
  return out;
}

/** Cached read — hits the network at most once per CACHE_MS. */
export async function getPrices(ids: string[] = MARKETS.map((m) => m.id)): Promise<Map<string, number>> {
  const now = Date.now();
  const stale = ids.filter((id) => (cache.get(id)?.ts ?? 0) < now - CACHE_MS);
  if (stale.length > 0) {
    try {
      await fetchPrices(ids);
    } catch {
      // fall through to whatever is cached / persisted
    }
  }
  const out = new Map<string, number>();
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit) { out.set(id, hit.price); continue; }
    const row = db
      .prepare("SELECT price FROM price_ticks WHERE market_id = ? ORDER BY ts DESC LIMIT 1")
      .get(id) as { price: number } | undefined;
    if (row) out.set(id, row.price);
  }
  return out;
}

export function priceHistory(marketId: string, sinceMs: number): { ts: number; price: number }[] {
  return db
    .prepare("SELECT ts, price FROM price_ticks WHERE market_id = ? AND ts >= ? ORDER BY ts ASC")
    .all(marketId, sinceMs) as { ts: number; price: number }[];
}
