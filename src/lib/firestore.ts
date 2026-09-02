import "server-only";

/**
 * Firestore access, server-side only.
 *
 * Two backends behind one interface:
 *
 *   admin — used whenever a service account is configured. Bypasses security
 *           rules, which is what a wallet needs: the rules can then deny every
 *           browser outright (see firestore.rules).
 *   web   — the plain web SDK with the public project config. Works with no
 *           extra credentials so the app runs today, but it is subject to
 *           security rules, so it is a development convenience, not a
 *           production posture.
 *
 * Deliberate constraint: no query ever runs inside a transaction. The web SDK
 * cannot do it, and designing around it keeps both backends honest — anything
 * that must be atomic lives in a single document.
 */

export const COLLECTIONS = {
  users: "users",
  usernames: "usernames",
  sessions: "sessions",
  wallets: "wallets",
  ledger: "ledger",
  compliance: "compliance",
  payouts: "payouts",
  markets: "markets",
  ppRounds: "ppRounds",
  ppPredictions: "ppPredictions",
  wdMatches: "wdMatches",
  chessMatches: "chessMatches",
  leaderboard: "leaderboard",
} as const;

export type DocData = Record<string, unknown>;

export type WhereClause = [field: string, op: FilterOp, value: unknown];
export type FilterOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "array-contains";

export type QuerySpec = {
  where?: WhereClause[];
  orderBy?: [field: string, direction?: "asc" | "desc"][];
  limit?: number;
};

/** Reads must all happen before writes — a hard requirement of the web SDK. */
export interface Tx {
  get<T>(collection: string, id: string): Promise<T | null>;
  set(collection: string, id: string, data: DocData): void;
  update(collection: string, id: string, data: DocData): void;
  delete(collection: string, id: string): void;
}

export interface Store {
  readonly mode: "admin" | "web";
  get<T>(collection: string, id: string): Promise<T | null>;
  list<T>(collection: string, spec?: QuerySpec): Promise<T[]>;
  set(collection: string, id: string, data: DocData): Promise<void>;
  update(collection: string, id: string, data: DocData): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
  count(collection: string, spec?: QuerySpec): Promise<number>;
  runTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/** Public by design — a Firebase web config identifies a project, it does not secure it. */
export const FIREBASE_WEB_CONFIG = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyBw45wO_jzZ7RZYm6UsKSTfl7z7irINSs0",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "my-pro-35d45.firebaseapp.com",
  databaseURL:
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ?? "https://my-pro-35d45-default-rtdb.firebaseio.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "my-pro-35d45",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "my-pro-35d45.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "1046749694292",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:1046749694292:web:c248f7f228fc3e9f0a60c1",
};

/** Strips undefined — Firestore rejects it, and optional fields are everywhere. */
function clean(data: DocData): DocData {
  const out: DocData = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = v;
  return out;
}

/* ------------------------------------------------------------------ */
/* Admin backend                                                       */
/* ------------------------------------------------------------------ */

function serviceAccount(): Record<string, string> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    // Accept raw JSON or base64, since env files dislike newlines.
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON or base64-encoded JSON.");
  }
}

