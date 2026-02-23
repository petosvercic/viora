"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { scoreAnswers, type OptionLabel, questions } from "../lib/decisionModel";
import { generateModuleAddon } from "../lib/moduleAddonGen";
import { scoreModuleAnswers } from "../lib/moduleScoring";
import { modules, modulesBySlug, type ModuleOptionLabel, type ModuleSlug } from "../lib/modules";
import { generateFreeReport, generateFullReport } from "../lib/reportGen";

type Phase = "questions" | "analyzing" | "result";

export default function ProfilePage() {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>("questions");
  const [answers, setAnswers] = useState<Record<number, OptionLabel>>({});
  const [unlocked, setUnlocked] = useState(false);

  const [selectedModule, setSelectedModule] = useState<ModuleSlug | null>(null);
  const [moduleStep, setModuleStep] = useState(0);
  const [moduleAnswers, setModuleAnswers] = useState<Record<number, ModuleOptionLabel>>({});
  const [moduleDone, setModuleDone] = useState(false);
  const [moduleNotice, setModuleNotice] = useState<string | null>(null);

  const unlockRef = useRef<HTMLButtonElement | null>(null);

  const currentQuestion = questions[step];
  const progress = ((step + 1) / questions.length) * 100;

  const scored = useMemo(() => scoreAnswers(answers), [answers]);
  const report = useMemo(() => generateFreeReport(scored), [scored]);
  const fullReport = useMemo(() => generateFullReport(scored), [scored]);

  const moduleConfig = selectedModule ? modulesBySlug[selectedModule] : null;
  const activeModuleQuestion = moduleConfig ? moduleConfig.questions[moduleStep] : null;

  const moduleScores = useMemo(() => {
    if (!selectedModule || !moduleDone) return null;
    return scoreModuleAnswers(selectedModule, moduleAnswers);
  }, [selectedModule, moduleDone, moduleAnswers]);

  const moduleAddon = useMemo(() => {
    if (!selectedModule || !moduleScores) return null;
    return generateModuleAddon(selectedModule, scored, moduleScores);
  }, [selectedModule, moduleScores, scored]);

  const onSelect = (questionId: number, label: OptionLabel) => {
    const next = { ...answers, [questionId]: label };
    setAnswers(next);

    if (step >= questions.length - 1) {
      setPhase("analyzing");
      window.setTimeout(() => setPhase("result"), 2000);
      return;
    }

    setStep((prev) => prev + 1);
  };

  const startModule = (slug: ModuleSlug) => {
    const module = modulesBySlug[slug];

    if (!module.isFree && !unlocked) {
      setModuleNotice("Tento modul je dostupný po odomknutí detailnej analýzy.");
      unlockRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      unlockRef.current?.focus();
      return;
    }

    setModuleNotice(null);
    setSelectedModule(slug);
    setModuleAnswers({});
    setModuleStep(0);
    setModuleDone(false);
  };

  const onModuleSelect = (questionId: number, label: ModuleOptionLabel) => {
    const next = { ...moduleAnswers, [questionId]: label };
    setModuleAnswers(next);

    if (!moduleConfig) return;

    if (moduleStep >= moduleConfig.questions.length - 1) {
      setModuleDone(true);
      return;
    }

    setModuleStep((prev) => prev + 1);
  };

  const resetModule = () => {
    setSelectedModule(null);
    setModuleAnswers({});
    setModuleStep(0);
    setModuleDone(false);
    setModuleNotice(null);
  };

  if (phase === "analyzing") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-6 py-20 text-center">
        <div className="space-y-6">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
          <h1 className="text-2xl font-semibold">Analyzujeme tvoje odpovede…</h1>
          <p className="text-slate-600">Pripravujeme tvoj bezplatný rozhodovací report.</p>
        </div>
      </main>
    );
  }

  if (phase === "result") {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-14 md:py-20">
        <div className="mb-10 space-y-3">
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">Viora Decision Profile</p>
          <h1 className="text-3xl font-semibold md:text-4xl">Tvoj bezplatný report</h1>
        </div>

        <section className="space-y-8">
          <article className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
            <h2 className="text-xl font-semibold">Tvoj rozhodovací podpis</h2>
            <div className="mt-4 whitespace-pre-line text-slate-700">{report.signature}</div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
            <h2 className="text-xl font-semibold">Rizikové miesto</h2>
            <div className="mt-4 whitespace-pre-line text-slate-700">{report.riskSpot}</div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
            <h2 className="text-xl font-semibold">Jeden optimalizačný zásah</h2>
            <div className="mt-4 whitespace-pre-line text-slate-700">{report.intervention}</div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
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
                onClick={() => setUnlocked((prev) => !prev)}
                className="inline-flex items-center rounded-full bg-slate-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Odomknúť detailnú analýzu
              </button>
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
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
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${module.isFree ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`}>
                      {module.isFree ? "Zadarmo" : "Premium"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">{module.description}</p>
                </button>
              ))}
            </div>

            {moduleNotice && <p className="mt-4 text-sm text-amber-700">{moduleNotice}</p>}

            {selectedModule && moduleConfig && !moduleDone && activeModuleQuestion && (
              <div className="mt-8 rounded-xl border border-slate-200 p-5">
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

            {selectedModule && moduleDone && moduleAddon && (
              <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="text-lg font-semibold">{moduleAddon.title}</h3>
                <div className="mt-4 space-y-4 text-slate-700">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Insight</p>
                    <p className="mt-1 text-sm">{moduleAddon.insight}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Rizikové miesto</p>
                    <p className="mt-1 text-sm">{moduleAddon.riskSpot}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Odporúčaný krok</p>
                    <p className="mt-1 text-sm">{moduleAddon.action}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={resetModule}
                  className="mt-5 inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
                >
                  Vybrať iný modul
                </button>
              </div>
            )}
          </article>
        </section>

        <div className="mt-10">
          <Link href="/" className="inline-flex items-center rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
            Späť na úvod
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14 md:py-20">
      <div className="mb-8 space-y-3">
        <p className="text-sm font-medium text-slate-500">Otázka {step + 1} / {questions.length}</p>
        <div className="h-1.5 w-full rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-slate-900 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="space-y-8">
        <h1 className="text-2xl font-semibold leading-snug md:text-3xl">{currentQuestion.question}</h1>
        <div className="grid gap-4">
          {currentQuestion.options.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => onSelect(currentQuestion.id, option.label)}
              className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:border-slate-400 hover:bg-slate-50"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Možnosť {option.label}</p>
              <p className="mt-2 text-base text-slate-900 md:text-lg">{option.text}</p>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
