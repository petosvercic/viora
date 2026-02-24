import { questions, type OptionLabel } from "./decisionModel";
import { modulesBySlug, type ModuleSlug } from "./modules";

export type ProfileMode = "quiz" | "freeResult" | "premiumResult" | "tuning" | "changeTool" | "premiumHub";

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
    mode?: ProfileMode;
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

const PREMIUM_SCENES: ProfileMode[] = ["premiumResult", "tuning", "changeTool", "premiumHub"];

const isProfileMode = (value: unknown): value is ProfileMode =>
  value === "quiz" || value === "freeResult" || value === "premiumResult" || value === "tuning" || value === "changeTool" || value === "premiumHub";

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

export const getAnsweredCount = (state: VioraStateV1): number => Object.keys(state.base.answers ?? {}).length;

export const isQuizComplete = (state: VioraStateV1): boolean => getAnsweredCount(state) >= questions.length;

export const sanitizeVioraState = (value: Partial<VioraStateV1> | null | undefined): VioraStateV1 => {
  const raw = value ?? {};
  const tuningChoices = Array.isArray(raw.tuning?.choices) ? raw.tuning.choices.filter((item): item is string => typeof item === "string").slice(0, 2) : [];
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
      choices: tuningDone ? tuningChoices : [],
    },
    ui: {
      mode: isProfileMode(raw.ui?.mode) ? raw.ui.mode : undefined,
      lastMode: isProfileMode(raw.ui?.lastMode) ? raw.ui.lastMode : undefined,
      lastSelectedModule: isModuleSlug(raw.ui?.lastSelectedModule) ? raw.ui.lastSelectedModule : undefined,
    },
  };
};

export const deriveProfileMode = (state: VioraStateV1): ProfileMode => {
  if (!isQuizComplete(state)) return "quiz";
  if (!state.unlocks.full) return "freeResult";
  if (!state.tuning.done) return "premiumResult";

  const preferred = state.ui.mode;
  if (preferred && PREMIUM_SCENES.includes(preferred)) return preferred;
  return "premiumHub";
};

export const canTransitionMode = (state: VioraStateV1, target: ProfileMode): boolean => {
  const current = deriveProfileMode(state);
  if (target === current) return true;
  if (target === "quiz") return !isQuizComplete(state);
  if (target === "freeResult") return isQuizComplete(state) && !state.unlocks.full;
  if (!state.unlocks.full) return false;
  if (target === "premiumResult") return true;
  if (target === "tuning") return true;
  if (target === "changeTool" || target === "premiumHub") return state.tuning.done === true;
  return false;
};

export const withMode = (state: VioraStateV1, target: ProfileMode): VioraStateV1 => {
  if (!canTransitionMode(state, target)) return state;
  return patchVioraState(state, { ui: { ...state.ui, mode: target, lastMode: target } });
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

export const patchVioraState = (prev: VioraStateV1, patch: Partial<VioraStateV1>): VioraStateV1 =>
  sanitizeVioraState({
    ...prev,
    ...patch,
    identity: { ...prev.identity, ...patch.identity },
    base: { ...prev.base, ...patch.base },
    unlocks: { ...prev.unlocks, ...patch.unlocks },
    tuning: { ...prev.tuning, ...patch.tuning },
    ui: { ...prev.ui, ...patch.ui },
  });

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
