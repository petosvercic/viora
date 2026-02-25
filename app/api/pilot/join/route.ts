import { NextResponse } from "next/server";
import { joinPilot } from "../../../lib/pilotStore";

type Body = { email?: string; referredBy?: string | null };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const email = String(body?.email || "");
    const referredBy = typeof body?.referredBy === "string" ? body.referredBy : null;
    const data = await joinPilot({ email, referredBy });
    return NextResponse.json({ ok: true, data });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Join failed" }, { status: 400 });
  }
}
