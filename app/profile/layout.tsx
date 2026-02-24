import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://viora.app"),
  title: "Viora Profile",
  description: "Viora Profile: rozhodovanie v 1 vete + plán na 7 dní.",
  openGraph: {
    title: "Viora Profile",
    description: "Rozhodovací podpis, hlboká analýza a 7-dňový plán zmeny.",
    images: ["/brand/bg.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Viora Profile",
    description: "Rozhodovací podpis, hlboká analýza a 7-dňový plán zmeny.",
    images: ["/brand/bg.png"],
  },
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
