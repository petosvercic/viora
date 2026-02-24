import { modulesBySlug, type ModuleSlug } from "./modules";
import type { OptionLabel } from "./decisionModel";

export type ProfileMode = "quiz" | "results" | "premiumHub" | "tuning" | "deep";

export type VioraStateV1 = {
  version: 1;
  identity: {
    email?: string;
    name?: string;
    consent?: boolean;
  };
  base: {
    answers?: Record<number, OptionLabel>;
    computedAt?: number;
  };
  unlocks: {
    full?: boolean;
    addons?: ModuleSlug[];
    included?: ModuleSlug[];
  };
  tuning: {
    done?: boolean;
    choices?: string[];
  };
  ui: {
    lastMode?: ProfileMode;
    lastSelectedModule?: ModuleSlug;
  };
};

const LS_STATE = "viora_state_v1";
const LS_LAST_BASE_ANSWERS = "viora_last_base_answers";
const LS_LAST_RUN_AT = "viora_last_run_at";
const LS_UNLOCKED_FULL = "viora_unlocked_full";
const LS_UNLOCKED_ADDONS = "viora_unlocked_addons";
const LS_EMAIL = "viora_email";
const LS_NAME = "viora_name";
const LS_CONSENT = "viora_consent";
const LS_INCLUDED_MODULES = "viora_included_modules";
const LS_TUNING_CHOICES = "viora_tuning_choices";
const LS_TUNING_DONE = "viora_tuning_done";

const isModuleSlug = (value: unknown): value is ModuleSlug => typeof value === "string" && value in modulesBySlug;

const normalizeModuleList = (value: unknown, limit?: number): ModuleSlug[] => {
  if (!Array.isArray(value)) return [];
  const deduped = Array.from(new Set(value.filter(isModuleSlug)));
  return typeof limit === "number" ? deduped.slice(0, limit) : deduped;
};

const normalizeAnswers = (value: unknown): Record<number, OptionLabel> | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const next: Record<number, OptionLabel> = {};
  for (const [key, option] of Object.entries(value as Record<string, unknown>)) {
    const idx = Number(key);
    if (!Number.isFinite(idx)) continue;
    if (option === "A" || option === "B" || option === "C") next[idx] = option;
  }
  return Object.keys(next).length ? next : undefined;
};

export const sanitizeVioraState = (value: Partial<VioraStateV1> | null | undefined): VioraStateV1 => {
  const raw = value ?? {};
  const tuningChoices = Array.isArray(raw.tuning?.choices) ? raw.tuning.choices.filter((item): item is string => typeof item === "string") : [];
  const tuningDone = raw.tuning?.done === true || tuningChoices.length > 0;

  return {
    version: 1,
    identity: {
      email: typeof raw.identity?.email === "string" ? raw.identity.email : undefined,
      name: typeof raw.identity?.name === "string" ? raw.identity.name : undefined,
      consent: raw.identity?.consent === true,
    },
    base: {
      answers: normalizeAnswers(raw.base?.answers),
      computedAt: typeof raw.base?.computedAt === "number" ? raw.base.computedAt : undefined,
    },
    unlocks: {
      full: raw.unlocks?.full === true,
      addons: normalizeModuleList(raw.unlocks?.addons),
      included: normalizeModuleList(raw.unlocks?.included, 2),
    },
    tuning: {
      done: tuningDone,
      choices: tuningDone ? tuningChoices.slice(0, 2) : [],
    },
    ui: {
      lastMode: raw.ui?.lastMode,
      lastSelectedModule: isModuleSlug(raw.ui?.lastSelectedModule) ? raw.ui?.lastSelectedModule : undefined,
    },
  };
};

export const loadVioraState = (): VioraStateV1 => {
  try {
    const rawCurrent = localStorage.getItem(LS_STATE);
    if (rawCurrent) {
      return sanitizeVioraState(JSON.parse(rawCurrent) as Partial<VioraStateV1>);
    }
  } catch {}

  const migrated = migrateLegacyState();
  saveVioraState(migrated);
  return migrated;
};

export const saveVioraState = (state: VioraStateV1) => {
  localStorage.setItem(LS_STATE, JSON.stringify(sanitizeVioraState(state)));
};

export const patchVioraState = (prev: VioraStateV1, patch: Partial<VioraStateV1>): VioraStateV1 => {
  return sanitizeVioraState({
    ...prev,
    ...patch,
    identity: { ...prev.identity, ...patch.identity },
    base: { ...prev.base, ...patch.base },
    unlocks: { ...prev.unlocks, ...patch.unlocks },
    tuning: { ...prev.tuning, ...patch.tuning },
    ui: { ...prev.ui, ...patch.ui },
  });
};

export const deriveProfileMode = (state: VioraStateV1): ProfileMode => {
  const hasBaseResults = Boolean(state.base.answers && Object.keys(state.base.answers).length > 0);
  if (!hasBaseResults) return "quiz";
  if (!state.unlocks.full) return "results";
  if (state.tuning.done) return "deep";
  return state.unlocks.included && state.unlocks.included.length > 0 ? "tuning" : "premiumHub";
};

const migrateLegacyState = (): VioraStateV1 => {
  let answers: Record<number, OptionLabel> | undefined;
  let computedAt: number | undefined;
  let full = false;
  let addons: ModuleSlug[] = [];
  let included: ModuleSlug[] = [];
  let tuningChoices: string[] = [];
  let tuningDone = false;
  let email: string | undefined;
  let name: string | undefined;
  let consent = false;

  try {
    answers = normalizeAnswers(JSON.parse(localStorage.getItem(LS_LAST_BASE_ANSWERS) || "null"));
  } catch {}
  try {
    const ts = Number(localStorage.getItem(LS_LAST_RUN_AT) || "0");
    computedAt = Number.isFinite(ts) && ts > 0 ? ts : undefined;
  } catch {}

  full = localStorage.getItem(LS_UNLOCKED_FULL) === "true";

  try {
    addons = normalizeModuleList(JSON.parse(localStorage.getItem(LS_UNLOCKED_ADDONS) || "[]"));
  } catch {}
  try {
    included = normalizeModuleList(JSON.parse(localStorage.getItem(LS_INCLUDED_MODULES) || "[]"), 2);
  } catch {}
  try {
    const rawChoices = JSON.parse(localStorage.getItem(LS_TUNING_CHOICES) || "[]");
    if (Array.isArray(rawChoices)) tuningChoices = rawChoices.filter((item): item is string => typeof item === "string").slice(0, 2);
  } catch {}

  tuningDone = localStorage.getItem(LS_TUNING_DONE) === "true" || tuningChoices.length > 0;

  const rawEmail = localStorage.getItem(LS_EMAIL);
  if (typeof rawEmail === "string" && rawEmail.trim()) email = rawEmail.trim();
  const rawName = localStorage.getItem(LS_NAME);
  if (typeof rawName === "string" && rawName.trim()) name = rawName.trim();
  consent = localStorage.getItem(LS_CONSENT) === "true";

  return sanitizeVioraState({
    version: 1,
    identity: { email, name, consent },
    base: { answers, computedAt },
    unlocks: { full, addons, included },
    tuning: { done: tuningDone, choices: tuningChoices },
    ui: {},
  });
};
