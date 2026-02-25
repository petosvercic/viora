import { NextResponse } from "next/server";
import { joinPilot } from "../../../lib/pilotStore";

type Body = { email?: string; name?: string | null; referredBy?: string | null };

const sanitizeReferredBy = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") {
    return null;
  }
  return trimmed;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const email = String(body?.email || "");
    const sanitizedReferredBy = sanitizeReferredBy(body?.referredBy);

    if (typeof body?.referredBy === "string" && sanitizedReferredBy === null) {
      console.warn("[pilot/join] rejected referredBy value", { referredBy: body.referredBy });
    }

    const data = await joinPilot({ email, referredBy: sanitizedReferredBy });
    return NextResponse.json({ ok: true, data });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Join failed" }, { status: 400 });
  }
}
