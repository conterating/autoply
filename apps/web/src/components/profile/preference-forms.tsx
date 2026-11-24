"use client";

import { type EmploymentType, type Seniority, type WorkplaceType, type Profile } from "@autoply/core";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Choice, Field, Input, MultiChoice, Section, TagInput, Textarea } from "@/components/ui/field";
import { FormFooter } from "./form-footer";
import { useStepForm, type FormMode } from "./use-step-form";

type Props = { profile: Profile; mode: FormMode; backHref?: string };

const SENIORITY: Record<(typeof Seniority.options)[number], string> = {
  intern: "Internship",
  entry: "Entry level / new grad",
  mid: "Mid level",
  senior: "Senior",
  staff: "Staff",
  principal: "Principal",
  manager: "Manager",
  director: "Director",
};
const WORKPLACE: Record<(typeof WorkplaceType.options)[number], string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
const EMPLOYMENT: Record<(typeof EmploymentType.options)[number], string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  temporary: "Temporary",
};
const opts = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[,$\s]/g, "")));

export function PreferencesForm({ profile, mode, backHref }: Props) {
  const { submit, pending, issue, error, savedAt, formProps } = useStepForm("preferences", mode);
  const p0 = profile.preferences;
  const [titles, setTitles] = useState(p0.targetTitles.value ?? []);
  const [seniority, setSeniority] = useState(p0.seniority.value ?? []);
  const [locations, setLocations] = useState(p0.locations.value ?? []);
  const [workplace, setWorkplace] = useState(p0.workplaceTypes.value ?? []);
  const [relocate, setRelocate] = useState(p0.willingToRelocate.value);
  const [minSalary, setMinSalary] = useState(p0.minimumSalary.value?.toString() ?? "");
  const [desired, setDesired] = useState(p0.desiredSalary.value?.toString() ?? "");
  const [currency, setCurrency] = useState(p0.salaryCurrency.value ?? "USD");
  const [start, setStart] = useState(p0.earliestStartDate.value ?? "");
  const [notice, setNotice] = useState(p0.noticePeriodWeeks.value?.toString() ?? "");
  const [employment, setEmployment] = useState(p0.employmentTypes.value ?? []);
  const [exCompanies, setExCompanies] = useState(p0.excludedCompanies.value ?? []);
  const [exKeywords, setExKeywords] = useState(p0.excludedKeywords.value ?? []);

  return (
    <form
      {...formProps}
      noValidate
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        submit({
          preferences: {
            targetTitles: titles,
            seniority,
            locations,
            workplaceTypes: workplace,
            willingToRelocate: relocate,
            minimumSalary: num(minSalary),
            desiredSalary: num(desired),
            salaryCurrency: currency.toUpperCase(),
            earliestStartDate: start,
            noticePeriodWeeks: num(notice),
            employmentTypes: employment,
            excludedCompanies: exCompanies,
            excludedKeywords: exKeywords,
          },
        });
      }}
    >
      <Section title="What you’re looking for" description="Autoply only applies to postings that pass these filters.">
        <Field label="Job titles" hint="Titles to search for, e.g. Software Engineer, Backend Engineer." error={issue("preferences.targetTitles")}>
          {(p) => <TagInput {...p} value={titles} onChange={setTitles} />}
        </Field>
        <MultiChoice legend="Seniority" options={opts(SENIORITY)} value={seniority} onChange={setSeniority} />
        <MultiChoice legend="Employment type" options={opts(EMPLOYMENT)} value={employment} onChange={setEmployment} />
      </Section>

      <Section title="Location">
        <MultiChoice legend="Workplace" options={opts(WORKPLACE)} value={workplace} onChange={setWorkplace} />
        <Field label="Locations" hint="Cities or regions, e.g. Austin, TX; New York, NY; United States." error={issue("preferences.locations")}>
          {(p) => <TagInput {...p} value={locations} onChange={setLocations} />}
        </Field>
        <Choice
          name="relocate"
          legend="Willing to relocate?"
          options={[
            { value: true, label: "Yes" },
            { value: false, label: "No" },
          ]}
          value={relocate}
          onChange={setRelocate}
        />
      </Section>

      <Section title="Compensation and timing" description="Used to filter postings and to answer salary and start-date questions.">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_6rem]">
          <Field label="Minimum salary" hint="Postings below this are skipped." error={issue("preferences.minimumSalary")}>
            {(p) => <Input {...p} inputMode="numeric" value={minSalary} onChange={(e) => setMinSalary(e.target.value)} />}
          </Field>
          <Field label="Desired salary" hint="Entered where a form asks for your expectation." error={issue("preferences.desiredSalary")}>
            {(p) => <Input {...p} inputMode="numeric" value={desired} onChange={(e) => setDesired(e.target.value)} />}
          </Field>
          <Field label="Currency" error={issue("preferences.salaryCurrency")}>
            {(p) => <Input {...p} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} />}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Earliest start date" error={issue("preferences.earliestStartDate")}>
            {(p) => <Input {...p} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}
          </Field>
          <Field label="Notice period (weeks)" error={issue("preferences.noticePeriodWeeks")}>
            {(p) => <Input {...p} inputMode="numeric" value={notice} onChange={(e) => setNotice(e.target.value)} />}
          </Field>
        </div>
      </Section>

      <Section title="Exclusions">
        <Field label="Never apply to these companies">{(p) => <TagInput {...p} value={exCompanies} onChange={setExCompanies} />}</Field>
        <Field label="Skip postings mentioning" hint="e.g. Senior, Clearance required, Unpaid">
          {(p) => <TagInput {...p} value={exKeywords} onChange={setExKeywords} />}
        </Field>
      </Section>
      <FormFooter mode={mode} pending={pending} error={error} savedAt={savedAt} backHref={backHref} />
    </form>
  );
}

export function VoiceForm({ profile, mode, backHref }: Props) {
  const { submit, pending, issue, error, savedAt, formProps } = useStepForm("voice", mode);
  const [tone, setTone] = useState(profile.voice.tone.value ?? "");
  const [examples, setExamples] = useState(profile.voice.examples.value ?? []);

  return (
    <form
      {...formProps}
      noValidate
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        submit({ voice: { tone, examples: examples.map((x) => x.trim()).filter(Boolean) } });
      }}
    >
      <Section
        title="How your cover letters should sound"
        description="Two or three sentences. Cover letters only ever state facts from your profile; this controls the tone, not the content."
      >
        <Field label="Tone" error={issue("voice.tone")}>
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              maxLength={600}
              placeholder="Direct and specific. Lead with what I built and the result. No clichés like “I’m passionate about”."
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            />
          )}
        </Field>
      </Section>
      <Section title="Past cover letters" description="Optional. Paste letters you’ve written so new ones match your style.">
        {examples.map((x, i) => (
          <div key={i} className="flex items-start gap-2">
            <Field label={`Example ${i + 1}`} className="flex-1">
              {(p) => <Textarea {...p} rows={6} value={x} onChange={(e) => setExamples(examples.map((y, j) => (j === i ? e.target.value : y)))} />}
            </Field>
            <Button type="button" variant="ghost" className="mt-6" aria-label={`Remove example ${i + 1}`} onClick={() => setExamples(examples.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" size="sm" onClick={() => setExamples([...examples, ""])}>
            <Plus aria-hidden /> Add an example
          </Button>
        </div>
      </Section>
      <FormFooter mode={mode} pending={pending} error={error} savedAt={savedAt} backHref={backHref} />
    </form>
  );
}
