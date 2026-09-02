import { db } from "./db";
import { newId } from "./ids";

/**
 * Simulated KYC / age / geo checks.
 *
 * These are the real gates a staking product needs, implemented against a fake
 * provider so the whole flow is playable today. Swap `simulatedProvider` for a
 * live vendor (Persona, Onfido, Veriff…) and nothing above this file changes.
 */

export const SIMULATED = (process.env.COMPLIANCE_PROVIDER ?? "simulated") === "simulated";

/** Stakes at or above this need a verified identity on file. */
export const KYC_THRESHOLD_CENTS = Number(process.env.KYC_THRESHOLD_CENTS ?? 10_000);

export const MIN_AGE = 18;

/** Regions a real operator would have to exclude without a local licence. */
const BLOCKED_REGIONS = (process.env.BLOCKED_REGIONS ?? "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

export type KycStatus = "unverified" | "pending" | "verified" | "rejected";

export type ComplianceRecord = {
  userId: string;
  kycStatus: KycStatus;
  legalName: string | null;
  dateOfBirth: string | null;
  country: string | null;
  region: string | null;
  reviewedAt: number | null;
};

export class ComplianceError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
  }
}

type ComplianceRow = {
  user_id: string;
  kyc_status: KycStatus;
  legal_name: string | null;
  date_of_birth: string | null;
  country: string | null;
  region: string | null;
  reviewed_at: number | null;
};

export function getCompliance(userId: string): ComplianceRecord {
  const row = db
    .prepare(
      "SELECT user_id, kyc_status, legal_name, date_of_birth, country, region, reviewed_at FROM compliance WHERE user_id = ?",
    )
    .get(userId) as unknown as ComplianceRow | undefined;

  if (!row) {
    db.prepare("INSERT INTO compliance (user_id, kyc_status, updated_at) VALUES (?, 'unverified', ?)").run(
      userId,
      Date.now(),
    );
    return {
      userId,
      kycStatus: "unverified",
      legalName: null,
      dateOfBirth: null,
      country: null,
      region: null,
      reviewedAt: null,
    };
  }

  return {
    userId: row.user_id,
    kycStatus: row.kyc_status,
    legalName: row.legal_name,
    dateOfBirth: row.date_of_birth,
    country: row.country,
    region: row.region,
    reviewedAt: row.reviewed_at,
  };
}

export function ageFrom(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return Number.NaN;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

export type VerifyInput = {
  legalName: string;
  dateOfBirth: string; // YYYY-MM-DD
  country: string;
  region?: string;
};

/**
 * The simulated vendor: approves anyone of age from an allowed region.
 * Type "REJECT" as the legal name to exercise the rejection path.
 */
function simulatedProvider(input: VerifyInput): { status: KycStatus; reason?: string; ref: string } {
  const ref = newId("kyc");

  if (/reject/i.test(input.legalName)) {
    return { status: "rejected", reason: "Identity document could not be validated.", ref };
  }

  const age = ageFrom(input.dateOfBirth);
  if (!Number.isFinite(age)) return { status: "rejected", reason: "That date of birth isn't valid.", ref };
  if (age < MIN_AGE) {
    return { status: "rejected", reason: `You must be at least ${MIN_AGE} to stake.`, ref };
  }

  const region = `${input.country}-${input.region ?? ""}`.toUpperCase();
  if (BLOCKED_REGIONS.some((b) => region.startsWith(b))) {
    return { status: "rejected", reason: "Staking isn't available in your region.", ref };
  }

  return { status: "verified", ref };
}

export function submitVerification(userId: string, input: VerifyInput): ComplianceRecord & { reason?: string } {
  if (!input.legalName?.trim()) throw new ComplianceError("Enter the name on your ID.", 400);
  if (!input.dateOfBirth) throw new ComplianceError("Enter your date of birth.", 400);
  if (!input.country?.trim()) throw new ComplianceError("Select your country.", 400);

  const result = simulatedProvider(input);
  const now = Date.now();

  db.prepare(
    `INSERT INTO compliance (user_id, kyc_status, legal_name, date_of_birth, country, region, provider_ref, reviewed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       kyc_status = excluded.kyc_status,
       legal_name = excluded.legal_name,
       date_of_birth = excluded.date_of_birth,
       country = excluded.country,
       region = excluded.region,
       provider_ref = excluded.provider_ref,
       reviewed_at = excluded.reviewed_at,
       updated_at = excluded.updated_at`,
  ).run(
    userId,
    result.status,
    input.legalName.trim(),
    input.dateOfBirth,
    input.country.trim().toUpperCase(),
    input.region?.trim().toUpperCase() ?? null,
    result.ref,
    now,
    now,
  );

  return { ...getCompliance(userId), reason: result.reason };
}

/** Throws unless this user is cleared to put `stakeCents` at risk. */
export function assertCanStake(userId: string, stakeCents: number) {
  if (stakeCents < KYC_THRESHOLD_CENTS) return;
  const record = getCompliance(userId);
  if (record.kycStatus === "verified") return;
  if (record.kycStatus === "rejected") {
    throw new ComplianceError("Your identity check was declined, so you can't stake at this level.");
  }
  throw new ComplianceError(
    `Stakes of ${(KYC_THRESHOLD_CENTS / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    })} or more need a verified identity. It takes about a minute.`,
  );
}
