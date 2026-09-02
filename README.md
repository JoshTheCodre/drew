# Drew Arcade

A fullstack Next.js app that hosts several games behind one account, one wallet and one
leaderboard. Two games are live:

| Game | Plays for | Shape |
| --- | --- | --- |
| **Price Prediction** | Points | Predict where BTC / ETH / SOL will be at a fixed settlement time. Closest number wins the round. |
| **Wordle Duel** | Money (simulated) | Two players stake the same amount and race on the same word. First to solve takes the pot minus the house fee — $500 + $500 pays **$900**. |

Everything runs in one Next.js process: App Router pages, route handlers for the API, and
SQLite through Node's built-in `node:sqlite` — no database server, no native build step.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

The database creates itself at `./data/arcade.db` on first request.

## Joining

There's no password. `/join` asks for three things — name, date of birth, country — and the
session cookie *is* the account. Date of birth and country aren't decoration: they feed the
age and region gates that guard staked play. New players start with a simulated balance
(`WELCOME_BONUS_CENTS`, default $1,000) so a $500 duel is playable immediately.

## Money: simulated funds, real accounting

Balances are fake. The bookkeeping under them is not.

- **Two buckets per wallet.** `available` is spendable; `escrow` is committed to a live match
  and untouchable by either player.
- **One write path.** Every movement goes through `post()` in [`src/lib/wallet.ts`](src/lib/wallet.ts),
  which writes an append-only `ledger_entries` row alongside the balance update. Nothing else
  mutates `wallets`.
- **Integer cents throughout.** No floating-point money.
- **Atomic settlement.** Both players' balances and the house cut move inside one SQLite
  transaction, or none of them do.

A duel settles like this — $500 stakes, 10% rake:

| Account | Entry | available | escrow |
| --- | --- | ---: | ---: |
| Winner | `stake_release` | +50000 | −50000 |
| Winner | `payout` | +40000 | 0 |
| Loser | `stake_forfeit` | 0 | −50000 |
| House | `rake` | +10000 | 0 |

Winner nets +$400 on a $900 return, loser −$500, house +$100. A draw, an expiry or a
cancelled challenge releases both stakes in full and takes no rake.

You can verify the invariants against a live database at any time:

```bash
node -e "
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('./data/arcade.db');
for (const w of db.prepare('SELECT * FROM wallets').all()) {
  const s = db.prepare('SELECT SUM(available_delta) a, SUM(escrow_delta) e FROM ledger_entries WHERE user_id=?').get(w.user_id);
  console.log(w.user_id, s.a === w.available_cents && s.e === w.escrow_cents ? 'OK' : 'MISMATCH');
}"
```

### Swapping in a real payment rail

[`src/lib/payments.ts`](src/lib/payments.ts) defines a `PaymentProvider` with two methods
(`charge`, `sendPayout`) and ships a simulated implementation that settles instantly. A
deposit of exactly **$13.13** is declined on purpose so the failure path is reachable.
Implement the same interface against a real processor and nothing above that file changes.

The same applies to [`src/lib/compliance.ts`](src/lib/compliance.ts): the simulated KYC vendor
approves anyone 18+ from an allowed region (use the legal name `REJECT` to force a decline).
`assertCanStake()` is the single gate every staked action calls.

> Running this with real money is a different product: it needs licensing, a real KYC vendor,
> geo-restriction, and a payment processor. The interfaces are where that work plugs in.

## Fairness in Wordle Duel

- The answer is chosen with `crypto.randomInt` at match creation and **never** leaves the
  server until the match ends — `MatchView.word` is `null` for anything unfinished.
- Both boards unlock at the same instant, when the second player stakes.
- You see your opponent's colours live, but never their letters.
- The winning guess is written and settled inside one transaction, so two simultaneous correct
  guesses serialise: exactly one payout, and the loser gets *"Your opponent solved it first."*
- Guesses validate against ~12.6k five-letter English words; answers come from a curated
  common-word list, so nobody loses $500 to obscure vocabulary.

## Round scheduling

Price Prediction rounds and duel expiries advance lazily — any read calls `tick()` / `sweep()`,
so the app is self-driving while anyone is looking at it. For quiet periods, hit
`/api/cron/tick` on a schedule (set `CRON_SECRET` to protect it).

## Layout

```
src/
  app/
    page.tsx                     live dashboard: open rounds + open duels, both actionable
    join/  wallet/  leaderboard/
    games/price-prediction/
    games/wordle-duel/[id]/      the duel board
    api/                         route handlers
  lib/
    db.ts                        node:sqlite handle + schema
    auth.ts                      passwordless join + sessions
    wallet.ts                    escrow + append-only ledger
    payments.ts                  PaymentProvider (simulated)
    compliance.ts                KYC / age / geo gate (simulated)
    markets.ts                   CoinGecko price feed + tick history
    games/registry.ts            arcade catalogue
    games/price-prediction/
    games/wordle-duel/
  components/
```

## Adding a third game

1. Add an entry to `GAMES` in [`src/lib/games/registry.ts`](src/lib/games/registry.ts) — it
   appears on the arcade home page automatically.
2. Add tables to the schema in `src/lib/db.ts` and an engine under `src/lib/games/<id>/`.
3. Add a route under `src/app/games/<id>/` and its handlers under `src/app/api/games/<id>/`.
4. Write points to the shared `leaderboard` table, or take stakes through `src/lib/wallet.ts`.

## Configuration

See [`.env.example`](.env.example). Every value has a working default; the app runs with no
`.env` at all.
