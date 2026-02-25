/**
 * Absolute site origin (no trailing slash).
 * Compatible with Next.js where headers() is async by avoiding next/headers.
 */
function normalizeOrigin(input: string): string {
  let s = (input ?? "").trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, "");
}

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
  if (explicit) return normalizeOrigin(explicit);

  const vercel = process.env.VERCEL_URL; // Vercel sets this for prod + previews
  if (vercel) return normalizeOrigin(vercel);

  return "http://localhost:3000";
}
