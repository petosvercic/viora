"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { scoreAnswers, type OptionLabel, questions } from "../lib/decisionModel";
import { generateModuleAddon } from "../lib/moduleAddonGen";
import { scoreModuleAnswers } from "../lib/moduleScoring";
import { modules, modulesBySlug, type ModuleOptionLabel, type ModuleSlug } from "../lib/modules";
import { generateFreeReport, generateFullReport } from "../lib/reportGen";

type Phase = "questions" | "analyzing" | "result";
type TransitionPhase = "idle" | "transitioning";

type AddonResult = {
  title: string;
  insight: string;
  riskSpot: string;
  action: string;
};

type PurchaseIntent = {
  kind: "full" | "addon";
  moduleSlug?: ModuleSlug;
};

const LS_LAST_BASE_ANSWERS = "viora_last_base_answers";
const LS_LAST_BASE_REPORT_FREE = "viora_last_base_report_free";
const LS_LAST_BASE_REPORT_FULL = "viora_last_base_report_full";
const LS_LAST_RUN_AT = "viora_last_run_at";
const LS_UNLOCKED_FULL = "viora_unlocked_full";
const LS_UNLOCKED_ADDONS = "viora_unlocked_addons";
const LS_EMAIL = "viora_email";
const LS_NAME = "viora_name";
const LS_CONSENT = "viora_consent";
const LS_PENDING_PURCHASE = "viora_pending_purchase";
const LS_PREMIUM_PRICE_WARNING = "viora_premium_price_warning";

