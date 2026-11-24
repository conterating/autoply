"use client";

import type { OnboardingStepId, StepPatch } from "@autoply/core";
import { ONBOARDING_STEPS } from "@autoply/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveStep } from "@/app/actions/profile";

export type FormMode = "wizard" | "profile";

export function useStepForm(step: OnboardingStepId, mode: FormMode) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function submit(patch: StepPatch) {
    setError(null);
    start(async () => {
      const res = await saveStep(step, patch, mode === "wizard");
      if (res.ok) {
        setIssues({});
        setSavedAt(Date.now());
        if (mode === "wizard") {
          const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1];
          router.push(`/onboarding/${next ?? "review"}`);
        } else {
          router.refresh();
        }
      } else {
        setIssues(Object.fromEntries((res.issues ?? []).map((i) => [i.path, i.message])));
        setError(res.error ?? (res.issues?.length ? "Fix the highlighted fields and save again." : "Couldn’t save."));
      }
    });
  }

  /** Error for a field path; matches nested paths like "experience.0.company" by prefix. */
  function issue(path: string) {
    return issues[path] ?? Object.entries(issues).find(([k]) => k.startsWith(`${path}.`))?.[1];
  }

  /** Spread on the <form>: editing clears the stale errors from the last save attempt. */
  const formProps = {
    onChange: () => {
      if (Object.keys(issues).length || error) {
        setIssues({});
        setError(null);
      }
    },
  };

  return { submit, pending, issue, error, savedAt, formProps };
}
