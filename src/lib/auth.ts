import { cookies } from "next/headers";
import { db, tx } from "./db";
import { newId, newToken } from "./ids";
import { ensureWallet, deposit } from "./wallet";
import { ageFrom, MIN_AGE, submitVerification } from "./compliance";

export const SESSION_COOKIE = "arcade_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/** Simulated money, so every new player starts with a stack to play with. */
export const WELCOME_BONUS_CENTS = Number(process.env.WELCOME_BONUS_CENTS ?? 100_000);

export type User = { id: string; username: string; display_name: string; created_at: number };

export class AuthError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** "Drew Oga" -> "drew_oga", plus a numeric suffix if that handle is taken. */
function handleFor(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 16) || "player";

  let candidate = base;
  let n = 1;
  while (db.prepare("SELECT 1 AS ok FROM users WHERE username = ?").get(candidate)) {
    n += 1;
    candidate = `${base}${n}`.slice(0, 20);
  }
  return candidate;
}

export type JoinInput = {
  name: string;
  dateOfBirth: string; // YYYY-MM-DD
  country: string;     // ISO-ish country code or name
};

/**
 * The whole sign-up. No password: the session cookie is the account, and the
 * three fields we ask for are the ones the age and region gates need anyway.
 */
export function joinAsPlayer(input: JoinInput): User {
  const name = String(input.name ?? "").trim();
  const dateOfBirth = String(input.dateOfBirth ?? "").trim();
  const country = String(input.country ?? "").trim();

  if (name.length < 2) throw new AuthError("Tell us what to call you (at least 2 characters).");
  if (name.length > 32) throw new AuthError("That name is a little long — 32 characters max.");
  if (!dateOfBirth) throw new AuthError("We need your date of birth to check you're old enough.");

  const age = ageFrom(dateOfBirth);
  if (!Number.isFinite(age)) throw new AuthError("That date of birth doesn't look right.");
  if (age < MIN_AGE) throw new AuthError(`You need to be ${MIN_AGE} or older to play for stakes.`);
  if (age > 120) throw new AuthError("That date of birth doesn't look right.");
  if (!country) throw new AuthError("Pick the country you're playing from.");

  return tx(() => {
    const user: User = {
      id: newId("usr"),
      username: handleFor(name),
      display_name: name,
      created_at: Date.now(),
    };

    db.prepare(
      "INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, '', ?)",
    ).run(user.id, user.username, user.display_name, user.created_at);

    ensureWallet(user.id);
    if (WELCOME_BONUS_CENTS > 0) {
      deposit(user.id, WELCOME_BONUS_CENTS, "welcome", "Simulated welcome balance");
    }

    // Same simulated vendor the staking gate consults; runs once, here.
    submitVerification(user.id, { legalName: name, dateOfBirth, country });

    return user;
  });
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export function createSession(userId: string): { id: string; expiresAt: number } {
  const id = newToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    id,
    userId,
    now,
    expiresAt,
  );
  return { id, expiresAt };
}

export function destroySession(id: string) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function userForSession(sessionId: string): User | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.created_at, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(sessionId) as unknown as (User & { expires_at: number }) | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(sessionId);
    return null;
  }
  const { expires_at: _expires, ...user } = row;
  void _expires;
  return user;
}

/** Current player from the request cookie, or null. */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  return sid ? userForSession(sid) : null;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AuthError("Join first — it takes about ten seconds.", 401);
  return user;
}

export function sessionCookieOptions(expiresAt: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  };
}
