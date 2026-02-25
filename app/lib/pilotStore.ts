import { kv } from "@vercel/kv";
import { modules, type ModuleSlug } from "./modules";

export type PilotEntitlements = {
  email: string;
  refCode: string;
  referredBy?: string;
  directInvites: number;
  pilotInvites: number;
  isPilot: boolean;
  trialUntil?: number;
  unlockedAddons: ModuleSlug[];
  canClaimAddon: boolean;
  claimedAddon?: ModuleSlug;
};

type PilotUserRecord = {
  email: string;
  createdAt: number;
  refCode: string;
  referredBy?: string;
  claimedAddon?: ModuleSlug;
  trialUntil?: number;
};

const USERS_SET = "viora:users";
const userKey = (email: string) => `viora:user:${email}`;
const codeKey = (code: string) => `viora:code:${code}`;
const referralsKey = (code: string) => `viora:referrals:${code}`;

const paidModules: ModuleSlug[] = modules.filter((m) => !m.isFree).map((m) => m.slug);

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);


const ensureStorageConfigured = () => {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("storage_not_configured");
  }
};

const sanitizeReferredBy = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") {
    return null;
  }
  return trimmed;
};
const randomCode = () => {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no confusing chars
  let out = "";
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
};

async function ensureUniqueCode(email: string): Promise<string> {
  // Try a few times, collisions are basically fantasy at pilot scale.
  for (let i = 0; i < 10; i += 1) {
    const code = randomCode();
    const existing = await kv.get<string>(codeKey(code));
    if (!existing) {
      await kv.set(codeKey(code), email);
      return code;
    }
  }
  // If the universe hates us, use timestamp fallback.
  const code = `${randomCode()}${Date.now().toString(36).slice(-4)}`;
  await kv.set(codeKey(code), email);
  return code;
}

async function getUser(email: string): Promise<PilotUserRecord | null> {
  return (await kv.get<PilotUserRecord>(userKey(email))) ?? null;
}

async function saveUser(user: PilotUserRecord) {
  await kv.set(userKey(user.email), user);
  await kv.sadd(USERS_SET, user.email);
}

async function getDirectInvites(code: string) {
  const n = await kv.scard(referralsKey(code));
  return typeof n === "number" ? n : Number(n || 0);
}

async function getPilotInvites(code: string) {
  const members = (await kv.smembers(referralsKey(code))) as string[];
  if (!Array.isArray(members) || members.length === 0) return 0;

  // Pilot = has at least 3 direct invites.
  let pilotCount = 0;
  for (const email of members.slice(0, 200)) {
    const u = await getUser(email);
    if (!u) continue;
    const d = await getDirectInvites(u.refCode);
    if (d >= 3) pilotCount += 1;
  }
  return pilotCount;
}

function computeUnlockedAddons(directInvites: number, claimedAddon?: ModuleSlug): { unlocked: ModuleSlug[]; canClaim: boolean } {
  if (directInvites >= 3) {
    return { unlocked: paidModules, canClaim: false };
  }
  if (directInvites >= 1) {
    return { unlocked: claimedAddon ? [claimedAddon] : [], canClaim: !claimedAddon };
  }
  return { unlocked: [], canClaim: false };
}

export async function joinPilot(opts: { email: string; referredBy?: string | null }): Promise<PilotEntitlements> {
  ensureStorageConfigured();
  const email = normalizeEmail(opts.email);
  if (!email || !isEmail(email)) throw new Error("Invalid email");

  let user = await getUser(email);

  if (!user) {
    const code = await ensureUniqueCode(email);
    user = { email, createdAt: Date.now(), refCode: code };
  }

  // Only set referredBy once.
  const referredBy = sanitizeReferredBy(opts.referredBy);
  if (referredBy && !user.referredBy) {
    user.referredBy = referredBy;
    // Add this email as a referral to the inviter.
    await kv.sadd(referralsKey(referredBy), email);
  }

  await saveUser(user);

  return getEntitlements(email);
}

export async function claimAddon(opts: { email: string; addon: ModuleSlug }): Promise<PilotEntitlements> {
  ensureStorageConfigured();
  const email = normalizeEmail(opts.email);
  const addon = opts.addon;
  if (!paidModules.includes(addon)) throw new Error("Invalid addon");

  const user = await getUser(email);
  if (!user) throw new Error("User not found");

  const direct = await getDirectInvites(user.refCode);
  if (direct < 1) throw new Error("Not eligible");
  if (direct >= 3) throw new Error("Already upgraded");
  if (user.claimedAddon) throw new Error("Already claimed");

  user.claimedAddon = addon;
  await saveUser(user);

  return getEntitlements(email);
}

export async function getEntitlements(emailRaw: string): Promise<PilotEntitlements> {
  ensureStorageConfigured();
  const email = normalizeEmail(emailRaw);
  const user = await getUser(email);
  if (!user) throw new Error("User not found");

  const directInvites = await getDirectInvites(user.refCode);
  const pilotInvites = await getPilotInvites(user.refCode);
  const isPilot = directInvites >= 3;

  const now = Date.now();
  let trialUntil = user.trialUntil;

  // Rule: if 3 of your direct invites reach pilot (3 invites each), you get full trial.
  if (pilotInvites >= 3) {
    const nextTrial = now + 7 * 24 * 60 * 60 * 1000; // 7 days
    if (!trialUntil || trialUntil < now) {
      trialUntil = nextTrial;
      user.trialUntil = trialUntil;
      await saveUser(user);
    }
  }

  const { unlocked, canClaim } = computeUnlockedAddons(directInvites, user.claimedAddon);

  return {
    email,
    refCode: user.refCode,
    referredBy: user.referredBy,
    directInvites,
    pilotInvites,
    isPilot,
    trialUntil,
    unlockedAddons: unlocked,
    canClaimAddon: canClaim,
    claimedAddon: user.claimedAddon,
  };
}

export async function listPilotUsers(): Promise<PilotEntitlements[]> {
  ensureStorageConfigured();
  const emails = (await kv.smembers(USERS_SET)) as string[];
  if (!Array.isArray(emails) || emails.length === 0) return [];

  const out: PilotEntitlements[] = [];
  for (const email of emails.slice(0, 500)) {
    try {
      out.push(await getEntitlements(email));
    } catch {
      // ignore
    }
  }
  // newest-ish first
  out.sort((a, b) => (b.trialUntil ?? 0) - (a.trialUntil ?? 0));
  return out;
}
