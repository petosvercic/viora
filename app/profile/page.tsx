"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { canAccessModule, getModuleStatus } from "../lib/access";
import { scoreAnswers, type OptionLabel, questions } from "../lib/decisionModel";
import { generateModuleAddon } from "../lib/moduleAddonGen";
import { scoreModuleAnswers } from "../lib/moduleScoring";
import { modules, modulesBySlug, type ModuleOptionLabel, type ModuleSlug } from "../lib/modules";
import { resolveVariantsFromIds, selectBaseQuizVariants, slotIds } from "../lib/questionPool";
import { generateFreeReport, generateFullReport } from "../lib/reportGen";
import { generateSynthesisReport } from "../lib/synthesisGen";
import { createNextRunState, deriveProfileMode, ensureBaseRunConfig, getAnsweredCount, loadVioraState, patchVioraState, resetQuizButKeepUnlocks, saveVioraState, type ProfileMode, type VioraStateV1 } from "../lib/vioraState";

type TransitionPhase = "idle" | "transitioning";
type AddonResult = { title: string; insight: string; riskSpot: string; action: string };
type PurchaseIntent = { kind: "full" | "addon"; moduleSlug?: ModuleSlug };

const LS_PREMIUM_PRICE_WARNING = "viora_premium_price_warning";
const LS_PENDING_PURCHASE = "viora_pending_purchase";

const tuningOptions = [
  "Rýchlejšie rozhodovanie",
  "Menej stresu v neistote",
  "Menej zacyklenia na detailoch",
  "Lepšie zvládanie tlaku",
  "Rozumná kontrola",
] as const;

