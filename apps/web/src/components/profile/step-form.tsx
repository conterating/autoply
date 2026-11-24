"use client";

import type { OnboardingStepId, Profile } from "@autoply/core";
import { EducationForm, ExperienceForm } from "./history-forms";
import { IdentityForm } from "./identity-form";
import { AuthorizationForm, EeoForm, ScreeningForm } from "./legal-forms";
import { PreferencesForm, VoiceForm } from "./preference-forms";
import { SkillsForm } from "./skills-form";
import type { FormMode } from "./use-step-form";

export function StepForm({ step, profile, mode, backHref }: { step: OnboardingStepId; profile: Profile; mode: FormMode; backHref?: string }) {
  const props = { profile, mode, backHref };
  switch (step) {
    case "identity":
      return <IdentityForm {...props} />;
    case "experience":
      return <ExperienceForm {...props} />;
    case "education":
      return <EducationForm {...props} />;
    case "skills":
      return <SkillsForm {...props} />;
    case "authorization":
      return <AuthorizationForm {...props} />;
    case "preferences":
      return <PreferencesForm {...props} />;
    case "eeo":
      return <EeoForm {...props} />;
    case "screening":
      return <ScreeningForm {...props} />;
    case "voice":
      return <VoiceForm {...props} />;
    default:
      return null;
  }
}
