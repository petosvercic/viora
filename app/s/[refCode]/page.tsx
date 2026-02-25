import type { Metadata } from "next";

import Image from "next/image";
import Link from "next/link";

import { getRequestBaseUrl } from "../../lib/siteUrl";
import ShareActions from "./share-actions";

export const dynamic = "force-dynamic";


type PageProps = {
  params: { refCode: string };
};

const OG_DESCRIPTION = "Pozvi 1 → odomkneš 1 doplnok. Pozvi 3 → upgrade (všetky doplnky). 3 tvoji ľudia dosiahnu Pilot (pozvú 3) → skúšobne celý obsah.";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const base = getRequestBaseUrl();
  const safe = encodeURIComponent(params.refCode);
  const url = `${base}/s/${safe}`;
  const image = `${url}/opengraph-image`;

  return {
    title: "VIP Pilot",
    description: OG_DESCRIPTION,
    openGraph: {
      title: "Viora: Personal Analysis | VIP Pilot",
      description: OG_DESCRIPTION,
      type: "website",
      url,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: "Viora: Personal Analysis | VIP Pilot",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Viora: Personal Analysis | VIP Pilot",
      description: OG_DESCRIPTION,
      images: [image],
    },
  };
}

export default function ShareLanding({ params }: PageProps) {
  const safe = encodeURIComponent(params.refCode);
  const refUrl = `/s/${safe}`;
  const continueUrl = `/profile?ref=${safe}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="inline-flex items-center gap-3" aria-label="Viora domov">
          <Image src="/brand/logo.png" alt="Viora" width={120} height={36} priority className="h-9 w-auto" />
          <span className="rounded-full bg-slate-900/90 px-3 py-1 text-xs font-semibold tracking-wide text-white">VIP Pilot</span>
        </Link>
        <Link
          href={continueUrl}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
        >
          Otvoriť Viora
        </Link>
      </header>

      <section className="mt-10 rounded-3xl border border-slate-200 bg-white/85 p-8 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Viora: Personal Analysis</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">Odomkni bonusy. Stačí zdieľať. ✨</h1>
        <p className="mt-3 text-base leading-relaxed text-slate-700">{OG_DESCRIPTION}</p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">1) Zdieľaj</p>
            <p className="mt-1 text-sm text-slate-600">Tvoj link prinesie prvého človeka → 1 doplnok.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">2) Pozvi 3</p>
            <p className="mt-1 text-sm text-slate-600">Upgrade: všetky doplnky.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">3) 3× Pilot</p>
            <p className="mt-1 text-sm text-slate-600">Ak 3 tvoji ľudia pozvú 3 → skúšobne celý obsah.</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">
            <span className="font-semibold">Pilot pravidlo:</span> stačí, že pozvaný človek otvorí Viora a zadá e-mail. (Žiadne citlivé dáta v poste.)
          </p>
          <p className="mt-2 text-xs text-slate-500">Je to test šírenia. Odmeny sa môžu počas pilotu meniť. 👌</p>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href={continueUrl}
            className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
          >
            Pokračovať vo Viora
          </Link>
          <ShareActions refUrl={refUrl} fullContinueUrl={continueUrl} />
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Pozn.: Toto je pilot. VIP odomknutia sú súčasťou testu a môžu sa meniť.
        </p>
      </section>

      <footer className="mt-auto pt-10 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Viora
      </footer>
    </main>
  );
}
