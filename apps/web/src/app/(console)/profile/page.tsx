import { StepIdSchema, type OnboardingStepId, type Profile } from "@autoply/core";
import { getProfile } from "@autoply/core/db";
import { listDocuments } from "@autoply/core/documents";
import Link from "next/link";
import { DocumentsPanel } from "@/components/profile/documents-panel";
import { StepForm } from "@/components/profile/step-form";
import { STEP_META } from "@/components/profile/steps-meta";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";

export const metadata = { title: "Profile" };

const SECTIONS: (OnboardingStepId | "documents")[] = [
  "documents",
  "identity",
  "experience",
  "education",
  "skills",
  "authorization",
  "preferences",
  "eeo",
  "screening",
  "voice",
];

/** Number of values parsed from a resume that the user hasn't confirmed yet, per section. */
function unconfirmed(p: Profile, s: OnboardingStepId | "documents"): number {
  const scalar = (o: object) => Object.values(o).filter((f: { value: unknown; confirmedByUser: boolean }) => !f.confirmedByUser && f.value !== null && !(Array.isArray(f.value) && !f.value.length)).length;
  switch (s) {
    case "identity":
      return scalar(p.identity) + scalar(p.links);
    case "experience":
      return p.experience.filter((e) => !e.confirmedByUser).length;
    case "education":
      return p.education.filter((e) => !e.confirmedByUser).length;
    case "skills":
      return (p.skills.confirmedByUser || !p.skills.value?.length ? 0 : 1) + [...p.languages, ...p.certifications, ...p.projects, ...p.publications].filter((x) => !x.confirmedByUser).length;
    default:
      return 0;
  }
}

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section: raw } = await searchParams;
  const d = db();
  const profile = getProfile(d);
  const section: OnboardingStepId | "documents" = raw === "documents" ? "documents" : (StepIdSchema.safeParse(raw).data ?? "identity");
  const started = profile.onboarding.completedSteps.length > 0;

  if (!started) {
    return (
      <>
        <PageHeader title="Profile" />
        <div className="mx-auto max-w-5xl px-6 py-6">
          <EmptyState
            title="No profile yet"
            action={
              <Button asChild variant="primary">
                <Link href="/onboarding">Start setup</Link>
              </Button>
            }
          >
            Your profile is built from your resume during setup. You can edit every answer here afterwards.
          </EmptyState>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Profile" meta="Every answer Autoply gives on your behalf comes from here." />
      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-6">
        <nav aria-label="Profile sections" className="w-48 shrink-0">
          <ul className="sticky top-16 flex flex-col gap-px">
            {SECTIONS.map((s) => {
              const n = unconfirmed(profile, s);
              const label = s === "documents" ? "Documents" : STEP_META[s].short;
              return (
                <li key={s}>
                  <Link
                    href={`/profile?section=${s}`}
                    aria-current={section === s ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center justify-between rounded-md px-2 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink",
                      section === s && "bg-surface-2 font-medium text-ink",
                    )}
                  >
                    {label}
                    {n > 0 && (
                      <span className="rounded-full bg-carbon-soft px-1.5 font-mono text-2xs text-carbon tabular" title={`${n} unconfirmed from resume`}>
                        {n}
                        <span className="sr-only"> unconfirmed</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 max-w-3xl flex-1">
          <h2 className="mb-1 font-display-wide text-lg font-semibold">{section === "documents" ? "Documents" : STEP_META[section].title}</h2>
          <p className="mb-6 text-[13px] text-ink-2">
            {section === "documents" ? "Resume versions, transcripts and writing samples." : STEP_META[section].description}
          </p>
          {section === "documents" ? (
            <DocumentsPanel documents={listDocuments(d).map(({ extractedText: _t, ...doc }) => doc)} />
          ) : (
            // key forces fresh form state when switching sections
            <StepForm key={section} step={section} profile={profile} mode="profile" />
          )}
        </div>
      </div>
    </>
  );
}
