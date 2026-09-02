import "server-only";
import { COLLECTIONS, store, type Tx } from "./firestore";
import { newId } from "./ids";
import { nowMs } from "./clock";

/**
 * Simulated KYC / age / geo checks.
 *
 * These are the gates a staking product actually needs, implemented against a
 * fake vendor so the whole flow is playable today. Swap `runVendorCheck` for a
 * real provider (Persona, Onfido, Veriff…) and nothing above this file changes.
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
  constructor(
    message: string,
    readonly status = 403,
  ) {
    super(message);
  }
}

const blank = (userId: string): ComplianceRecord => ({
  userId,
  kycStatus: "unverified",
  legalName: null,
  dateOfBirth: null,
  country: null,
  region: null,
  reviewedAt: null,
});

export async function getCompliance(userId: string): Promise<ComplianceRecord> {
  const db = await store();
  const doc = await db.get<ComplianceRecord>(COLLECTIONS.compliance, userId);
  return doc ? { ...blank(userId), ...doc, userId } : blank(userId);
}

export function ageFrom(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return Number.NaN;
  const now = new Date(nowMs());
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

export type VendorResult = { status: KycStatus; reason?: string; ref: string };

/**
 * The simulated vendor: approves anyone of age from an allowed region.
 * Use "REJECT" as the legal name to exercise the rejection path.
 */
export function runVendorCheck(input: VerifyInput): VendorResult {
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

export function complianceDoc(input: VerifyInput, result: VendorResult) {
  const at = nowMs();
  return {
    kycStatus: result.status,
    legalName: input.legalName.trim(),
    dateOfBirth: input.dateOfBirth,
    country: input.country.trim().toUpperCase(),
    region: input.region?.trim().toUpperCase() ?? null,
    providerRef: result.ref,
    reviewedAt: at,
    updatedAt: at,
  };
}

/** Writes a verification result inside an existing transaction. */
export function writeCompliance(tx: Tx, userId: string, input: VerifyInput, result: VendorResult) {
  tx.set(COLLECTIONS.compliance, userId, complianceDoc(input, result));
}

export async function submitVerification(
  userId: string,
  input: VerifyInput,
): Promise<ComplianceRecord & { reason?: string }> {
  if (!input.legalName?.trim()) throw new ComplianceError("Enter the name on your ID.", 400);
  if (!input.dateOfBirth) throw new ComplianceError("Enter your date of birth.", 400);
  if (!input.country?.trim()) throw new ComplianceError("Select your country.", 400);

  const result = runVendorCheck(input);
  const db = await store();
  await db.set(COLLECTIONS.compliance, userId, complianceDoc(input, result));

  return { ...(await getCompliance(userId)), reason: result.reason };
}

/** Throws unless this player is cleared to put `stakeCents` at risk. */
export async function assertCanStake(userId: string, stakeCents: number) {
  if (stakeCents < KYC_THRESHOLD_CENTS) return;
  const record = await getCompliance(userId);
  if (record.kycStatus === "verified") return;
  if (record.kycStatus === "rejected") {
    throw new ComplianceError("Your identity check was declined, so you can't stake at this level.");
  }
  throw new ComplianceError(
    `Stakes of ${(KYC_THRESHOLD_CENTS / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    })} or more need a verified identity.`,
  );
}
