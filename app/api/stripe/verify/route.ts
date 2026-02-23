import { NextResponse } from "next/server";
import { getStripe } from "../../../lib/stripe";

type VerifyBody = {
  sessionId?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as VerifyBody;
    const sessionId = String(body?.sessionId || "");

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return NextResponse.json({ ok: false });
    }

    const kind = session.metadata?.kind === "addon" ? "addon" : session.metadata?.kind === "full" ? "full" : null;
    const moduleSlug = typeof session.metadata?.moduleSlug === "string" ? session.metadata.moduleSlug : undefined;

    if (!kind) {
      return NextResponse.json({ ok: false });
    }

    return NextResponse.json({ ok: true, kind, moduleSlug });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Stripe verify failed" }, { status: 500 });
  }
}
