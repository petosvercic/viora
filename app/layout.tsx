import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viora",
  description: "Behaviorálny profil generovaný pomocou AI analýzy tvojich odpovedí.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sk">
      <body>{children}</body>
    </html>
  );
}
