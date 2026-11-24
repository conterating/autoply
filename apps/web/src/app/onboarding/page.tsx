import { getProfile } from "@autoply/core/db";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

/** Resumes setup where the user left off. */
export default function OnboardingIndex() {
  const p = getProfile(db());
  if (p.onboarding.completedAt) redirect("/");
  redirect(`/onboarding/${p.onboarding.currentStep}`);
}
