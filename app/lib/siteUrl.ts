/**
 * Absolute site origin (no trailing slash).
 * Build-safe for Next.js/Turbopack: no next/headers usage.
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

  const vercel = process.env.VERCEL_URL; // e.g. "my-app-git-branch-xxx.vercel.app"
  if (vercel) return normalizeOrigin(vercel);

  return "http://localhost:3000";
}

/**
 * Previously this may have depended on request headers.
 * For build-safety, we map it to env-based origin (good enough on Vercel).
 */
export function getRequestBaseUrl(): string {
  return getEnvBaseUrl();
}

/** Backwards-compatible alias */
export function siteUrl(): string {
  return getEnvBaseUrl();
}