export default function ProfilePage() {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>("questions");
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>("idle");
  const [answers, setAnswers] = useState<Record<number, OptionLabel>>({});

  const [unlocked, setUnlocked] = useState(false);
  const [unlockedAddons, setUnlockedAddons] = useState<ModuleSlug[]>([]);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [purchaseIntent, setPurchaseIntent] = useState<PurchaseIntent | null>(null);

  const [selectedModule, setSelectedModule] = useState<ModuleSlug | null>(null);
  const [moduleStep, setModuleStep] = useState(0);
  const [moduleAnswers, setModuleAnswers] = useState<Record<number, ModuleOptionLabel>>({});
  const [moduleNotice, setModuleNotice] = useState<string | null>(null);
  const [moduleTransition, setModuleTransition] = useState<TransitionPhase>("idle");
  const [completedAddons, setCompletedAddons] = useState<Partial<Record<ModuleSlug, AddonResult>>>({});
  const [pendingModulePurchase, setPendingModulePurchase] = useState<ModuleSlug | null>(null);

  const unlockRef = useRef<HTMLButtonElement | null>(null);

  const currentQuestion = questions[step];
  const progress = ((step + 1) / questions.length) * 100;

  const scored = useMemo(() => scoreAnswers(answers), [answers]);
  const report = useMemo(() => generateFreeReport(scored), [scored]);
  const fullReport = useMemo(() => generateFullReport(scored), [scored]);

  const moduleConfig = selectedModule ? modulesBySlug[selectedModule] : null;
  const activeModuleQuestion = moduleConfig ? moduleConfig.questions[moduleStep] : null;

  const hasCompletedModule = (slug: ModuleSlug) => Boolean(completedAddons[slug]);
  const isAddonUnlocked = (slug: ModuleSlug) => unlockedAddons.includes(slug);

  const addonPriceLabel = unlocked ? "0,99 €" : "2,99 €";
  const greetingName = name.trim();

  const persistBaseState = (nextAnswers: Record<number, OptionLabel>) => {
    try {
      localStorage.setItem(LS_LAST_BASE_ANSWERS, JSON.stringify(nextAnswers));
      localStorage.setItem(LS_LAST_BASE_REPORT_FREE, JSON.stringify(generateFreeReport(scoreAnswers(nextAnswers))));
      localStorage.setItem(LS_LAST_BASE_REPORT_FULL, JSON.stringify(generateFullReport(scoreAnswers(nextAnswers))));
      localStorage.setItem(LS_LAST_RUN_AT, String(Date.now()));
      if (email.trim()) localStorage.setItem(LS_EMAIL, email.trim());
      if (name.trim()) localStorage.setItem(LS_NAME, name.trim());
      localStorage.setItem(LS_CONSENT, consent ? "true" : "false");
    } catch {}
  };

  useEffect(() => {
    try {
      const full = localStorage.getItem(LS_UNLOCKED_FULL) === "true";
      setUnlocked(full);

      const rawAddons = localStorage.getItem(LS_UNLOCKED_ADDONS);
      if (rawAddons) {
        const parsed = JSON.parse(rawAddons);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((item): item is ModuleSlug => item in modulesBySlug);
          setUnlockedAddons(filtered);
        }
      }

      const storedEmail = localStorage.getItem(LS_EMAIL);
      const storedName = localStorage.getItem(LS_NAME);
      const storedConsent = localStorage.getItem(LS_CONSENT) === "true";
      if (storedEmail) setEmail(storedEmail);
      if (storedName) setName(storedName);
      setConsent(storedConsent);

      const rawAnswers = localStorage.getItem(LS_LAST_BASE_ANSWERS);
      if (rawAnswers) {
        const parsed = JSON.parse(rawAnswers) as Record<string, OptionLabel>;
        const normalized: Record<number, OptionLabel> = {};
        for (const [k, v] of Object.entries(parsed)) {
          const key = Number(k);
          if (Number.isFinite(key) && (v === "A" || v === "B" || v === "C")) normalized[key] = v;
        }

        if (Object.keys(normalized).length >= questions.length) {
          setAnswers(normalized);
          setStep(questions.length - 1);
          setPhase("result");
        }
      }

      if (localStorage.getItem(LS_PREMIUM_PRICE_WARNING) === "true") {
        setBillingMessage("0,99 € cena pre Plus modul nie je nakonfigurovaná, použila sa základná cena 2,99 €.");
        localStorage.removeItem(LS_PREMIUM_PRICE_WARNING);
      }
    } catch {}

    const params = new URLSearchParams(window.location.search);
    if (params.get("canceled") === "1") {
      setBillingMessage("Platba bola zrušená. Môžeš to skúsiť znova.");
    }

    const sessionId = params.get("session_id");
    if (!sessionId) return;

    const verify = async () => {
      try {
        const res = await fetch("/api/stripe/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json();

        if (data?.ok && data?.kind === "full") {
          setUnlocked(true);
          localStorage.setItem(LS_UNLOCKED_FULL, "true");
          if (typeof data?.name === "string" && data.name.trim()) {
            localStorage.setItem(LS_NAME, data.name.trim());
            setName(data.name.trim());
          }
          setBillingMessage("Platba prebehla úspešne. Hlbší profil je odomknutý.");
        } else if (data?.ok && data?.kind === "addon" && typeof data?.moduleSlug === "string" && data.moduleSlug in modulesBySlug) {
          const slug = data.moduleSlug as ModuleSlug;
          setUnlockedAddons((prev) => {
            const next = prev.includes(slug) ? prev : [...prev, slug];
            localStorage.setItem(LS_UNLOCKED_ADDONS, JSON.stringify(next));
            return next;
          });
          setBillingMessage(`Platba prebehla úspešne. Modul „${modulesBySlug[slug].title}“ je odomknutý.`);
          setPendingModulePurchase(null);
        } else {
          setBillingMessage("Overenie platby sa nepodarilo. Skús obnoviť stránku.");
        }

        const rawAnswers = localStorage.getItem(LS_LAST_BASE_ANSWERS);
        if (rawAnswers) {
          const parsed = JSON.parse(rawAnswers) as Record<string, OptionLabel>;
          const normalized: Record<number, OptionLabel> = {};
          for (const [k, v] of Object.entries(parsed)) {
            const key = Number(k);
            if (Number.isFinite(key) && (v === "A" || v === "B" || v === "C")) normalized[key] = v;
          }
          if (Object.keys(normalized).length >= questions.length) {
            setAnswers(normalized);
            setStep(questions.length - 1);
            setPhase("result");
          }
        }
      } catch {
        setBillingMessage("Overenie platby zlyhalo. Skús to prosím znova.");
      } finally {
        localStorage.removeItem(LS_PENDING_PURCHASE);
        const clean = new URL(window.location.href);
        clean.searchParams.delete("session_id");
        window.history.replaceState({}, "", clean.toString());
      }
    };

    void verify();
  }, []);

  useEffect(() => {
    if (phase === "result") persistBaseState(answers);
  }, [phase, answers]);

  const openPaymentModal = (intent: PurchaseIntent) => {
    setPurchaseIntent(intent);
    setShowPaymentModal(true);
  };

  const startCheckout = async () => {
    if (!purchaseIntent) return;
    if (!email.trim()) {
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

      persistBaseState(answers);
      localStorage.setItem(LS_EMAIL, email.trim());
      if (name.trim()) localStorage.setItem(LS_NAME, name.trim());
      localStorage.setItem(LS_CONSENT, "true");
      localStorage.setItem(
        LS_PENDING_PURCHASE,
        JSON.stringify({
          ...purchaseIntent,
          email: email.trim(),
          name: name.trim(),
          timestamp: Date.now(),
        }),
      );

      const isPremium = purchaseIntent.kind === "addon" ? unlocked : false;

      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: purchaseIntent.kind,
          moduleSlug: purchaseIntent.moduleSlug,
          email: email.trim(),
          name: name.trim(),
          isPremium,
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
    const next = { ...answers, [questionId]: label };
    setAnswers(next);
    setTransitionPhase("transitioning");

    window.setTimeout(() => {
      if (step >= questions.length - 1) {
        setPhase("analyzing");
        setTransitionPhase("idle");
        window.setTimeout(() => setPhase("result"), 2000);
        return;
      }

      setStep((prev) => prev + 1);
      setTransitionPhase("idle");
    }, 420);
  };

  const startModule = (slug: ModuleSlug) => {
    const module = modulesBySlug[slug];

    if (!module.isFree && !unlocked && !isAddonUnlocked(slug)) {
      setModuleNotice("Tento modul je dostupný po odomknutí detailnej analýzy.");
      setPendingModulePurchase(slug);
      unlockRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      unlockRef.current?.focus();
      return;
    }

    if (!module.isFree && !isAddonUnlocked(slug)) {
      setPendingModulePurchase(slug);
      setModuleNotice("Tento modul je Plus. Odomkni ho a pokračuj v otázkach.");
      return;
    }

    setPendingModulePurchase(null);
    setModuleNotice(null);
    setSelectedModule(slug);
    setModuleAnswers({});
    setModuleStep(0);
    setModuleTransition("idle");
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

  const resetModule = () => {
    setSelectedModule(null);
    setModuleAnswers({});
    setModuleStep(0);
    setModuleNotice(null);
    setModuleTransition("idle");
    setPendingModulePurchase(null);
  };

  if (phase === "analyzing") {
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

  if (phase === "result") {
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

          <article className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur-sm md:p-8">
            <h2 className="text-xl font-semibold">Detailná analýza (Full Report)</h2>
            <div className="relative mt-5 overflow-hidden rounded-xl border border-slate-100 bg-slate-50 p-5 md:p-6">
              <div className={unlocked ? "" : "pointer-events-none select-none blur-[3px]"}>
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
                      {fullReport.sevenDayPlan.map((item) => (
                        <li key={item.day}><span className="font-medium">Deň {item.day}:</span> {item.text}</li>
                      ))}
                    </ol>
                  </section>
                </div>
              </div>

              {!unlocked && (
                <>
                  <div className="pointer-events-none absolute inset-0 bg-white/30" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white via-white/90 to-transparent" />
                </>
              )}
            </div>

            <div className="mt-6 flex justify-center">
              <button
                ref={unlockRef}
                type="button"
                onClick={() => (!unlocked ? openPaymentModal({ kind: "full" }) : undefined)}
                disabled={unlocked || isPaying}
                className={`inline-flex items-center rounded-full px-6 py-3 text-sm font-medium transition ${
                  unlocked ? "cursor-default bg-emerald-100 text-emerald-700" : "bg-slate-900 text-white hover:bg-slate-800"
                } disabled:opacity-80`}
              >
                {unlocked ? "Hlbší profil odomknutý" : "Chcem hlbší profil"}
              </button>
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur-sm md:p-8">
            <h2 className="text-xl font-semibold">Spresniť analýzu podľa kontextu</h2>
            <p className="mt-2 text-slate-600">Vyber si modul pre doplnkový mini-report.</p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {modules.map((module) => (
                <button
                  key={module.slug}
                  type="button"
                  onClick={() => startModule(module.slug)}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-400"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="font-medium text-slate-900">{module.title}</h3>
                    <div className="flex items-center gap-2">
                      {hasCompletedModule(module.slug) && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Hotovo</span>}
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${module.isFree ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                        {module.isFree ? "Skús zdarma" : "Plus"}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600">{module.description}</p>
                </button>
              ))}
            </div>

            {moduleNotice && <p className="mt-4 text-sm text-amber-700">{moduleNotice}</p>}

            {pendingModulePurchase && !isAddonUnlocked(pendingModulePurchase) && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => openPaymentModal({ kind: "addon", moduleSlug: pendingModulePurchase })}
                  disabled={isPaying}
                  className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70"
                >
                  Odomknúť tento modul ({addonPriceLabel})
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
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => onModuleSelect(activeModuleQuestion.id, option.label)}
                      className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-400 hover:bg-slate-50"
                    >
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
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Insight</p>
                          <p className="mt-1 text-sm">{addon.insight}</p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Rizikové miesto</p>
                          <p className="mt-1 text-sm">{addon.riskSpot}</p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">Odporúčaný krok</p>
                          <p className="mt-1 text-sm">{addon.action}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedModule && (
              <button
                type="button"
                onClick={resetModule}
                className="mt-5 inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
              >
                Vybrať iný modul
              </button>
            )}
          </article>
        </section>

        <div className="mt-10">
          <Link href="/" className="inline-flex items-center rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
            Späť na úvod
          </Link>
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
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                    placeholder="tvoj@email.sk"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Meno (voliteľné)</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                    placeholder="Ako ťa môžeme osloviť"
                  />
                </div>
                <label className="flex items-start gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-1"
                  />
                  <span>Súhlasím s podmienkami a ochranou súkromia.</span>
                </label>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(false)}
                  className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Zavrieť
                </button>
                <button
                  type="button"
                  onClick={() => void startCheckout()}
                  disabled={isPaying}
                  className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-70"
                >
                  {purchaseIntent.kind === "full"
                    ? "Pokračovať na platbu 4,99 €"
                    : `Pokračovať na platbu ${addonPriceLabel}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

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
