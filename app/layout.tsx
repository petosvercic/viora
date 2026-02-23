import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viora",
  description: "Behaviorálny profil generovaný pomocou AI analýzy tvojich odpovedí.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body className="relative min-h-screen bg-slate-50 text-slate-900">
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-20 bg-cover bg-center opacity-[0.14]"
          style={{ backgroundImage: "url('/brand/bg.png')" }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-b from-white/92 via-white/90 to-slate-100/94"
        />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
