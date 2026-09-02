import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { COLLECTIONS, store } from "./firestore";
import { newId, newToken } from "./ids";
import { nowMs } from "./clock";
import { withLedger } from "./wallet";
import { MIN_AGE, ageFrom, runVendorCheck, writeCompliance } from "./compliance";

export const SESSION_COOKIE = "arcade_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/** Simulated money, so every new player starts with a stack to play with. */
export const WELCOME_BONUS_CENTS = Number(process.env.WELCOME_BONUS_CENTS ?? 100_000);

export type User = { id: string; username: string; display_name: string; created_at: number };

type UserDoc = { username: string; displayName: string; createdAt: number };
type SessionDoc = { userId: string; createdAt: number; expiresAt: number };

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const toUser = (id: string, doc: UserDoc): User => ({
  id,
  username: doc.username,
  display_name: doc.displayName,
  created_at: doc.createdAt,
});

/** "Drew Oga" -> "drew_oga" */
function handleBase(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 16) || "player"
  );
}

/** Finds an unclaimed handle. The transaction re-checks before committing. */
async function proposeHandle(base: string): Promise<string> {
  const db = await store();
  for (let n = 1; n <= 20; n++) {
    const candidate = n === 1 ? base : `${base}${n}`.slice(0, 20);
    if (!(await db.get(COLLECTIONS.usernames, candidate))) return candidate;
  }
  return `${base}_${randomBytes(2).toString("hex")}`.slice(0, 20);
}

export type JoinInput = {
  name: string;
  dateOfBirth: string; // YYYY-MM-DD
  country: string;
};

/**
 * The whole sign-up. No password: the session cookie is the account, and the
 * three fields we ask for are exactly what the age and region gates need.
 */
export async function joinAsPlayer(input: JoinInput): Promise<User> {
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

  const check = { legalName: name, dateOfBirth, country };
  const vendor = runVendorCheck(check);
  if (vendor.status === "rejected") {
    throw new AuthError(vendor.reason ?? "We couldn't verify those details.", 403);
  }

  const base = handleBase(name);
  const proposed = await proposeHandle(base);
  const userId = newId("usr");
  const createdAt = nowMs();

  return withLedger([userId], async (batch, tx) => {
    // Reads first: confirm the handle is still free inside the transaction.
    const taken = await tx.get(COLLECTIONS.usernames, proposed);
    const username = taken ? `${base}_${randomBytes(3).toString("hex")}`.slice(0, 20) : proposed;

    const doc: UserDoc = { username, displayName: name, createdAt };
    tx.set(COLLECTIONS.users, userId, doc);
    tx.set(COLLECTIONS.usernames, username, { userId, createdAt });
    writeCompliance(tx, userId, check, vendor);

    if (WELCOME_BONUS_CENTS > 0) {
      batch.deposit(userId, WELCOME_BONUS_CENTS, "welcome", "Simulated welcome balance");
    }

    return toUser(userId, doc);
  });
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export async function createSession(userId: string): Promise<{ id: string; expiresAt: number }> {
  const db = await store();
  const id = newToken();
  const createdAt = nowMs();
  const expiresAt = createdAt + SESSION_TTL_MS;
  await db.set(COLLECTIONS.sessions, id, { userId, createdAt, expiresAt } satisfies SessionDoc);
  return { id, expiresAt };
}

export async function destroySession(id: string) {
  const db = await store();
  await db.remove(COLLECTIONS.sessions, id);
}

export async function userForSession(sessionId: string): Promise<User | null> {
  const db = await store();
  const session = await db.get<SessionDoc>(COLLECTIONS.sessions, sessionId);
  if (!session) return null;
  if (session.expiresAt < nowMs()) {
    await destroySession(sessionId);
    return null;
  }
  const doc = await db.get<UserDoc>(COLLECTIONS.users, session.userId);
  return doc ? toUser(session.userId, doc) : null;
}

/**
 * Next signals control flow — redirect, notFound, dynamic-usage — by throwing
 * errors that carry a `digest`. Those must pass straight through any catch.
 */
function isFrameworkError(error: unknown): boolean {
  return typeof (error as { digest?: unknown } | null)?.digest === "string";
}

/**
 * Current player from the request cookie, or null.
 *
 * Swallows database failures on purpose: the root layout calls this on every
 * request, so a Firestore blip must degrade to "signed out" rather than take
 * down every page in the app.
 */
export async function currentUser(): Promise<User | null> {
  try {
    const jar = await cookies();
    const sid = jar.get(SESSION_COOKIE)?.value;
    return sid ? await userForSession(sid) : null;
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    console.error("[auth] session lookup failed", error);
    return null;
  }
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AuthError("Join first — it takes about ten seconds.", 401);
  return user;
}

/** Lightweight lookups for opponent names, leaderboards and so on. */
export async function usersById(ids: string[]): Promise<Map<string, User>> {
  const db = await store();
  const unique = [...new Set(ids.filter(Boolean))];
  const found = await Promise.all(
    unique.map(async (id) => {
      const doc = await db.get<UserDoc>(COLLECTIONS.users, id);
      return doc ? toUser(id, doc) : null;
    }),
  );
  return new Map(found.filter((u): u is User => Boolean(u)).map((u) => [u.id, u]));
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
