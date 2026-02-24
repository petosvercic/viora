"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { canAccessModule, getModuleStatus } from "../lib/access";
import { generateChangeTool } from "../lib/changeToolGen";
import { scoreAnswers, type OptionLabel, questions } from "../lib/decisionModel";
import { generateModuleAddon } from "../lib/moduleAddonGen";
import { scoreModuleAnswers } from "../lib/moduleScoring";
import { modules, modulesBySlug, type ModuleOptionLabel, type ModuleSlug } from "../lib/modules";
import { resolveVariantsFromIds, selectBaseQuizVariants, slotIds } from "../lib/questionPool";
import { generateFreeReport, generateFullReport } from "../lib/reportGen";
import { createNextRunState, deriveProfileMode, ensureBaseRunConfig, getAnsweredCount, isQuizComplete, loadVioraState, patchVioraState, saveVioraState, withMode, type ProfileMode, type VioraStateV1 } from "../lib/vioraState";

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

const sceneNav: { mode: ProfileMode; label: string }[] = [
  { mode: "premiumResult", label: "Deep report" },
  { mode: "tuning", label: "Tuning" },
  { mode: "changeTool", label: "Change Tool" },
  { mode: "premiumHub", label: "Premium centrum" },
];

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
  const [isPaying, setIsPaying] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  const [selectedModule, setSelectedModule] = useState<ModuleSlug | null>(null);
  const [moduleStep, setModuleStep] = useState(0);
  const [moduleAnswers, setModuleAnswers] = useState<Record<number, ModuleOptionLabel>>({});
  const [moduleNotice, setModuleNotice] = useState<string | null>(null);
  const [moduleTransition, setModuleTransition] = useState<TransitionPhase>("idle");
  const [pendingModulePurchase, setPendingModulePurchase] = useState<ModuleSlug | null>(null);
  const [completedAddons, setCompletedAddons] = useState<Partial<Record<ModuleSlug, AddonResult>>>({});

  const unlockRef = useRef<HTMLButtonElement | null>(null);

  const answers = state?.base.answers ?? {};
  const variantSeed = state?.base.seed ?? "viora";
  const variantRunIndex = state?.base.runIndex ?? 0;
  const scored = useMemo(() => scoreAnswers(answers), [answers]);
  const freeReport = useMemo(() => generateFreeReport(scored, { seed: variantSeed, runIndex: variantRunIndex }), [scored, variantSeed, variantRunIndex]);
  const fullReport = useMemo(() => generateFullReport(scored, { seed: variantSeed, runIndex: variantRunIndex }), [scored, variantSeed, variantRunIndex]);
  const changeTool = useMemo(() => generateChangeTool(scored, state?.tuning.choices ?? []), [scored, state?.tuning.choices]);

  const selectedVariants = useMemo(() => {
    const fromIds = resolveVariantsFromIds(state?.base.selectedVariantIds ?? {});
    if (fromIds) return fromIds;
    return selectBaseQuizVariants(variantSeed, variantRunIndex);
  }, [state?.base.selectedVariantIds, variantSeed, variantRunIndex]);

  const currentQuestion = selectedVariants[slotIds[step]];
  const progress = ((step + 1) / questions.length) * 100;

  const mode: ProfileMode = state ? deriveProfileMode(state) : "quiz";
  const displayMode: ProfileMode = state?.ui.mode && mode !== "quiz" && mode !== "freeResult" ? state.ui.mode : mode;
  const isPremiumUser = state?.unlocks.full === true;

  const moduleConfig = selectedModule ? modulesBySlug[selectedModule] : null;
  const activeModuleQuestion = moduleConfig ? moduleConfig.questions[moduleStep] : null;

  const patchState = (patch: Partial<VioraStateV1>) => {
    setState((prev) => {
      const base = prev ?? loadVioraState();
      const next = patchVioraState(base, patch);
      saveVioraState(next);
      return next;
    });
  };

  const setSceneMode = (target: ProfileMode) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = withMode(prev, target);
      saveVioraState(next);
      return next;
    });
  };

  const copyText = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.focus();
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setShareMessage("Skopírované do schránky ✅");
    } catch {
      setShareMessage("Nepodarilo sa skopírovať text.");
    }
  };

  useEffect(() => {
    const loaded = ensureBaseRunConfig(loadVioraState());
    const normalized = withMode(loaded, deriveProfileMode(loaded));
    setState(normalized);
    saveVioraState(normalized);

    const answered = getAnsweredCount(normalized);
    if (answered > 0) setStep(Math.min(answered, questions.length) - 1);

    if (localStorage.getItem(LS_PREMIUM_PRICE_WARNING) === "true") {
      setBillingMessage("0,99 € cena pre Plus modul nie je nakonfigurovaná, použila sa základná cena 2,99 €.");
      localStorage.removeItem(LS_PREMIUM_PRICE_WARNING);
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("canceled") === "1") {
      setBillingMessage("Platba bola zrušená. Môžeš to skúsiť znova.");
    }

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

        if (data?.ok && data?.kind === "full") {
          setState((prev) => {
            if (!prev) return prev;
            let next = patchVioraState(prev, { unlocks: { ...prev.unlocks, full: true } });
            next = withMode(next, "premiumResult");
            saveVioraState(next);
            return next;
          });
          setBillingMessage("Platba prebehla úspešne. Hlbší profil je odomknutý.");
        } else if (data?.ok && data?.kind === "addon" && typeof data?.moduleSlug === "string" && data.moduleSlug in modulesBySlug) {
          const slug = data.moduleSlug as ModuleSlug;
          setState((prev) => {
            if (!prev) return prev;
            const nextAddons = Array.from(new Set([...(prev.unlocks.addons ?? []), slug]));
            const next = patchVioraState(prev, { unlocks: { ...prev.unlocks, addons: nextAddons } });
            saveVioraState(next);
            return next;
          });
          setBillingMessage(`Platba prebehla úspešne. Modul „${modulesBySlug[slug].title}“ je odomknutý.`);
          setPendingModulePurchase(null);
        } else {
          setBillingMessage("Overenie platby sa nepodarilo. Skús obnoviť stránku.");
        }
      } catch {
        setBillingMessage("Overenie platby zlyhalo. Skús to prosím znova.");
      } finally {
        localStorage.removeItem(LS_PENDING_PURCHASE);
        const clean = new URL(window.location.href);
        clean.searchParams.delete("session_id");
        window.history.replaceState({}, "", clean.toString());
        setIsVerifying(false);
        setHydrated(true);
      }
    };

    void verify();
  }, []);

  useEffect(() => {
    if (!state) return;
    const derived = deriveProfileMode(state);
    if (derived === "quiz" || derived === "freeResult") {
      if (state.ui.mode !== derived) setSceneMode(derived);
      return;
    }
    if (state.ui.mode && state.ui.mode !== "quiz" && state.ui.mode !== "freeResult") return;
    setSceneMode(derived);
  }, [state?.unlocks.full, state?.tuning.done]);

  const openPaymentModal = (intent: PurchaseIntent) => {
    setPurchaseIntent(intent);
    setShowPaymentModal(true);
  };

  const startCheckout = async () => {
    if (!state || !purchaseIntent) return;
    const email = state.identity.email?.trim() ?? "";
    const name = state.identity.name?.trim() ?? "";

    if (!email) {
      setBillingMessage("Pred platbou doplň prosím e-mail.");
      return;
    }
    if (state.identity.consent !== true) {
      setBillingMessage("Pred platbou je potrebné potvrdiť súhlas s podmienkami.");
      return;
    }

    try {
      setIsPaying(true);
      setBillingMessage(null);
      localStorage.setItem(LS_PENDING_PURCHASE, JSON.stringify({ ...purchaseIntent, email, name, timestamp: Date.now() }));

      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: purchaseIntent.kind,
          moduleSlug: purchaseIntent.moduleSlug,
          email,
          name,
          isPremium: purchaseIntent.kind === "addon" ? isPremiumUser : false,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.url) {
        setBillingMessage(data?.error || "Nepodarilo sa spustiť platbu.");
        return;
      }
      if (data?.usedPremiumFallback === true) {
        localStorage.setItem(LS_PREMIUM_PRICE_WARNING, "true");
      }
      window.location.href = data.url as string;
    } catch {
      setBillingMessage("Nepodarilo sa spustiť platbu. Skús to prosím znova.");
    } finally {
      setIsPaying(false);
    }
  };

  const startModule = (slug: ModuleSlug) => {
    if (!state) return;
    if (!canAccessModule(slug, state)) {
      setPendingModulePurchase(slug);
      setModuleNotice(
        isPremiumUser
          ? "Tento modul ešte nie je odomknutý. Môžeš ho pridať za 0,99 €."
          : "Tento modul je Plus. Môžeš ho odomknúť samostatne za 2,99 € alebo zvoliť hlbší profil.",
      );
      if (!isPremiumUser) {
        unlockRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        unlockRef.current?.focus();
      }
      return;
    }

    setPendingModulePurchase(null);
    setModuleNotice(null);
    setSelectedModule(slug);
    setModuleAnswers({});
    setModuleStep(0);
    setModuleTransition("idle");
    patchState({ ui: { ...state.ui, lastSelectedModule: slug } });
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

      setModuleStep((prev) => prev + 1);
      setModuleTransition("idle");
    }, 360);
  };

  const onSelect = (_questionId: number, label: OptionLabel) => {
    if (!state) return;
    const nextAnswers = { ...answers, [_questionId]: label };
    setTransitionPhase("transitioning");

    window.setTimeout(() => {
      if (step >= questions.length - 1) {
        setIsAnalyzing(true);
        const completed = withMode(
          patchVioraState(state, {
            base: { answers: nextAnswers, computedAt: Date.now() },
            ui: { ...state.ui, mode: "freeResult", lastMode: "freeResult" },
          }),
          "freeResult",
        );
        setState(completed);
        saveVioraState(completed);
        setTransitionPhase("idle");
        window.setTimeout(() => setIsAnalyzing(false), 1800);
        return;
      }

      const next = patchVioraState(state, { base: { ...state.base, answers: nextAnswers } });
      setState(next);
      saveVioraState(next);
      setStep((prev) => prev + 1);
      setTransitionPhase("idle");
    }, 420);
  };

  const toggleIncludedModule = (slug: ModuleSlug) => {
    if (!state || !isPremiumUser) return;
    const status = getModuleStatus(slug, state);
    if (status === "free" || status === "purchased") return;

    const current = state.unlocks.included ?? [];
    const next = current.includes(slug)
      ? current.filter((item) => item !== slug)
      : current.length >= 2
        ? current
        : [...current, slug];

    patchState({ unlocks: { ...state.unlocks, included: next } });
  };

  const completeTuning = (skip: boolean) => {
    if (!state) return;
    const choices = skip ? [] : (state.tuning.choices ?? []);
    const next = withMode(
      patchVioraState(state, {
        tuning: { done: true, choices },
        ui: { ...state.ui, mode: "changeTool", lastMode: "changeTool" },
      }),
      "changeTool",
    );
    setState(next);
    saveVioraState(next);
  };

  const tryAgain = () => {
    if (!state) return;
    const next = createNextRunState(state);
    setState(next);
    saveVioraState(next);
    setStep(0);
    setSelectedModule(null);
    setModuleAnswers({});
    setModuleStep(0);
    setPendingModulePurchase(null);
    setModuleNotice(null);
  };

  const resetModule = () => {
    setSelectedModule(null);
    setModuleAnswers({});
    setModuleStep(0);
    setModuleNotice(null);
    setModuleTransition("idle");
    setPendingModulePurchase(null);
  };

  const renderAddonArea = () => {
    if (!state) return null;
    return (
      <article className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur-sm md:p-8">
        <h2 className="text-xl font-semibold">Spresniť analýzu podľa kontextu</h2>
        <p className="mt-2 text-slate-600">Vyber si modul pre doplnkový mini-report.</p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {modules.map((module) => {
            const status = getModuleStatus(module.slug, state);
            return (
              <button key={module.slug} type="button" onClick={() => startModule(module.slug)} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-400">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="font-medium text-slate-900">{module.title}</h3>
                  <div className="flex items-center gap-2">
                    {completedAddons[module.slug] && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Hotovo</span>}
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status === "free" || status === "included" ? "bg-emerald-100 text-emerald-700" : status === "purchased" ? "bg-sky-100 text-sky-700" : "bg-slate-200 text-slate-700"}`}>
                      {status === "free" ? "Skús zdarma" : status === "included" ? "V cene" : status === "purchased" ? "Odomknuté" : "Plus"}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-slate-600">{module.description}</p>
              </button>
            );
          })}
        </div>

        {moduleNotice && <p className="mt-4 text-sm text-amber-700">{moduleNotice}</p>}

        {pendingModulePurchase && !canAccessModule(pendingModulePurchase, state) && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => openPaymentModal({ kind: "addon", moduleSlug: pendingModulePurchase })} disabled={isPaying} className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70">
              {isPremiumUser ? "Pridať za 0,99 €" : "Odomknúť za 2,99 €"}
            </button>
            {!isPremiumUser && (
              <button type="button" onClick={() => openPaymentModal({ kind: "full" })} className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white">
                Chcem hlbší profil
              </button>
            )}
            <span className="text-sm text-slate-500">{modulesBySlug[pendingModulePurchase].title}</span>
          </div>
        )}

        {selectedModule && moduleConfig && !completedAddons[selectedModule] && activeModuleQuestion && (
          <div className={`mt-8 rounded-xl border border-slate-200 p-5 transition-all duration-300 ${moduleTransition === "transitioning" ? "opacity-70" : "opacity-100"}`}>
            <p className="text-sm text-slate-500">{moduleConfig.title} · Otázka {moduleStep + 1} / {moduleConfig.questions.length}</p>
            <h3 className="mt-3 text-lg font-semibold">{activeModuleQuestion.question}</h3>
            <div className="mt-4 grid gap-3">
              {activeModuleQuestion.options.map((option) => (
                <button key={option.label} type="button" onClick={() => onModuleSelect(activeModuleQuestion.id, option.label)} className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-400 hover:bg-slate-50">
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
              const moduleTitle = modulesBySlug[slug as ModuleSlug].title;
              return (
                <div key={slug} className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{moduleTitle}</p>
                  <h3 className="mt-1 text-lg font-semibold">{addon.title}</h3>
                  <div className="mt-4 space-y-4 text-slate-700">
                    <div><p className="text-sm font-semibold text-slate-900">Insight</p><p className="mt-1 text-sm">{addon.insight}</p></div>
                    <div><p className="text-sm font-semibold text-slate-900">Rizikové miesto</p><p className="mt-1 text-sm">{addon.riskSpot}</p></div>
                    <div><p className="text-sm font-semibold text-slate-900">Odporúčaný krok</p><p className="mt-1 text-sm">{addon.action}</p></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {selectedModule && (
          <button type="button" onClick={resetModule} className="mt-5 inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white">
            Vybrať iný modul
          </button>
        )}
      </article>
    );
  };

  const renderScene = () => {
    if (!state) return null;

    if (isAnalyzing) {
      return (
        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white/90 px-10 py-10 text-center shadow-sm">
          <div className="mx-auto h-9 w-9 animate-pulse rounded-full border-2 border-slate-300 border-t-slate-700" />
          <h1 className="text-2xl font-semibold">Analyzujeme tvoje odpovede…</h1>
          <p className="text-slate-600">Ešte chvíľu, skladáme tvoj profil do jasného obrazu.</p>
        </div>
      );
    }

    if (displayMode === "quiz") {
      return (
        <div className={`w-full max-w-2xl rounded-3xl border border-white/20 bg-white/92 p-7 shadow-2xl backdrop-blur-md transition-all duration-500 md:p-10 ${transitionPhase === "transitioning" ? "scale-[0.99] opacity-70" : "scale-100 opacity-100"}`}>
          <div className="mb-7 space-y-3">
            <p className="text-sm font-medium text-slate-500">Otázka {step + 1} / {questions.length}</p>
            <div className="h-1.5 w-full rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-slate-900 transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <h1 className="text-2xl font-semibold leading-snug text-slate-900 md:text-3xl">{currentQuestion.question}</h1>
          <div className="mt-7 grid gap-4">
            {currentQuestion?.options.map((option) => (
              <button key={option.label} type="button" onClick={() => onSelect(slotIds[step], option.label)} disabled={transitionPhase === "transitioning"} className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Možnosť {option.label}</p>
                <p className="mt-2 text-base text-slate-900 md:text-lg">{option.text}</p>
              </button>
            ))}
          </div>
        </div>
      );
    }

    const premiumNav = isPremiumUser && isQuizComplete(state);

    return (
      <div className="w-full max-w-5xl space-y-6 rounded-3xl border border-white/20 bg-white/92 p-6 shadow-2xl backdrop-blur-md md:p-8">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Viora Decision Profile</p>
          {state.identity.name?.trim() && <p className="text-sm text-slate-600">Ahoj, {state.identity.name.trim()}</p>}
          {premiumNav ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {sceneNav.map((item) => (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => setSceneMode(item.mode)}
                  disabled={item.mode === "changeTool" || item.mode === "premiumHub" ? state.tuning.done !== true : false}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${displayMode === item.mode ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-white"} disabled:opacity-40`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {billingMessage && (
          <div className="rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-slate-700 shadow-sm">
            {billingMessage}
          </div>
        )}

        {shareMessage && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{shareMessage}</div>
        )}

        {displayMode === "freeResult" && (
          <section className="space-y-5">
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Tvoj rozhodovací podpis</h2>
              <div className="mt-4 whitespace-pre-line text-slate-700">{freeReport.signature}</div>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Rizikové miesto</h2>
              <div className="mt-4 whitespace-pre-line text-slate-700">{freeReport.riskSpot}</div>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Jeden optimalizačný zásah</h2>
              <div className="mt-4 whitespace-pre-line text-slate-700">{freeReport.intervention}</div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void copyText(`Môj Viora profil: ${freeReport.signature.split("\n")[0] ?? "Rozhodujem vedome."}\nRizikové miesto: ${freeReport.riskSpot.split("\n")[0] ?? ""}`)}
                  className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Zdieľať
                </button>
                <button ref={unlockRef} type="button" onClick={() => openPaymentModal({ kind: "full" })} className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800">
                  Odomknúť FULL 4,99 €
                </button>
                <button type="button" onClick={tryAgain} className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                  Skúsiť znova
                </button>
              </div>
            </article>
            {renderAddonArea()}
          </section>
        )}

        {displayMode === "premiumResult" && (
          <section className="space-y-5">
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Detailná analýza (Full Report)</h2>
              <div className="mt-5 space-y-7 rounded-xl border border-slate-100 bg-slate-50 p-5 md:p-6">
                <section>
                  <h3 className="text-base font-semibold">Rozšírený rozhodovací podpis</h3>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700 md:text-base">{fullReport.extendedSignature}</p>
                </section>
                <section>
                  <h3 className="text-base font-semibold">Analytická mapa</h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700 md:text-base">
                    <li><span className="font-medium">Rýchlosť:</span> {fullReport.dimensionMap.speed}</li>
                    <li><span className="font-medium">Spracovanie:</span> {fullReport.dimensionMap.processing}</li>
                    <li><span className="font-medium">Neistota:</span> {fullReport.dimensionMap.risk}</li>
                    <li><span className="font-medium">Tlak:</span> {fullReport.dimensionMap.pressure}</li>
                    <li><span className="font-medium">Kontrola:</span> {fullReport.dimensionMap.control}</li>
                  </ul>
                </section>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" onClick={() => setSceneMode("tuning")} className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800">Pokračovať na tuning</button>
                <button
                  type="button"
                  onClick={() => void copyText(`Môj Viora Premium profil:\nFokus: ${(state.tuning.choices ?? []).join(", ") || "bez výberu"}\nHighlight 1: ${fullReport.extendedSignature.split("\n")[0] ?? ""}\nHighlight 2: ${fullReport.dimensionMap.pressure}`)}
                  className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Zdieľať Premium
                </button>
                <button type="button" onClick={tryAgain} className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                  Skúsiť znova
                </button>
              </div>
            </article>
          </section>
        )}

        {displayMode === "tuning" && (
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Čo chceš zlepšiť?</h2>
            <p className="mt-2 text-sm text-slate-600">Vyber 1–2 oblasti fokusu, podľa ktorých pripravíme Change Tool.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {tuningOptions.map((option) => {
                const selected = (state.tuning.choices ?? []).includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      const current = state.tuning.choices ?? [];
                      const next = current.includes(option)
                        ? current.filter((item) => item !== option)
                        : current.length >= 2
                          ? current
                          : [...current, option];
                      patchState({ tuning: { ...state.tuning, choices: next } });
                    }}
                    className={`rounded-xl border p-4 text-left text-sm transition ${selected ? "border-slate-900 bg-white" : "border-slate-200 bg-white hover:border-slate-400"}`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={() => completeTuning(false)} className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800">Pokračovať</button>
              <button type="button" onClick={() => completeTuning(true)} className="inline-flex items-center rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white">Preskočiť</button>
            </div>
          </article>
        )}

        {displayMode === "changeTool" && (
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">{changeTool.title}</h2>
            <p className="mt-3 text-slate-700">{changeTool.intro}</p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-slate-700">
              {changeTool.steps.map((stepText) => <li key={stepText}>{stepText}</li>)}
            </ol>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold">Mikro návyk</p>
              <p className="mt-1 text-sm text-slate-700">{changeTool.microHabit}</p>
            </div>
            <p className="mt-3 text-sm text-amber-700">{changeTool.warning}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={() => setSceneMode("premiumHub")} className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800">Pokračovať do Premium centra</button>
              <button type="button" onClick={() => setSceneMode("premiumResult")} className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Späť na Deep report</button>
            </div>
          </article>
        )}

        {displayMode === "premiumHub" && (
          <section className="space-y-5">
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Premium centrum</h2>
              <p className="mt-2 text-slate-600">Vyber si 2 oblasti, ktoré máš v cene (môžeš aj neskôr).</p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {modules.filter((module) => !module.isFree).map((module) => {
                  const status = getModuleStatus(module.slug, state);
                  return (
                    <div key={`hub-${module.slug}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <h3 className="font-medium text-slate-900">{module.title}</h3>
                        {status === "included" ? (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">V cene</span>
                        ) : status === "purchased" ? (
                          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700">Odomknuté</span>
                        ) : (
                          <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">Plus</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600">{module.description}</p>
                      {status === "locked" && (
                        <button type="button" onClick={() => openPaymentModal({ kind: "addon", moduleSlug: module.slug })} className="mt-3 inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-white">
                          Pridať za 0,99 €
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-5">
                <p className="text-sm text-slate-500">Vybraté v cene: {(state.unlocks.included ?? []).length}/2</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {modules.filter((module) => !module.isFree).map((module) => {
                    const selected = (state.unlocks.included ?? []).includes(module.slug);
                    return (
                      <button
                        key={`pick-${module.slug}`}
                        type="button"
                        onClick={() => toggleIncludedModule(module.slug)}
                        disabled={!selected && (state.unlocks.included ?? []).length >= 2}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-white"} disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {module.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            </article>
            {renderAddonArea()}
          </section>
        )}

        <div className="flex items-center justify-between pt-2">
          <Link href="/" className="inline-flex items-center rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Späť na úvod</Link>
        </div>
      </div>
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

  return (
    <main className="relative min-h-screen">
      <div className="fixed inset-0 bg-slate-950/55" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-10">{renderScene()}</div>

      {showPaymentModal && purchaseIntent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-6">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl md:p-8">
            <h3 className="text-xl font-semibold">Pokračovanie na platbu</h3>
            <p className="mt-2 text-sm text-slate-600">Čo získaš:</p>
            <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-700">
              <li>detailnejší rozklad tvojho rozhodovacieho štýlu,</li>
              <li>jasné rizikové body pre každodenné rozhodnutia,</li>
              <li>konkrétne kroky na zlepšenie rozhodovania,</li>
              <li>prístup k odomknutým Plus modulom podľa výberu.</li>
            </ul>

            <div className="mt-5 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
                <input
                  type="email"
                  required
                  value={state.identity.email ?? ""}
                  onChange={(e) => patchState({ identity: { ...state.identity, email: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  placeholder="tvoj@email.sk"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Meno (voliteľné)</label>
                <input
                  type="text"
                  value={state.identity.name ?? ""}
                  onChange={(e) => patchState({ identity: { ...state.identity, name: e.target.value } })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  placeholder="Ako ťa môžeme osloviť"
                />
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={state.identity.consent === true}
                  onChange={(e) => patchState({ identity: { ...state.identity, consent: e.target.checked } })}
                  className="mt-1"
                />
                <span>Súhlasím s podmienkami a ochranou súkromia.</span>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button type="button" onClick={() => setShowPaymentModal(false)} className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Zavrieť</button>
              <button type="button" onClick={() => void startCheckout()} disabled={isPaying} className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70">
                {purchaseIntent.kind === "full" ? "Pokračovať na platbu 4,99 €" : `Pokračovať na platbu ${isPremiumUser ? "0,99 €" : "2,99 €"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
