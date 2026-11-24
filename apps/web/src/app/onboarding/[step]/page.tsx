import { ONBOARDING_STEPS, StepIdSchema, type OnboardingStepId } from "@autoply/core";
import { getProfile } from "@autoply/core/db";
import { Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResumeUpload } from "@/components/profile/resume-upload";
import { ReviewSummary } from "@/components/profile/review-summary";
import { StepForm } from "@/components/profile/step-form";
import { STEP_META } from "@/components/profile/steps-meta";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  const parsed = StepIdSchema.safeParse(step);
  return { title: parsed.success ? `Set up: ${STEP_META[parsed.data].short}` : "Set up" };
}

export default async function OnboardingStepPage({ params }: { params: Promise<{ step: string }> }) {
  const parsed = StepIdSchema.safeParse((await params).step);
  if (!parsed.success) notFound();
  const step = parsed.data;
  const profile = getProfile(db());
  const idx = ONBOARDING_STEPS.indexOf(step);
  const prev = ONBOARDING_STEPS[idx - 1];
  const next = ONBOARDING_STEPS[idx + 1];
  const done = new Set(profile.onboarding.completedSteps);
  const reachable = (s: OnboardingStepId) => done.has(s) || s === profile.onboarding.currentStep || s === step;
  const meta = STEP_META[step];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 gap-10 px-6 py-8">
      <nav aria-label="Setup steps" className="hidden w-52 shrink-0 md:block">
        <ol className="sticky top-8 flex flex-col">
          {ONBOARDING_STEPS.map((s, i) => {
            const current = s === step;
            const complete = done.has(s);
            const content = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full border font-mono text-2xs tabular",
                    complete ? "border-carbon bg-carbon text-carbon-ink" : current ? "border-carbon text-carbon" : "border-ink-3 text-ink-3",
                  )}
                >
                  {complete ? <Check className="size-3" /> : i + 1}
                </span>
                <span>{STEP_META[s].short}</span>
                {complete && <span className="sr-only">(done)</span>}
              </>
            );
            const cls = cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px]",
              current ? "bg-surface font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)]" : "text-ink-2",
            );
            return (
              <li key={s}>
                {reachable(s) && !current ? (
                  <Link href={`/onboarding/${s}`} className={cn(cls, "hover:bg-surface-2 hover:text-ink")}>
                    {content}
                  </Link>
                ) : (
                  <span className={cn(cls, !reachable(s) && "text-ink-3")} aria-current={current ? "step" : undefined}>
                    {content}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="min-w-0 max-w-3xl flex-1">
        <p className="font-mono text-2xs tracking-wide text-ink-3 uppercase">
          Step {idx + 1} of {ONBOARDING_STEPS.length}
        </p>
        <h1 className="mt-1 font-display-wide text-2xl font-semibold">{meta.title}</h1>
        <p className="mt-1 mb-8 max-w-prose text-[13px] text-ink-2">{meta.description}</p>

        {step === "resume" ? (
          <ResumeUpload onboarding next={`/onboarding/${next}`} />
        ) : step === "review" ? (
          <ReviewSummary profile={profile} />
        ) : (
          <StepForm step={step} profile={profile} mode="wizard" backHref={prev ? `/onboarding/${prev}` : undefined} />
        )}
      </main>
    </div>
  );
}
