# Drew Arcade

A fullstack Next.js app hosting several games behind one account, one wallet and one
leaderboard. Three games are live:

| Game | Plays for | Shape |
| --- | --- | --- |
| **Price Prediction** | Points | Predict where BTC / ETH / SOL will be at a fixed settlement time. Closest number wins the round. |
| **Wordle Duel** | Money (simulated) | Two players stake the same amount and race on the same word. First to solve takes the pot minus the house fee — $500 + $500 pays **$900**. |
| **Chess Stakes** | Money (simulated) | 5+3 blitz on the same escrow rails. Every move validated server-side by `chess.js`; checkmate, resignation or a flag on time takes the pot. |

Everything runs in one Next.js process: App Router pages, route handlers for the API, and
Firestore for storage.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

No configuration required — it connects to the bundled Firebase project using the public web
config. Visit `/api/health` to confirm which storage backend is live.

## Joining

There's no password. `/join` asks for three things — name, date of birth, country — and the
session cookie *is* the account. Date of birth and country aren't decoration: they feed the
age and region gates that guard staked play. New players start with a simulated balance
(`WELCOME_BONUS_CENTS`, default $1,000) so a $500 duel is playable immediately.

## Money: simulated funds, real accounting

Balances are fake. The bookkeeping under them is not.

- **Two buckets per wallet.** `available` is spendable; `escrow` is committed to a live match
  and untouchable by either player.
- **One write path.** Money only moves through `LedgerBatch` in [`src/lib/wallet.ts`](src/lib/wallet.ts),
  which writes an append-only `ledger` document alongside every balance change.
- **Integer cents throughout.** No floating-point money.
- **Atomic settlement.** Both players' balances and the house cut move inside one Firestore
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

### Swapping in a real payment rail

[`src/lib/payments.ts`](src/lib/payments.ts) defines a `PaymentProvider` with two methods
(`charge`, `sendPayout`) and ships a simulated implementation that settles instantly. A
deposit of exactly **$13.13** is declined on purpose so the failure path is reachable.

[`src/lib/compliance.ts`](src/lib/compliance.ts) does the same for KYC: the simulated vendor
approves anyone 18+ from an allowed region (use the legal name `REJECT` to force a decline).
`assertCanStake()` is the single gate every staked action calls.

> Running this with real money is a different product: it needs licensing, a real KYC vendor,
> geo-restriction and a payment processor. These interfaces are where that work plugs in.

## Firestore

Storage lives behind one small interface in [`src/lib/firestore.ts`](src/lib/firestore.ts)
with two backends:

- **admin** — used whenever a service account is configured. Bypasses security rules, so the
  rules can deny every browser outright. **This is the one to deploy with.**
- **web** — the public web SDK. Needs no credentials so the app runs immediately, but it is
  subject to security rules and is noticeably slower to start. Development only.

Two deliberate constraints keep it portable and zero-setup:

1. **No query runs inside a transaction.** The web SDK can't do it, and designing around it
   means anything that must be atomic lives in a single document — a whole duel, or a whole
   chess game, is one document.
2. **No `where` is ever paired with `orderBy` on a different field.** That combination
   requires a deployed composite index; sorting in memory instead means the app runs against
   a brand-new Firestore project with no index configuration at all.

Rounds use deterministic document ids (`bitcoin_2980537` — market plus time slot) so
concurrent requests that notice a missing round converge on one document instead of racing to
create several.

### Deploying (Vercel)

1. **Set `FIREBASE_SERVICE_ACCOUNT`** to your service account JSON (or its base64 form):
   Firebase console → Project settings → Service accounts → Generate new private key. Without
   it the app falls back to the web SDK, which is slow to cold-start in serverless and stays
   subject to security rules.
2. **Deploy the rules**: `firebase deploy --only firestore:rules`. The bundled
   [`firestore.rules`](firestore.rules) denies all direct client access — correct once the
   Admin SDK is in use, and important, because wallets and the secret words of live duels
   live in this database. *A project left in test mode is world-writable.*
3. Optionally set `CRON_SECRET` and point a scheduler at `/api/cron/tick`.

Check `/api/health` after deploying: it reports the active backend, whether credentials were
found, and whether a read actually succeeded.

## Performance notes

Housekeeping — advancing rounds, settling expired matches, refreshing the price feed — runs
*after* the response is sent via `after()` and is throttled per process
([`src/lib/schedule.ts`](src/lib/schedule.ts)). Page renders read the last known state and
never wait on the scheduler or on CoinGecko. Doing this on the critical path made the home
page take ~7s; it now serves in well under a second warm.

## Game fairness

**Wordle Duel**
- The answer is chosen with `crypto.randomInt` and never leaves the server until the match
  ends — `MatchView.word` is `null` for anything unfinished.
- Both boards unlock at the same instant, when the second player stakes.
- You see your opponent's colours live, but never their letters.
- The winning guess is written and settled in one transaction, so two simultaneous correct
  guesses serialise: exactly one payout, and the loser is told *"Your opponent solved it first."*
- Guesses validate against ~12.6k five-letter English words; answers come from a curated
  common-word list, so nobody loses $500 to obscure vocabulary.
- Full Wordle choreography: letter pop on keystroke, row jiggle for a word that isn't in the
  list, sequential tile flip on submit, and a win bounce. All six rows stay visible
  throughout — history never clears.

**Chess Stakes**
- `chess.js` validates every move on the server; the client never decides legality.
- Colours are drawn at random when a challenge is accepted, so nobody picks the white side.
- Clocks are stored as remaining milliseconds plus a turn start, so time can't be gamed by a
  slow client. A move that arrives after the flag falls loses.
- The board computes legal moves locally too — a chess position is public information — so it
  responds instantly and can show you your options while the opponent is thinking.

## Layout

```
src/
  app/
    page.tsx                     live dashboard: open rounds + open duels, both actionable
    join/  wallet/  leaderboard/
    games/price-prediction/
    games/wordle-duel/[id]/      the duel board
    games/chess/[id]/            the chess board
    api/                         route handlers, incl. /api/health and /api/cron/tick
  lib/
    firestore.ts                 storage interface, admin + web backends
    schedule.ts                  post-response housekeeping
    auth.ts                      passwordless join + sessions
    wallet.ts                    escrow + append-only ledger
    payments.ts                  PaymentProvider (simulated)
    compliance.ts                KYC / age / geo gate (simulated)
    leaderboard.ts               shared cross-game standings
    markets.ts                   CoinGecko price feed + tick history
    games/registry.ts            arcade catalogue
    games/{price-prediction,wordle-duel,chess}/
  components/
```

## Adding a fourth game

1. Add an entry to `GAMES` in [`src/lib/games/registry.ts`](src/lib/games/registry.ts) — it
   appears on the arcade home page automatically.
2. Add a collection to `COLLECTIONS` in `src/lib/firestore.ts` and an engine under
   `src/lib/games/<id>/`.
3. Add a route under `src/app/games/<id>/` and handlers under `src/app/api/games/<id>/`.
4. Write points via `bumpLeaderboard`, or take stakes through `withLedger` in
   `src/lib/wallet.ts`.

## Configuration

See [`.env.example`](.env.example). Every value has a working default; the app runs with no
`.env` at all.
