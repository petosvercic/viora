/**
 * Absolute site origin (no trailing slash).
 * Build-safe for Next.js/Turbopack: do not rely on next/headers (async in newer Next).
 */
function normalizeOrigin(input?: string): string {
  let s = (input ?? "").trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, "");
}

/**
 * Prefer explicit site URL (prod), otherwise use Vercel URL (preview/prod),
 * fallback to localhost for dev.
 */
export function getEnvBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
  if (explicit) return normalizeOrigin(explicit);

  const vercel = process.env.VERCEL_URL;
  if (vercel) return normalizeOrigin(vercel);

  return "http://localhost:3000";
}

/**
 * Previously this might have depended on request headers.
 * For build-safety, map it to env-based origin.
 */
export function getRequestBaseUrl(): string {
  return getEnvBaseUrl();
}

/** Backwards-compatible alias */
export function siteUrl(): string {
  return getEnvBaseUrl();
}
