"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { canAccessModule, getModuleStatus } from "../lib/access";
import { scoreAnswers, type OptionLabel, questions } from "../lib/decisionModel";
import { generateModuleAddon } from "../lib/moduleAddonGen";
import { modules, modulesBySlug, type ModuleOptionLabel, type ModuleSlug } from "../lib/modules";
import { generateFreeReport, generateFullReport } from "../lib/reportGen";
import { scoreModuleAnswers } from "../lib/moduleScoring";
import { deriveProfileMode, loadVioraState, patchVioraState, saveVioraState, type ProfileMode, type VioraStateV1 } from "../lib/vioraState";

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
  const [hydrated, setHydrated] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [state, setState] = useState<VioraStateV1 | null>(null);

  const [step, setStep] = useState(0);
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>("idle");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [purchaseIntent, setPurchaseIntent] = useState<PurchaseIntent | null>(null);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  const [selectedModule, setSelectedModule] = useState<ModuleSlug | null>(null);
  const [moduleStep, setModuleStep] = useState(0);
  const [moduleAnswers, setModuleAnswers] = useState<Record<number, ModuleOptionLabel>>({});
  const [moduleNotice, setModuleNotice] = useState<string | null>(null);
  const [moduleTransition, setModuleTransition] = useState<TransitionPhase>("idle");
  const [pendingModulePurchase, setPendingModulePurchase] = useState<ModuleSlug | null>(null);
  const [completedAddons, setCompletedAddons] = useState<Partial<Record<ModuleSlug, AddonResult>>>({});

  const unlockRef = useRef<HTMLButtonElement | null>(null);

  const answers = state?.base.answers ?? {};
  const mode: ProfileMode = state ? deriveProfileMode(state) : "quiz";
  const scored = useMemo(() => scoreAnswers(answers), [answers]);
  const report = useMemo(() => generateFreeReport(scored), [scored]);
  const fullReport = useMemo(() => generateFullReport(scored), [scored]);

  const currentQuestion = questions[step];
  const progress = ((step + 1) / questions.length) * 100;

  const moduleConfig = selectedModule ? modulesBySlug[selectedModule] : null;
  const activeModuleQuestion = moduleConfig ? moduleConfig.questions[moduleStep] : null;

  const greetingName = state?.identity.name?.trim() ?? "";
  const isFullUnlocked = state?.unlocks.full === true;
  const addonPriceLabel = isFullUnlocked ? "0,99 €" : "2,99 €";
  const canRenderResults = mode !== "quiz";

  const patchState = (patch: Partial<VioraStateV1>) => {
    setState((prev) => {
      const base = prev ?? loadVioraState();
      const next = patchVioraState(base, patch);
      saveVioraState(next);
      return next;
    });
  };

  const persistBaseAnswers = (nextAnswers: Record<number, OptionLabel>) => {
    patchState({
      base: { answers: nextAnswers, computedAt: Date.now() },
      ui: { lastMode: "results" },
    });
  };

  useEffect(() => {
    const bootState = loadVioraState();
    setState(bootState);

    const answered = bootState.base.answers ? Object.keys(bootState.base.answers).length : 0;
    if (answered > 0) {
      setStep(Math.min(answered - 1, questions.length - 1));
    }

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
          patchState({ unlocks: { ...bootState.unlocks, full: true } });
          setBillingMessage("Platba prebehla úspešne. Hlbší profil je odomknutý.");
        } else if (data?.ok && data?.kind === "addon" && typeof data?.moduleSlug === "string" && data.moduleSlug in modulesBySlug) {
          const slug = data.moduleSlug as ModuleSlug;
          const nextAddons = Array.from(new Set([...(bootState.unlocks.addons ?? []), slug]));
          patchState({ unlocks: { ...bootState.unlocks, addons: nextAddons } });
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

  const openPaymentModal = (intent: PurchaseIntent) => {
    setPurchaseIntent(intent);
    setShowPaymentModal(true);
  };

  const startCheckout = async () => {
    if (!purchaseIntent || !state) return;
    const email = state.identity.email?.trim() ?? "";
    const name = state.identity.name?.trim() ?? "";
    const consent = state.identity.consent === true;

    if (!email) {
      setBillingMessage("Pred platbou doplň prosím e-mail.");
      return;
    }
    if (!consent) {
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
          isPremium: purchaseIntent.kind === "addon" ? isFullUnlocked : false,
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

  const onSelect = (questionId: number, label: OptionLabel) => {
    if (!state) return;
    const nextAnswers = { ...answers, [questionId]: label };
    setTransitionPhase("transitioning");

    window.setTimeout(() => {
      if (step >= questions.length - 1) {
        setIsAnalyzing(true);
        setTransitionPhase("idle");
        persistBaseAnswers(nextAnswers);
        window.setTimeout(() => setIsAnalyzing(false), 1800);
        return;
      }

      patchState({ base: { ...state.base, answers: nextAnswers } });
      setStep((prev) => prev + 1);
      setTransitionPhase("idle");
    }, 420);
  };

  const startModule = (slug: ModuleSlug) => {
    if (!state) return;
    if (!canAccessModule(slug, state)) {
      setPendingModulePurchase(slug);
      if (!isFullUnlocked) {
        setModuleNotice("Tento modul je Plus. Môžeš ho odomknúť samostatne za 2,99 € alebo najprv odomknúť celý profil.");
        unlockRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        unlockRef.current?.focus();
      } else {
        setModuleNotice("Tento modul ešte nie je odomknutý. Môžeš ho pridať za 0,99 € alebo zvoliť medzi modulmi v cene.");
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

  const toggleIncludedModule = (slug: ModuleSlug) => {
    if (!state || !isFullUnlocked) return;
    if (getModuleStatus(slug, state) === "purchased" || getModuleStatus(slug, state) === "free") return;

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
    patchState({
      tuning: { done: true, choices: skip ? [] : state.tuning.choices ?? [] },
      ui: { ...state.ui, lastMode: "deep" },
    });
  };

  const resetModule = () => {
    setSelectedModule(null);
    setModuleAnswers({});
    setModuleStep(0);
    setModuleNotice(null);
    setModuleTransition("idle");
    setPendingModulePurchase(null);
  };

  if (!hydrated || isVerifying || !state) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-6 py-20 text-center">
        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white/80 px-10 py-10 shadow-sm backdrop-blur-sm">
          <div className="mx-auto h-9 w-9 animate-pulse rounded-full border-2 border-slate-300 border-t-slate-700" />
          <h1 className="text-2xl font-semibold">Načítavame tvoj profil…</h1>
        </div>
      </main>
    );
  }

  if (isAnalyzing) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-6 py-20 text-center">
        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white/80 px-10 py-10 shadow-sm backdrop-blur-sm">
          <div className="mx-auto h-9 w-9 animate-pulse rounded-full border-2 border-slate-300 border-t-slate-700" />
          <h1 className="text-2xl font-semibold">Analyzujeme tvoje odpovede…</h1>
          <p className="text-slate-600">Ešte chvíľu, skladáme tvoj profil do jasného obrazu.</p>
        </div>
      </main>
    );
  }

  if (!canRenderResults) {
    return (
      <main className="relative min-h-screen">
        <div className="fixed inset-0 bg-slate-950/55" />
        <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12">
          <div className={`w-full max-w-2xl rounded-3xl border border-white/20 bg-white/92 p-7 shadow-2xl backdrop-blur-md transition-all duration-500 md:p-10 ${transitionPhase === "transitioning" ? "scale-[0.99] opacity-70" : "scale-100 opacity-100"}`}>
            <div className="mb-7 space-y-3">
              <p className="text-sm font-medium text-slate-500">Otázka {step + 1} / {questions.length}</p>
              <div className="h-1.5 w-full rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-slate-900 transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <h1 className="text-2xl font-semibold leading-snug text-slate-900 md:text-3xl">{currentQuestion.question}</h1>

            <div className="mt-7 grid gap-4">
              {currentQuestion.options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => onSelect(currentQuestion.id, option.label)}
                  disabled={transitionPhase === "transitioning"}
                  className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Možnosť {option.label}</p>
                  <p className="mt-2 text-base text-slate-900 md:text-lg">{option.text}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-14 md:py-20">
      <div className="mb-10 space-y-3">
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Viora Decision Profile</p>
        {greetingName && <p className="text-sm text-slate-600">Ahoj, {greetingName}</p>}
        <h1 className="text-3xl font-semibold md:text-4xl">Tvoj bezplatný report</h1>
      </div>

      {billingMessage && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-slate-700 shadow-sm backdrop-blur-sm">
          {billingMessage}
        </div>
      )}

      <section className="space-y-8">
        <article className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur-sm md:p-8">
          <h2 className="text-xl font-semibold">Tvoj rozhodovací podpis</h2>
          <div className="mt-4 whitespace-pre-line text-slate-700">{report.signature}</div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur-sm md:p-8">
          <h2 className="text-xl font-semibold">Rizikové miesto</h2>
          <div className="mt-4 whitespace-pre-line text-slate-700">{report.riskSpot}</div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur-sm md:p-8">
          <h2 className="text-xl font-semibold">Jeden optimalizačný zásah</h2>
          <div className="mt-4 whitespace-pre-line text-slate-700">{report.intervention}</div>
        </article>

        {isFullUnlocked && (
          <article className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur-sm md:p-8">
            <h2 className="text-xl font-semibold">Premium centrum</h2>
            <p className="mt-2 text-slate-600">Vyber si 2 oblasti, ktoré máš v cene (môžeš aj neskôr).</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {modules.filter((m) => !m.isFree).map((m) => {
                const status = getModuleStatus(m.slug, state);
                return (
                  <div key={`hub-${m.slug}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="font-medium text-slate-900">{m.title}</h3>
                      {status === "included" ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">V cene</span>
                      ) : status === "purchased" ? (
                        <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700">Odomknuté</span>
                      ) : (
                        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">Plus</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600">{m.description}</p>
                    {status === "locked" && (
                      <button
                        type="button"
                        onClick={() => openPaymentModal({ kind: "addon", moduleSlug: m.slug })}
                        className="mt-3 inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-white"
                      >
                        Pridať za 0,99 €
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-5">
              <button type="button" onClick={() => patchState({ unlocks: { ...state.unlocks, included: [] } })} className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white">
                {(state.unlocks.included?.length ?? 0) < 2 ? "Vybrať teraz" : "Zmeniť výber"}
              </button>
              <p className="mt-2 text-sm text-slate-500">Vybraté v cene: {state.unlocks.included?.length ?? 0}/2</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {modules.filter((m) => !m.isFree).map((m) => {
                  const selected = (state.unlocks.included ?? []).includes(m.slug);
                  const status = getModuleStatus(m.slug, state);
                  return (
                    <button
                      key={`pick-${m.slug}`}
                      type="button"
                      onClick={() => toggleIncludedModule(m.slug)}
                      disabled={(status === "purchased" || status === "free") || (!selected && (state.unlocks.included?.length ?? 0) >= 2)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-white"} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {m.title}
                    </button>
                  );
                })}
              </div>
            </div>
          </article>
        )}

        <article className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur-sm md:p-8">
          <h2 className="text-xl font-semibold">Detailná analýza (Full Report)</h2>
          {!isFullUnlocked && (
            <>
              <div className="relative mt-5 overflow-hidden rounded-xl border border-slate-100 bg-slate-50 p-5 md:p-6">
                <div className="pointer-events-none select-none blur-[3px]">
                  <h3 className="text-base font-semibold">Rozšírený rozhodovací podpis</h3>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700 md:text-base">{fullReport.extendedSignature}</p>
                </div>
                <div className="pointer-events-none absolute inset-0 bg-white/30" />
              </div>
              <div className="mt-6 flex justify-center">
                <button
                  ref={unlockRef}
                  type="button"
                  onClick={() => openPaymentModal({ kind: "full" })}
                  disabled={isPaying}
                  className="inline-flex items-center rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-80"
                >
                  Chcem hlbší profil
                </button>
              </div>
            </>
          )}

          {isFullUnlocked && mode !== "deep" && (
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="text-lg font-semibold">Čo chceš zlepšiť?</h3>
              <p className="mt-2 text-sm text-slate-600">Vyber 1–2 oblasti fokusu, podľa ktorých ti zobrazíme hĺbkovú analýzu.</p>
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
                        patchState({ tuning: { done: next.length > 0, choices: next } });
                      }}
                      className={`rounded-xl border p-4 text-left text-sm transition ${selected ? "border-slate-900 bg-white" : "border-slate-200 bg-white hover:border-slate-400"}`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" onClick={() => completeTuning(false)} className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800">
                  Pokračovať
                </button>
                <button type="button" onClick={() => completeTuning(true)} className="inline-flex items-center rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white">
                  Preskočiť a zobraziť analýzu
                </button>
              </div>
            </div>
          )}

          {isFullUnlocked && mode === "deep" && (
            <div className="mt-5 overflow-hidden rounded-xl border border-slate-100 bg-slate-50 p-5 md:p-6">
              {(state.tuning.choices ?? []).length > 0 && <p className="mb-4 text-sm text-slate-600">Tvoj fokus: {(state.tuning.choices ?? []).join(", ")}</p>}
              <div className="space-y-7">
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
                <section>
                  <h3 className="text-base font-semibold">Interakčné napätia</h3>
                  <ul className="mt-3 list-inside list-disc space-y-2 text-sm leading-relaxed text-slate-700 md:text-base">
                    {fullReport.tensions.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </section>
                <section>
                  <h3 className="text-base font-semibold">7-dňový plán optimalizácie</h3>
                  <ol className="mt-3 space-y-2 text-sm text-slate-700 md:text-base">
                    {fullReport.sevenDayPlan.map((item) => <li key={item.day}><span className="font-medium">Deň {item.day}:</span> {item.text}</li>)}
                  </ol>
                </section>
              </div>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur-sm md:p-8">
          <h2 className="text-xl font-semibold">Spresniť analýzu podľa kontextu</h2>
          <p className="mt-2 text-slate-600">Vyber si modul pre doplnkový mini-report.</p>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {modules.map((m) => {
              const status = getModuleStatus(m.slug, state);
              return (
                <button key={m.slug} type="button" onClick={() => startModule(m.slug)} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-400">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="font-medium text-slate-900">{m.title}</h3>
                    <div className="flex items-center gap-2">
                      {completedAddons[m.slug] && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Hotovo</span>}
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status === "free" || status === "included" ? "bg-emerald-100 text-emerald-700" : status === "purchased" ? "bg-sky-100 text-sky-700" : "bg-slate-200 text-slate-700"}`}>
                        {status === "free" ? "Skús zdarma" : status === "included" ? "V cene" : status === "purchased" ? "Odomknuté" : "Plus"}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600">{m.description}</p>
                </button>
              );
            })}
          </div>

          {moduleNotice && <p className="mt-4 text-sm text-amber-700">{moduleNotice}</p>}

          {pendingModulePurchase && !canAccessModule(pendingModulePurchase, state) && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => openPaymentModal({ kind: "addon", moduleSlug: pendingModulePurchase })} disabled={isPaying} className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70">
                {isFullUnlocked ? "Pridať za 0,99 €" : "Odomknúť za 2,99 €"}
              </button>
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
      </section>

      <div className="mt-10">
        <Link href="/" className="inline-flex items-center rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">Späť na úvod</Link>
      </div>

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
                <input type="email" required value={state.identity.email ?? ""} onChange={(e) => patchState({ identity: { ...state.identity, email: e.target.value } })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" placeholder="tvoj@email.sk" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Meno (voliteľné)</label>
                <input type="text" value={state.identity.name ?? ""} onChange={(e) => patchState({ identity: { ...state.identity, name: e.target.value } })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500" placeholder="Ako ťa môžeme osloviť" />
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={state.identity.consent === true} onChange={(e) => patchState({ identity: { ...state.identity, consent: e.target.checked } })} className="mt-1" />
                <span>Súhlasím s podmienkami a ochranou súkromia.</span>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              <button type="button" onClick={() => setShowPaymentModal(false)} className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Zavrieť</button>
              <button type="button" onClick={() => void startCheckout()} disabled={isPaying} className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70">
                {purchaseIntent.kind === "full" ? "Pokračovať na platbu 4,99 €" : `Pokračovať na platbu ${addonPriceLabel}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
