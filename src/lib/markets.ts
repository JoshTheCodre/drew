import "server-only";
import { COLLECTIONS, store } from "./firestore";
import { nowMs } from "./clock";

export type Market = {
  id: string; // internal + CoinGecko id
  symbol: string; // BTC
  name: string; // Bitcoin
  quote: string; // USD
  decimals: number; // display precision
  accent: string; // hex used in the UI
};

/** Public markets the platform tracks. Add a row here to add a market. */
export const MARKETS: Market[] = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin", quote: "USD", decimals: 2, accent: "#f7931a" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", quote: "USD", decimals: 2, accent: "#9d6bff" },
  { id: "solana", symbol: "SOL", name: "Solana", quote: "USD", decimals: 2, accent: "#14f195" },
];

export const marketById = (id: string) => MARKETS.find((m) => m.id === id);

const SOURCE_URL = process.env.PRICE_API_URL ?? "https://api.coingecko.com/api/v3/simple/price";
const CACHE_MS = Number(process.env.PRICE_CACHE_MS ?? 15_000);
const HISTORY_POINTS = 120;

export type Tick = { ts: number; price: number };
type MarketDoc = { price: number; ts: number; history: Tick[] };

/**
 * In-process cache. Firestore is the durable record, but polling clients would
 * otherwise turn every page view into a document read per market.
 */
type CacheEntry = { price: number; ts: number; history: Tick[]; fetchedAt: number };
const g = globalThis as unknown as { __priceCache?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = (g.__priceCache ??= new Map());

async function persist(marketId: string, price: number, ts: number) {
  const db = await store();
  const existing = cache.get(marketId)?.history ?? (await db.get<MarketDoc>(COLLECTIONS.markets, marketId))?.history ?? [];
  // One point per second, capped — enough for a sparkline, bounded in size.
  const bucket = Math.floor(ts / 1000) * 1000;
  const history = [...existing.filter((t) => t.ts !== bucket), { ts: bucket, price }]
    .sort((a, b) => a.ts - b.ts)
    .slice(-HISTORY_POINTS);

  cache.set(marketId, { price, ts, history, fetchedAt: ts });
  await db.set(COLLECTIONS.markets, marketId, { price, ts, history } satisfies MarketDoc);
}

/** Fetch live prices for the given markets. Throws if the feed is unreachable. */
export async function fetchPrices(
  ids: string[] = MARKETS.map((m) => m.id),
): Promise<Map<string, number>> {
  const url = `${SOURCE_URL}?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Price feed returned ${res.status}`);
  const body = (await res.json()) as Record<string, { usd?: number }>;

  const out = new Map<string, number>();
  const ts = nowMs();
  for (const id of ids) {
    const price = body?.[id]?.usd;
    if (typeof price === "number" && Number.isFinite(price)) {
      out.set(id, price);
      await persist(id, price, ts);
    }
  }
  if (out.size === 0) throw new Error("Price feed returned no usable prices");
  return out;
}

/** Cached read — hits the network at most once per CACHE_MS. */
export async function getPrices(
  ids: string[] = MARKETS.map((m) => m.id),
): Promise<Map<string, number>> {
  const at = nowMs();
  const stale = ids.filter((id) => (cache.get(id)?.fetchedAt ?? 0) < at - CACHE_MS);
  if (stale.length > 0) {
    try {
      await fetchPrices(ids);
    } catch {
      // fall through to whatever is cached or persisted
    }
  }

  const db = await store();
  const out = new Map<string, number>();
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit) {
      out.set(id, hit.price);
      continue;
    }
    const doc = await db.get<MarketDoc>(COLLECTIONS.markets, id);
    if (doc) {
      cache.set(id, { price: doc.price, ts: doc.ts, history: doc.history ?? [], fetchedAt: 0 });
      out.set(id, doc.price);
    }
  }
  return out;
}

/** Plain objects only — these cross the server/client boundary. */
export async function priceHistory(marketId: string, sinceMs: number): Promise<Tick[]> {
  const hit = cache.get(marketId);
  const history = hit
    ? hit.history
    : ((await (await store()).get<MarketDoc>(COLLECTIONS.markets, marketId))?.history ?? []);
  return history.filter((t) => t.ts >= sinceMs).map((t) => ({ ts: t.ts, price: t.price }));
}