export default function ProfilePage() {
  const [state, setState] = useState<VioraStateV1 | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const [step, setStep] = useState(0);
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>("idle");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [purchaseIntent, setPurchaseIntent] = useState<PurchaseIntent | null>(null);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  const [selectedModule, setSelectedModule] = useState<ModuleSlug | null>(null);
  const [moduleStep, setModuleStep] = useState(0);
  const [moduleAnswers, setModuleAnswers] = useState<Record<number, ModuleOptionLabel>>({});
  const [moduleNotice, setModuleNotice] = useState<string | null>(null);
  const [moduleTransition, setModuleTransition] = useState<TransitionPhase>("idle");
  const [pendingModulePurchase, setPendingModulePurchase] = useState<ModuleSlug | null>(null);
  const [completedAddons, setCompletedAddons] = useState<Partial<Record<ModuleSlug, AddonResult>>>({});

  const unlockRef = useRef<HTMLButtonElement | null>(null);

  const patchState = (patch: Partial<VioraStateV1>) => {
    setState((prev) => {
      const base = prev ?? ensureBaseRunConfig(loadVioraState());
      const next = patchVioraState(base, patch);
      saveVioraState(next);
      return next;
    });
  };

  const answers = state?.base.answers ?? {};
  const seed = state?.base.seed ?? "viora";
  const attempt = state?.base.attempt ?? 0;
  const mode: ProfileMode = state ? deriveProfileMode(state) : "quiz";
  const premiumStep = state?.ui.premiumStep ?? 1;

  const selectedVariants = useMemo(() => {
    const resolved = resolveVariantsFromIds(state?.base.selectedQuestionIds ?? {});
    if (resolved) return resolved;
    return selectBaseQuizVariants(seed, attempt);
  }, [state?.base.selectedQuestionIds, seed, attempt]);

  const currentSlotId = slotIds[Math.min(step, slotIds.length - 1)];
  const currentQuestion = selectedVariants[currentSlotId];
  const progress = ((Math.min(step, questions.length - 1) + 1) / questions.length) * 100;

  const scored = useMemo(() => scoreAnswers(answers), [answers]);
  const freeReport = useMemo(() => generateFreeReport(scored, { seed, runIndex: attempt }), [scored, seed, attempt]);
  const fullReport = useMemo(() => generateFullReport(scored, { seed, runIndex: attempt }), [scored, seed, attempt]);

  const synthesis = useMemo(() => {
    if (!state) return null;
    return generateSynthesisReport({
      profile: scored,
      fullReport,
      included: state.unlocks.included ?? [],
      purchased: state.unlocks.addons ?? [],
      tuningChoices: state.tuning.choices ?? [],
      seed,
      attempt,
    });
  }, [state, scored, fullReport, seed, attempt]);

  const moduleConfig = selectedModule ? modulesBySlug[selectedModule] : null;
  const activeModuleQuestion = moduleConfig ? moduleConfig.questions[moduleStep] : null;

  const copyText = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setShareMessage("Skopírované do schránky ✅");
    } catch {
      setShareMessage("Nepodarilo sa skopírovať text.");
    }
  };

  useEffect(() => {
    const loaded = ensureBaseRunConfig(loadVioraState());
    const withMode = patchVioraState(loaded, { ui: { ...loaded.ui, lastMode: deriveProfileMode(loaded) } });
    saveVioraState(withMode);
    setState(withMode);

    const answered = getAnsweredCount(withMode);
    if (answered > 0) setStep(Math.min(answered - 1, questions.length - 1));

    if (localStorage.getItem(LS_PREMIUM_PRICE_WARNING) === "true") {
      setBillingMessage("0,99 € cena pre Plus modul nie je nakonfigurovaná, použila sa základná cena 2,99 €.");
      localStorage.removeItem(LS_PREMIUM_PRICE_WARNING);
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("canceled") === "1") setBillingMessage("Platba bola zrušená. Môžeš to skúsiť znova.");

    const sessionId = params.get("session_id");
    if (!sessionId) {
      setHydrated(true);
      return;
    }

    const verify = async () => {
      try {
        setIsVerifying(true);
        const res = await fetch("/api/stripe/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json();

        setState((prev) => {
          if (!prev) return prev;
          if (data?.ok && data?.kind === "full") {
            const next = patchVioraState(prev, {
              unlocks: { ...prev.unlocks, full: true },
              ui: { ...prev.ui, lastMode: "premium_steps", premiumStep: 1 },
            });
            saveVioraState(next);
            return next;
          }
          if (data?.ok && data?.kind === "addon" && typeof data?.moduleSlug === "string" && data.moduleSlug in modulesBySlug) {
            const slug = data.moduleSlug as ModuleSlug;
            const next = patchVioraState(prev, {
              unlocks: { ...prev.unlocks, addons: Array.from(new Set([...(prev.unlocks.addons ?? []), slug])) },
            });
            saveVioraState(next);
            return next;
          }
          return prev;
        });

        if (data?.ok && data?.kind === "full") setBillingMessage("Platba prebehla úspešne. Hlbší profil je odomknutý.");
        else if (data?.ok && data?.kind === "addon") setBillingMessage("Platba prebehla úspešne. Modul je odomknutý.");
        else setBillingMessage("Overenie platby sa nepodarilo. Skús obnoviť stránku.");
      } catch {
        setBillingMessage("Overenie platby zlyhalo. Skús to prosím znova.");
      } finally {
        localStorage.removeItem(LS_PENDING_PURCHASE);
        const clean = new URL(window.location.href);
        clean.searchParams.delete("session_id");
        window.history.replaceState({}, "", clean.toString());
        setHydrated(true);
        setIsVerifying(false);
      }
    };

    void verify();
  }, []);

  const openPaymentModal = (intent: PurchaseIntent) => {
    setPurchaseIntent(intent);
    setShowPaymentModal(true);
  };

  const startCheckout = async () => {
    if (!state || !purchaseIntent) return;
    const email = state.identity.email?.trim();
    if (!email) return setBillingMessage("Pred platbou doplň prosím e-mail.");
    if (state.identity.consent !== true) return setBillingMessage("Pred platbou je potrebné potvrdiť súhlas s podmienkami.");

    try {
      setIsPaying(true);
      setBillingMessage(null);
      localStorage.setItem(LS_PENDING_PURCHASE, JSON.stringify({ ...purchaseIntent, timestamp: Date.now() }));
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: purchaseIntent.kind,
          moduleSlug: purchaseIntent.moduleSlug,
          email,
          name: state.identity.name?.trim() ?? "",
          isPremium: purchaseIntent.kind === "addon" ? state.unlocks.full === true : false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) return setBillingMessage(data?.error || "Nepodarilo sa spustiť platbu.");
      if (data?.usedPremiumFallback) localStorage.setItem(LS_PREMIUM_PRICE_WARNING, "true");
      window.location.href = data.url;
    } catch {
      setBillingMessage("Nepodarilo sa spustiť platbu. Skús to prosím znova.");
    } finally {
      setIsPaying(false);
    }
  };

  const onSelect = (label: OptionLabel) => {
    if (!state) return;
    const nextAnswers = { ...answers, [currentSlotId]: label };
    setTransitionPhase("transitioning");

    window.setTimeout(() => {
      if (step >= questions.length - 1) {
        setIsAnalyzing(true);
        const next = patchVioraState(state, {
          base: { ...state.base, answers: nextAnswers, computedAt: Date.now() },
          ui: { ...state.ui, lastMode: state.unlocks.full ? "premium_steps" : "free_results" },
        });
        setState(next);
        saveVioraState(next);
        setTransitionPhase("idle");
        window.setTimeout(() => setIsAnalyzing(false), 2000);
        return;
      }
      const next = patchVioraState(state, { base: { ...state.base, answers: nextAnswers } });
      setState(next);
      saveVioraState(next);
      setStep((v) => v + 1);
      setTransitionPhase("idle");
    }, 420);
  };

  const onTryAgain = () => {
    if (!state) return;
    const next = resetQuizButKeepUnlocks(state);
    setState(next);
    saveVioraState(next);
    setStep(0);
    setSelectedModule(null);
    setModuleAnswers({});
    setModuleStep(0);
    setPendingModulePurchase(null);
    setModuleNotice(null);
  };

  const startModule = (slug: ModuleSlug) => {
    if (!state) return;
    if (!canAccessModule(slug, state)) {
      setPendingModulePurchase(slug);
      setModuleNotice(state.unlocks.full ? "Tento modul ešte nie je odomknutý. Môžeš ho pridať za 0,99 €." : "Tento modul je Plus. Môžeš ho odomknúť za 2,99 € alebo zvoliť hlbší profil.");
      unlockRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setModuleNotice(null);
    setPendingModulePurchase(null);
    setSelectedModule(slug);
    setModuleAnswers({});
    setModuleStep(0);
  };

  const onModuleSelect = (questionId: number, label: ModuleOptionLabel) => {
    if (!selectedModule || !moduleConfig) return;
    const next = { ...moduleAnswers, [questionId]: label };
    setModuleAnswers(next);
    setModuleTransition("transitioning");
    window.setTimeout(() => {
      if (moduleStep >= moduleConfig.questions.length - 1) {
        const scores = scoreModuleAnswers(selectedModule, next);
        const addon = generateModuleAddon(selectedModule, scored, scores);
        setCompletedAddons((prev) => ({ ...prev, [selectedModule]: addon }));
        setModuleTransition("idle");
        return;
      }
      setModuleStep((v) => v + 1);
      setModuleTransition("idle");
    }, 360);
  };

  const renderAddonArea = (isPremium: boolean) => {
    if (!state) return null;
    return (
      <article className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm md:p-8">
        <h2 className="text-xl font-semibold">Rozšíriť podľa kontextu</h2>
        <p className="mt-2 text-slate-600">Vyber si modul pre doplnkový mini-report.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {modules.map((m) => {
            const status = getModuleStatus(m.slug, state);
            return (
              <button key={m.slug} type="button" onClick={() => startModule(m.slug)} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-400">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="font-medium text-slate-900">{m.title}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status === "free" || status === "included" ? "bg-emerald-100 text-emerald-700" : status === "purchased" ? "bg-sky-100 text-sky-700" : "bg-slate-200 text-slate-700"}`}>
                    {status === "free" ? "Skús zdarma" : status === "included" ? "V cene" : status === "purchased" ? "Odomknuté" : "Plus"}
                  </span>
                </div>
                <p className="text-sm text-slate-600">{m.description}</p>
              </button>
            );
          })}
        </div>

        {moduleNotice && <p className="mt-4 text-sm text-amber-700">{moduleNotice}</p>}

        {pendingModulePurchase && !canAccessModule(pendingModulePurchase, state) && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => openPaymentModal({ kind: "addon", moduleSlug: pendingModulePurchase })} className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">
              {isPremium ? "Pridať za 0,99 €" : "Odomknúť za 2,99 €"}
            </button>
            {!isPremium && (
              <button type="button" onClick={() => openPaymentModal({ kind: "full" })} className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Chcem hlbší profil</button>
            )}
          </div>
        )}

        {selectedModule && moduleConfig && !completedAddons[selectedModule] && activeModuleQuestion && (
          <div className={`mt-8 rounded-xl border border-slate-200 p-5 ${moduleTransition === "transitioning" ? "opacity-70" : "opacity-100"}`}>
            <p className="text-sm text-slate-500">{moduleConfig.title} · Otázka {moduleStep + 1} / {moduleConfig.questions.length}</p>
            <h3 className="mt-3 text-lg font-semibold">{activeModuleQuestion.question}</h3>
            <div className="mt-4 grid gap-3">
              {activeModuleQuestion.options.map((option) => (
                <button key={option.label} type="button" onClick={() => onModuleSelect(activeModuleQuestion.id, option.label)} className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-400">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Možnosť {option.label}</p>
                  <p className="mt-1 text-slate-900">{option.text}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {Object.entries(completedAddons).length > 0 && (
          <div className="mt-8 space-y-4">
            {Object.entries(completedAddons).map(([slug, addon]) => {
              if (!addon) return null;
              return (
                <div key={slug} className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{modulesBySlug[slug as ModuleSlug].title}</p>
                  <h3 className="mt-1 text-lg font-semibold">{addon.title}</h3>
                  <p className="mt-2 text-sm text-slate-700">{addon.insight}</p>
                </div>
              );
            })}
          </div>
        )}
      </article>
    );
  };

  if (!hydrated || isVerifying || !state) {
    return (
      <main className="relative min-h-screen">
        <div className="fixed inset-0 bg-slate-950/55" />
        <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
          <div className="space-y-6 rounded-2xl border border-slate-200 bg-white/90 px-10 py-10 text-center shadow-sm">
            <div className="mx-auto h-9 w-9 animate-pulse rounded-full border-2 border-slate-300 border-t-slate-700" />
            <h1 className="text-2xl font-semibold">Načítavame tvoj profil…</h1>
          </div>
        </div>

      </main>
    );
  }

  if (mode === "quiz" || isAnalyzing) {
    return (
      <main className="relative min-h-screen">
        <div className="fixed inset-0 bg-slate-950/55" />
        <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
          {isAnalyzing ? (
            <div className="space-y-6 rounded-2xl border border-slate-200 bg-white/90 px-10 py-10 text-center shadow-sm">
              <div className="mx-auto h-9 w-9 animate-pulse rounded-full border-2 border-slate-300 border-t-slate-700" />
              <h1 className="text-2xl font-semibold">Analyzujeme tvoje odpovede…</h1>
              <p className="text-slate-600">Ešte chvíľu, skladáme tvoj profil do jasného obrazu.</p>
            </div>
          ) : (
            <div className={`w-full max-w-2xl rounded-3xl border border-white/20 bg-white/92 p-7 shadow-2xl backdrop-blur-md transition-all duration-500 md:p-10 ${transitionPhase === "transitioning" ? "scale-[0.99] opacity-70" : "scale-100 opacity-100"}`}>
              <div className="mb-7 space-y-3">
                <p className="text-sm font-medium text-slate-500">Otázka {step + 1} / {questions.length}</p>
                <div className="h-1.5 w-full rounded-full bg-slate-200"><div className="h-full rounded-full bg-slate-900 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
              </div>
              <h1 className="text-2xl font-semibold leading-snug text-slate-900 md:text-3xl">{currentQuestion.question}</h1>
              <div className="mt-7 grid gap-4">
                {currentQuestion.options.map((option) => (
                  <button key={option.label} type="button" onClick={() => onSelect(option.label)} className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:border-slate-400 hover:bg-slate-50">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Možnosť {option.label}</p>
                    <p className="mt-2 text-base text-slate-900 md:text-lg">{option.text}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen">
      <div className="fixed inset-0 bg-slate-950/55" />
      <div className="relative z-10 mx-auto w-full max-w-5xl px-6 py-12">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Viora Decision Profile</p>
          {state.identity.name && <p className="mt-1 text-sm text-slate-600">Ahoj, {state.identity.name}</p>}
        </div>

        {shareMessage && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{shareMessage}</div>}
        {billingMessage && <div className="mb-4 rounded-xl border border-slate-200 bg-white/90 px-4 py-2 text-sm text-slate-700">{billingMessage}</div>}

        {mode === "free_results" && (
          <section className="space-y-6">
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Tvoj rozhodovací podpis</h2><div className="mt-4 whitespace-pre-line text-slate-700">{freeReport.signature}</div></article>
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Rizikové miesto</h2><div className="mt-4 whitespace-pre-line text-slate-700">{freeReport.riskSpot}</div></article>
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Jeden optimalizačný zásah</h2>
              <div className="mt-4 whitespace-pre-line text-slate-700">{freeReport.intervention}</div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" onClick={() => void copyText(`Môj Viora profil: ${freeReport.signature.split("\n")[0]}`)} className="rounded-full border border-slate-300 px-4 py-2 text-sm">Zdieľať</button>
                <button ref={unlockRef} type="button" onClick={() => openPaymentModal({ kind: "full" })} className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">Chcem hlbší profil</button>
                <button type="button" onClick={onTryAgain} className="rounded-full border border-slate-300 px-4 py-2 text-sm">Spustiť znova kvíz</button>
              </div>
            </article>
            {renderAddonArea(false)}
          </section>
        )}

        {mode === "premium_steps" && (
          <section className="space-y-6">
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4].map((s) => (
                <button key={s} type="button" onClick={() => patchState({ ui: { ...state.ui, premiumStep: s as 1 | 2 | 3 | 4 } })} className={`rounded-full border px-3 py-1 text-xs ${premiumStep === s ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}>
                  Krok {s}
                </button>
              ))}
            </div>
          ) }
        </div>

        {billingMessage && (
          <div className="rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-slate-700 shadow-sm">
            {billingMessage}
          </div>
        )}

            {premiumStep === 1 && (
              <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold">Hlboká analýza (Základ)</h2>
                <p className="mt-4 whitespace-pre-line text-slate-700">{fullReport.extendedSignature}</p>
                <ul className="mt-4 space-y-2 text-sm text-slate-700">
                  <li><span className="font-medium">Rýchlosť:</span> {fullReport.dimensionMap.speed}</li>
                  <li><span className="font-medium">Spracovanie:</span> {fullReport.dimensionMap.processing}</li>
                  <li><span className="font-medium">Neistota:</span> {fullReport.dimensionMap.risk}</li>
                  <li><span className="font-medium">Tlak:</span> {fullReport.dimensionMap.pressure}</li>
                  <li><span className="font-medium">Kontrola:</span> {fullReport.dimensionMap.control}</li>
                </ul>
                <div className="mt-5 flex gap-3"><button type="button" onClick={() => patchState({ ui: { ...state.ui, premiumStep: 2 } })} className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">Pokračovať</button><button type="button" onClick={onTryAgain} className="rounded-full border border-slate-300 px-4 py-2 text-sm">Spustiť znova kvíz</button></div>
              </article>
            )}

            {premiumStep === 2 && (
              <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold">Vybrané oblasti (2 v cene)</h2>
                <p className="mt-2 text-slate-600">Tieto oblasti zapracujeme do tvojej Komplexnej analýzy.</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {modules.filter((m) => !m.isFree).map((m) => {
                    const selected = (state.unlocks.included ?? []).includes(m.slug);
                    return (
                      <button key={m.slug} type="button" onClick={() => {
                        const list = state.unlocks.included ?? [];
                        const next = selected ? list.filter((x) => x !== m.slug) : list.length >= 2 ? list : [...list, m.slug];
                        patchState({ unlocks: { ...state.unlocks, included: next } });
                      }} className={`rounded-xl border p-4 text-left ${selected ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"}`}>
                        <p className="font-medium">{m.title}</p>
                        <p className="mt-1 text-sm text-slate-600">{m.description}</p>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-5"><button type="button" onClick={() => patchState({ ui: { ...state.ui, premiumStep: 3 } })} className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">Pokračovať</button></div>
              </article>
            )}

            {premiumStep === 3 && (
              <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold">Tuning / smer zmeny</h2>
                <p className="mt-2 text-slate-600">Vyber 1-2 focusy alebo krok preskoč.</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {tuningOptions.map((o) => {
                    const sel = (state.tuning.choices ?? []).includes(o);
                    return <button key={o} type="button" onClick={() => {
                      const list = state.tuning.choices ?? [];
                      const next = sel ? list.filter((x) => x !== o) : list.length >= 2 ? list : [...list, o];
                      patchState({ tuning: { ...state.tuning, choices: next } });
                    }} className={`rounded-xl border p-4 text-left ${sel ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"}`}>{o}</button>;
                  })}
                </div>
                <div className="mt-5 flex gap-3">
                  <button type="button" onClick={() => patchState({ tuning: { done: true, choices: state.tuning.choices ?? [] }, ui: { ...state.ui, premiumStep: 4 } })} className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">Pokračovať</button>
                  <button type="button" onClick={() => patchState({ tuning: { done: true, choices: [] }, ui: { ...state.ui, premiumStep: 4 } })} className="rounded-full border border-slate-300 px-4 py-2 text-sm">Preskočiť</button>
                </div>
              </article>
            )}

            {premiumStep === 4 && synthesis && (
              <section className="space-y-6">
                <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-semibold">Komplexná analýza</h2>
                  <h3 className="mt-4 text-base font-semibold">Tvoj obraz v skratke</h3>
                  <div className="mt-2 space-y-2 text-slate-700">{synthesis.summary.map((p) => <p key={p}>{p}</p>)}</div>
                  <h3 className="mt-4 text-base font-semibold">Ako sa to prejaví v bežných situáciách</h3>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-slate-700">{synthesis.situations.map((x) => <li key={x}>{x}</li>)}</ul>
                  <h3 className="mt-4 text-base font-semibold">Najčastejšia pasca + čo s tým</h3>
                  <p className="mt-2 text-slate-700">{synthesis.trap}</p>
                  <h3 className="mt-4 text-base font-semibold">Ak si vybral fokus, čo teraz upraviť</h3>
                  <p className="mt-2 text-slate-700">{synthesis.focusAdjustments}</p>
                  <h3 className="mt-4 text-base font-semibold">Ako do toho zapadajú tvoje kontexty</h3>
                  <p className="mt-2 text-slate-700">{synthesis.contexts}</p>
                </article>
                {renderAddonArea(true)}
              </section>
            )}
          </section>
        )}

        <div className="mt-8"><Link href="/" className="inline-flex items-center rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700">Späť na úvod</Link></div>
      </div>

      {showPaymentModal && purchaseIntent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-6">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl md:p-8">
            <h3 className="text-xl font-semibold">Pokračovanie na platbu</h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
                <input type="email" required value={state.identity.email ?? ""} onChange={(e) => patchState({ identity: { ...state.identity, email: e.target.value } })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="tvoj@email.sk" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Meno (voliteľné)</label>
                <input type="text" value={state.identity.name ?? ""} onChange={(e) => patchState({ identity: { ...state.identity, name: e.target.value } })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Ako ťa môžeme osloviť" />
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-600"><input type="checkbox" checked={state.identity.consent === true} onChange={(e) => patchState({ identity: { ...state.identity, consent: e.target.checked } })} className="mt-1" /><span>Súhlasím s podmienkami a ochranou súkromia.</span></label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowPaymentModal(false)} className="rounded-full border border-slate-300 px-4 py-2 text-sm">Zavrieť</button>
              <button type="button" onClick={() => void startCheckout()} disabled={isPaying} className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">{purchaseIntent.kind === "full" ? "Pokračovať na platbu 4,99 €" : `Pokračovať na platbu ${state.unlocks.full ? "0,99 €" : "2,99 €"}`}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
