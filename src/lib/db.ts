import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DB_DIR = process.env.DB_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "arcade.db");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Generic cross-game leaderboard. Every game writes here.
CREATE TABLE IF NOT EXISTS leaderboard (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  points  INTEGER NOT NULL DEFAULT 0,
  wins    INTEGER NOT NULL DEFAULT 0,
  plays   INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);

-- ---------- Price Prediction ----------
CREATE TABLE IF NOT EXISTS pp_rounds (
  id           TEXT PRIMARY KEY,
  market_id    TEXT NOT NULL,
  status       TEXT NOT NULL,               -- open | locked | resolved | void
  opens_at     INTEGER NOT NULL,
  locks_at     INTEGER NOT NULL,
  resolves_at  INTEGER NOT NULL,
  open_price   REAL,
  final_price  REAL,
  resolved_at  INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pp_rounds_market_status ON pp_rounds(market_id, status);
CREATE INDEX IF NOT EXISTS idx_pp_rounds_resolves ON pp_rounds(resolves_at);

CREATE TABLE IF NOT EXISTS pp_predictions (
  id         TEXT PRIMARY KEY,
  round_id   TEXT NOT NULL REFERENCES pp_rounds(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value      REAL NOT NULL,
  created_at INTEGER NOT NULL,
  abs_error  REAL,
  placement  INTEGER,
  points     INTEGER,
  UNIQUE (round_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pp_pred_round ON pp_predictions(round_id);
CREATE INDEX IF NOT EXISTS idx_pp_pred_user ON pp_predictions(user_id);

-- Cache of price observations, doubles as a sparkline source.
CREATE TABLE IF NOT EXISTS price_ticks (
  market_id TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  price     REAL NOT NULL,
  PRIMARY KEY (market_id, ts)
);

-- ---------- Wallet (simulated currency, real accounting) ----------
CREATE TABLE IF NOT EXISTS wallets (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  available_cents INTEGER NOT NULL DEFAULT 0,   -- spendable right now
  escrow_cents    INTEGER NOT NULL DEFAULT 0,   -- locked into live matches
  currency        TEXT    NOT NULL DEFAULT 'USD',
  updated_at      INTEGER NOT NULL
);

-- Append-only audit trail. Every cent that moves gets a row.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,               -- 'house' for rake
  kind            TEXT NOT NULL,               -- deposit|withdrawal|stake_hold|stake_release|stake_forfeit|payout|rake|refund
  available_delta INTEGER NOT NULL,
  escrow_delta    INTEGER NOT NULL,
  available_after INTEGER NOT NULL,
  escrow_after    INTEGER NOT NULL,
  ref_type        TEXT,
  ref_id          TEXT,
  memo            TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_ref ON ledger_entries(ref_type, ref_id);

-- Simulated compliance state. Same shape a real KYC provider would fill in.
CREATE TABLE IF NOT EXISTS compliance (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kyc_status   TEXT NOT NULL DEFAULT 'unverified',  -- unverified|pending|verified|rejected
  legal_name   TEXT,
  date_of_birth TEXT,
  country      TEXT,
  region       TEXT,
  provider_ref TEXT,
  reviewed_at  INTEGER,
  updated_at   INTEGER NOT NULL
);

-- Withdrawal requests: a real payout rail would drain this queue.
CREATE TABLE IF NOT EXISTS payouts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL,                  -- pending|paid|failed
  destination  TEXT,
  provider_ref TEXT,
  created_at   INTEGER NOT NULL,
  settled_at   INTEGER
);

-- ---------- Wordle Duel ----------
CREATE TABLE IF NOT EXISTS wd_matches (
  id            TEXT PRIMARY KEY,
  word          TEXT NOT NULL,                 -- never leaves the server until settlement
  stake_cents   INTEGER NOT NULL,
  rake_bps      INTEGER NOT NULL,
  status        TEXT NOT NULL,                 -- waiting|active|finished|cancelled
  host_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guest_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  winner_id     TEXT,
  outcome       TEXT,                          -- solved|both_failed|expired|forfeit|cancelled
  pot_cents     INTEGER,
  payout_cents  INTEGER,
  rake_cents    INTEGER,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  deadline_at   INTEGER,
  finished_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wd_status ON wd_matches(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wd_deadline ON wd_matches(status, deadline_at);

CREATE TABLE IF NOT EXISTS wd_guesses (
  id         TEXT PRIMARY KEY,
  match_id   TEXT NOT NULL REFERENCES wd_matches(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  turn       INTEGER NOT NULL,
  guess      TEXT NOT NULL,
  pattern    TEXT NOT NULL,                    -- 5 chars of g/y/b
  solved     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (match_id, user_id, turn)
);
CREATE INDEX IF NOT EXISTS idx_wd_guesses_match ON wd_guesses(match_id, created_at ASC);
`;

function create(): DatabaseSync {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  return db;
}

// Next dev reloads modules; keep one handle on globalThis.
const g = globalThis as unknown as { __arcadeDb?: DatabaseSync };
export const db: DatabaseSync = g.__arcadeDb ?? (g.__arcadeDb = create());

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
}
