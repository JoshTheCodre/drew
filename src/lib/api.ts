import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { WalletError } from "./wallet";
import { ComplianceError } from "./compliance";
import { PaymentError } from "./payments";
import { GameError } from "./games/price-prediction/engine";
import { DuelError } from "./games/wordle-duel/engine";

export const json = <T>(data: T, init?: ResponseInit) => NextResponse.json(data, init);

const KNOWN = [AuthError, WalletError, ComplianceError, PaymentError, GameError, DuelError];

/** Turns known domain errors into clean JSON responses. */
export function fail(error: unknown) {
  if (KNOWN.some((E) => error instanceof E)) {
    const e = error as Error & { status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 400 });
  }
  console.error("[api]", error);
  return NextResponse.json({ error: "Something went wrong on our end." }, { status: 500 });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
