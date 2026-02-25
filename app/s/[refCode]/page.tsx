import type { Metadata } from "next";
import Link from "next/link";

import { getRequestBaseUrl } from "../../lib/siteUrl";
import ShareActions from "./share-actions";
import RefCapture from "./ref-capture";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ refCode: string }>;
};

function safeRef(refCode: string) {
  const v = (refCode ?? "").trim();
  return encodeURIComponent(v);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { refCode } = await params;
  const base = getRequestBaseUrl();
  const safe = safeRef(refCode);

  const url = `${base}/s/${safe}`;
  const image = `${url}/opengraph-image`;

  const title = "Viora: Personal Analysis | VIP Pilot";
  const description =
    "Zdieľaj → odomkneš bonus. Pozvi 1 → 1 doplnok. Pozvi 3 → upgrade. Pilot reťazenie odomyká trial.";

  return {
    metadataBase: new URL(base),
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url,
      images: [{ url: image, width: 1200, height: 630, alt: "Viora VIP Pilot" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function ShareLanding({ params }: PageProps) {
  const { refCode } = await params;
  const safe = safeRef(refCode);

  const refUrl = `/s/${safe}`;
  const continueUrl = `/profile?ref=${safe}`;

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <RefCapture refCode={refCode} />

      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>VIP Pilot</h1>
      <p style={{ opacity: 0.85, marginBottom: 18 }}>
        Pomôž pilotu rásť a odomykaj bonusy. Ľudia len kliknú a zadajú email.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <Link
          href={continueUrl}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "#111827",
            color: "white",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Otvoriť Viora
        </Link>

        <a
          href={refUrl}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Zobraziť link
        </a>
      </div>

      <ShareActions refUrl={refUrl} />

      <div style={{ marginTop: 24, opacity: 0.9 }}>
        <ul>
          <li>Pozvi 1 → odomkneš 1 doplnok</li>
          <li>Pozvi 3 → upgrade obsahu</li>
          <li>Keď 3 tvoji ľudia dosiahnu Pilot → trial plného obsahu na čas</li>
        </ul>
      </div>
    </main>
  );
}