"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { generateFreeReport } from "../lib/reportGen";
import { questions, scoreAnswers, type OptionLabel } from "../lib/decisionModel";

type Phase = "questions" | "analyzing" | "result";

export default function ProfilePage() {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>("questions");
  const [answers, setAnswers] = useState<Record<number, OptionLabel>>({});

  const currentQuestion = questions[step];
  const progress = ((step + 1) / questions.length) * 100;

  const scored = useMemo(() => scoreAnswers(answers), [answers]);
  const report = useMemo(() => generateFreeReport(scored), [scored]);

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
        </section>

        <div className="mt-10">
          <Link
            href="/"
            className="inline-flex items-center rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Späť na úvod
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14 md:py-20">
      <div className="mb-8 space-y-3">
        <p className="text-sm font-medium text-slate-500">
          Otázka {step + 1} / {questions.length}
        </p>
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
