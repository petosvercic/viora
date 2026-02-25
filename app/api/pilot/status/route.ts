export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getEntitlements } from "../../../lib/pilotStore";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const email = url.searchParams.get("email") || "";
    const data = await getEntitlements(email);
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Status failed" }, { status: 400 });
  }
}
