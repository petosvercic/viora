import { NextResponse } from "next/server";
import { claimAddon } from "../../../lib/pilotStore";
import type { ModuleSlug } from "../../../lib/modules";

type Body = { email?: string; addon?: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const email = String(body?.email || "");
    const addon = String(body?.addon || "") as ModuleSlug;
    const data = await claimAddon({ email, addon });
    return NextResponse.json({ ok: true, data });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Claim failed" }, { status: 400 });
  }
}