async function createAdminStore(): Promise<Store | null> {
  const credentials = serviceAccount();
  const useAdc = !credentials && Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (!credentials && !useAdc) return null;

  const { initializeApp, getApps, cert, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  const app =
    getApps().find((a) => a.name === "arcade") ??
    initializeApp(
      {
        credential: credentials ? cert(credentials as never) : applicationDefault(),
        projectId: credentials?.project_id ?? FIREBASE_WEB_CONFIG.projectId,
      },
      "arcade",
    );

  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  const applyQuery = (collection: string, spec?: QuerySpec) => {
    let q: FirebaseFirestore.Query = db.collection(collection);
    for (const [field, op, value] of spec?.where ?? []) q = q.where(field, op, value as never);
    for (const [field, dir] of spec?.orderBy ?? []) q = q.orderBy(field, dir ?? "asc");
    if (spec?.limit) q = q.limit(spec.limit);
    return q;
  };

  return {
    mode: "admin",
    async get<T>(collection: string, id: string) {
      const snap = await db.collection(collection).doc(id).get();
      return snap.exists ? ({ id: snap.id, ...snap.data() } as T) : null;
    },
    async list<T>(collection: string, spec?: QuerySpec) {
      const snap = await applyQuery(collection, spec).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
    },
    async set(collection, id, data) {
      await db.collection(collection).doc(id).set(clean(data));
    },
    async update(collection, id, data) {
      await db.collection(collection).doc(id).update(clean(data));
    },
    async remove(collection, id) {
      await db.collection(collection).doc(id).delete();
    },
    async count(collection, spec) {
      const snap = await applyQuery(collection, spec).count().get();
      return snap.data().count;
    },
    async runTx<T>(fn: (tx: Tx) => Promise<T>) {
      return db.runTransaction(async (t) => {
        const wrapper: Tx = {
          async get<R>(collection: string, id: string) {
            const snap = await t.get(db.collection(collection).doc(id));
            return snap.exists ? ({ id: snap.id, ...snap.data() } as R) : null;
          },
          set: (collection, id, data) => void t.set(db.collection(collection).doc(id), clean(data)),
          update: (collection, id, data) => void t.update(db.collection(collection).doc(id), clean(data)),
          delete: (collection, id) => void t.delete(db.collection(collection).doc(id)),
        };
        return fn(wrapper);
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Web backend                                                         */
/* ------------------------------------------------------------------ */

async function createWebStore(): Promise<Store> {
  const { initializeApp, getApps, getApp } = await import("firebase/app");
  const fs = await import("firebase/firestore");

  const app = getApps().length ? getApp() : initializeApp(FIREBASE_WEB_CONFIG);
  const db = fs.getFirestore(app);

  const buildQuery = (collection: string, spec?: QuerySpec) => {
    const constraints: import("firebase/firestore").QueryConstraint[] = [];
    for (const [field, op, value] of spec?.where ?? []) constraints.push(fs.where(field, op, value));
    for (const [field, dir] of spec?.orderBy ?? []) constraints.push(fs.orderBy(field, dir ?? "asc"));
    if (spec?.limit) constraints.push(fs.limit(spec.limit));
    return fs.query(fs.collection(db, collection), ...constraints);
  };

  return {
    mode: "web",
    async get<T>(collection: string, id: string) {
      const snap = await fs.getDoc(fs.doc(db, collection, id));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null;
    },
    async list<T>(collection: string, spec?: QuerySpec) {
      const snap = await fs.getDocs(buildQuery(collection, spec));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
    },
    async set(collection, id, data) {
      await fs.setDoc(fs.doc(db, collection, id), clean(data));
    },
    async update(collection, id, data) {
      await fs.updateDoc(fs.doc(db, collection, id), clean(data));
    },
    async remove(collection, id) {
      await fs.deleteDoc(fs.doc(db, collection, id));
    },
    async count(collection, spec) {
      const snap = await fs.getCountFromServer(buildQuery(collection, spec));
      return snap.data().count;
    },
    async runTx<T>(fn: (tx: Tx) => Promise<T>) {
      return fs.runTransaction(db, async (t) => {
        const wrapper: Tx = {
          async get<R>(collection: string, id: string) {
            const snap = await t.get(fs.doc(db, collection, id));
            return snap.exists() ? ({ id: snap.id, ...snap.data() } as R) : null;
          },
          set: (collection, id, data) => void t.set(fs.doc(db, collection, id), clean(data)),
          update: (collection, id, data) => void t.update(fs.doc(db, collection, id), clean(data)),
          delete: (collection, id) => void t.delete(fs.doc(db, collection, id)),
        };
        return fn(wrapper);
      });
    },
  };
}

/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __arcadeStore?: Promise<Store> };

async function connect(): Promise<Store> {
  const admin = await createAdminStore();
  if (admin) return admin;

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[firestore] No service account found. Falling back to the web SDK, which is subject to " +
        "security rules — set FIREBASE_SERVICE_ACCOUNT before running this for real.",
    );
  }
  return createWebStore();
}

/** The one Firestore handle. Cached across dev reloads. */
export const store = (): Promise<Store> => (g.__arcadeStore ??= connect());
