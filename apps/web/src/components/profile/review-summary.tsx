"use client";

import { ONBOARDING_STEPS, type OnboardingStepId, type Profile } from "@autoply/core";
import { ArrowRight, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { finishOnboarding } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import { STEP_META } from "./steps-meta";

const yn = (v: boolean | null) => (v === null ? "Not answered" : v ? "Yes" : "No");

function rows(p: Profile): Record<Exclude<OnboardingStepId, "review" | "resume">, [string, string][]> {
  const id = p.identity;
  const eeoShared = Object.values(p.eeo).filter((f) => {
    const v = Array.isArray(f.value) ? f.value : [f.value];
    return !v.includes("decline");
  }).length;
  return {
    identity: [
      ["Name", [id.legalFirstName.value, id.legalMiddleName.value, id.legalLastName.value].filter(Boolean).join(" ")],
      ["Email", id.email.value ?? ""],
      ["Phone", [id.phoneCountryCode.value, id.phoneNumber.value].filter(Boolean).join(" ")],
      ["Location", [id.city.value, id.state.value, id.country.value].filter(Boolean).join(", ")],
    ],
    experience: p.experience.length
      ? p.experience.map((e) => [e.company, e.title] as [string, string])
      : [["Jobs", "None added"]],
    education: p.education.length ? p.education.map((s) => [s.school, s.degree || s.major] as [string, string]) : [["Schools", "None added"]],
    skills: [
      ["Skills", `${p.skills.value?.length ?? 0}`],
      ["Languages", p.languages.map((l) => l.language).join(", ") || "None"],
    ],
    authorization: [
      [
        "Authorized to work",
        (p.workAuthorization.authorizedCountries.value ?? []).map((c) => `${c.country}: ${c.authorized ? "Yes" : "No"}`).join(", ") || "Not answered",
      ],
      ["Needs sponsorship now", yn(p.workAuthorization.requiresSponsorshipNow.value)],
      ["Needs sponsorship later", yn(p.workAuthorization.requiresSponsorshipFuture.value)],
    ],
    preferences: [
      ["Titles", p.preferences.targetTitles.value?.join(", ") || "Any"],
      ["Locations", p.preferences.locations.value?.join(", ") || "Any"],
      ["Workplace", p.preferences.workplaceTypes.value?.map((w) => ({ remote: "Remote", hybrid: "Hybrid", onsite: "On-site" })[w]).join(", ") || "Any"],
    ],
    eeo: [["Shared", eeoShared === 0 ? "Declining all" : `${eeoShared} of 7 answered, the rest declined`]],
    screening: [
      ["18 or older", yn(p.screening.over18.value)],
      ["Background check", yn(p.screening.willingBackgroundCheck.value)],
    ],
    voice: [["Tone", p.voice.tone.value || "Not set (a plain, direct default is used)"]],
  };
}

export function ReviewSummary({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = new Set(profile.onboarding.completedSteps);
  const missing = ONBOARDING_STEPS.filter((s) => s !== "review" && !done.has(s));
  const data = rows(profile);

  return (
    <div className="flex flex-col gap-6">
      {missing.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-3 text-[13px] text-ink">
          Finish these pages first:{" "}
          {missing.map((s, i) => (
            <span key={s}>
              {i > 0 && ", "}
              <Link href={`/onboarding/${s}`} className="font-medium text-warn underline underline-offset-2">
                {STEP_META[s].short}
              </Link>
            </span>
          ))}
        </div>
      )}

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {(Object.keys(data) as (keyof typeof data)[]).map((step) => (
          <li key={step} className="flex gap-6 px-5 py-4">
            <h2 className="w-36 shrink-0 text-[13px] font-medium text-ink">{STEP_META[step].short}</h2>
            <div className="min-w-0 flex-1">
              <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-1 text-[13px]">
                {data[step].map(([k, v], i) => (
                  <div key={i} className="contents">
                    <dt className="truncate text-ink-3">{k}</dt>
                    <dd className="truncate text-ink-2">{v || "—"}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <Link href={`/onboarding/${step}`} className="flex h-7 items-center gap-1 self-start rounded px-2 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink">
              <Pencil className="size-3" aria-hidden /> Edit <span className="sr-only">{STEP_META[step].short}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-4">
        <Button
          variant="primary"
          size="lg"
          disabled={pending || missing.length > 0}
          onClick={() =>
            start(async () => {
              const r = await finishOnboarding();
              if (r.ok) router.push("/");
              else setError("Some pages aren’t finished yet.");
            })
          }
        >
          Finish setup <ArrowRight aria-hidden />
        </Button>
        <p role="status" className="text-xs text-ink-3">
          {error ?? "Dry run stays on until you turn it off in Settings, so nothing is submitted yet."}
        </p>
      </div>
    </div>
  );
}
