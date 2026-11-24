"use client";

import { DegreeLevel, type Education, type Experience, type Profile } from "@autoply/core";
import { useState } from "react";
import { Field, Input, Section, Select, Textarea } from "@/components/ui/field";
import { FormFooter } from "./form-footer";
import { ListEditor, monthLabel, newId } from "./list-editor";
import { useStepForm, type FormMode } from "./use-step-form";

const DEGREE_LABELS: Record<(typeof DegreeLevel.options)[number], string> = {
  high_school: "High school",
  associate: "Associate",
  bachelor: "Bachelor’s",
  master: "Master’s",
  mba: "MBA",
  phd: "PhD",
  jd: "JD",
  md: "MD",
  certificate: "Certificate",
  bootcamp: "Bootcamp",
  other: "Other",
};

function range(start: string | null, end: string | null, current: boolean, expected = false) {
  const s = monthLabel(start);
  const e = current ? "Present" : monthLabel(end) + (expected && end ? " (expected)" : "");
  return [s, e].filter(Boolean).join(" – ");
}

export function ExperienceForm({ profile, mode, backHref }: { profile: Profile; mode: FormMode; backHref?: string }) {
  const { submit, pending, issue, error, savedAt } = useStepForm("experience", mode);
  const [items, setItems] = useState<Experience[]>(profile.experience);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit({ experience: items.map((i) => ({ ...i, bullets: i.bullets.map((b) => b.trim()).filter(Boolean) })) });
      }}
    >
      <Section
        title="Work experience"
        description="Every job Autoply may mention. Cover letters and answers can only cite what’s here, so keep bullets accurate."
      >
        <ListEditor
          items={items}
          onChange={setItems}
          title={(i) => [i.title, i.company].filter(Boolean).join(" · ")}
          subtitle={(i) => [range(i.startDate, i.endDate, i.current), i.location].filter(Boolean).join(" · ")}
          create={() => ({ id: newId(), company: "", title: "", location: "", startDate: null, endDate: null, current: false, bullets: [], confirmedByUser: false })}
          addLabel="Add a job"
          empty="No jobs yet. Add internships, part-time and research roles too."
          hasError={(i) => Boolean(issue(`experience.${i}`))}
          render={(item, update, i) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Job title" required error={issue(`experience.${i}.title`)}>
                {(p) => <Input {...p} value={item.title} onChange={(e) => update({ title: e.target.value })} />}
              </Field>
              <Field label="Company" required error={issue(`experience.${i}.company`)}>
                {(p) => <Input {...p} value={item.company} onChange={(e) => update({ company: e.target.value })} />}
              </Field>
              <Field label="Location">{(p) => <Input {...p} value={item.location} onChange={(e) => update({ location: e.target.value })} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start" error={issue(`experience.${i}.startDate`)}>
                  {(p) => <Input {...p} type="month" value={item.startDate ?? ""} onChange={(e) => update({ startDate: e.target.value || null })} />}
                </Field>
                <Field label="End" error={issue(`experience.${i}.endDate`)}>
                  {(p) => (
                    <Input {...p} type="month" disabled={item.current} value={item.current ? "" : (item.endDate ?? "")} onChange={(e) => update({ endDate: e.target.value || null })} />
                  )}
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-ink-2 sm:col-span-2">
                <input type="checkbox" checked={item.current} onChange={(e) => update({ current: e.target.checked, endDate: e.target.checked ? null : item.endDate })} className="size-4 accent-[var(--carbon)]" />
                I currently work here
              </label>
              <Field label="What you did" hint="One bullet per line." className="sm:col-span-2">
                {(p) => <Textarea {...p} rows={4} value={item.bullets.join("\n")} onChange={(e) => update({ bullets: e.target.value.split("\n") })} />}
              </Field>
            </div>
          )}
        />
      </Section>
      <FormFooter mode={mode} pending={pending} error={error} savedAt={savedAt} backHref={backHref} />
    </form>
  );
}

export function EducationForm({ profile, mode, backHref }: { profile: Profile; mode: FormMode; backHref?: string }) {
  const { submit, pending, issue, error, savedAt } = useStepForm("education", mode);
  const [items, setItems] = useState<Education[]>(profile.education);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit({ education: items.map((i) => ({ ...i, honors: i.honors.map((h) => h.trim()).filter(Boolean) })) });
      }}
    >
      <Section title="Education">
        <ListEditor
          items={items}
          onChange={setItems}
          title={(i) => i.school}
          subtitle={(i) => [i.degree || (i.degreeLevel ? DEGREE_LABELS[i.degreeLevel] : ""), range(i.startDate, i.graduationDate, false, i.graduationExpected)].filter(Boolean).join(" · ")}
          create={() => ({
            id: newId(),
            school: "",
            degreeLevel: null,
            degree: "",
            major: "",
            minor: "",
            gpa: null,
            gpaScale: 4,
            startDate: null,
            graduationDate: null,
            graduationExpected: false,
            honors: [],
            confirmedByUser: false,
          })}
          addLabel="Add a school"
          empty="No schools yet."
          hasError={(i) => Boolean(issue(`education.${i}`))}
          render={(item, update, i) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="School" required error={issue(`education.${i}.school`)} className="sm:col-span-2">
                {(p) => <Input {...p} value={item.school} onChange={(e) => update({ school: e.target.value })} />}
              </Field>
              <Field label="Degree level">
                {(p) => (
                  <Select {...p} value={item.degreeLevel ?? ""} onChange={(e) => update({ degreeLevel: (e.target.value || null) as Education["degreeLevel"] })}>
                    <option value="">Choose…</option>
                    {DegreeLevel.options.map((d) => (
                      <option key={d} value={d}>
                        {DEGREE_LABELS[d]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Degree name" hint="As written on your diploma, e.g. B.S. Computer Science">
                {(p) => <Input {...p} value={item.degree} onChange={(e) => update({ degree: e.target.value })} />}
              </Field>
              <Field label="Major">{(p) => <Input {...p} value={item.major} onChange={(e) => update({ major: e.target.value })} />}</Field>
              <Field label="Minor">{(p) => <Input {...p} value={item.minor} onChange={(e) => update({ minor: e.target.value })} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="GPA" error={issue(`education.${i}.gpa`)}>
                  {(p) => (
                    <Input {...p} inputMode="decimal" value={item.gpa ?? ""} onChange={(e) => update({ gpa: e.target.value === "" ? null : Number(e.target.value) })} />
                  )}
                </Field>
                <Field label="Out of">
                  {(p) => <Input {...p} inputMode="decimal" value={item.gpaScale} onChange={(e) => update({ gpaScale: Number(e.target.value) || 4 })} />}
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start">{(p) => <Input {...p} type="month" value={item.startDate ?? ""} onChange={(e) => update({ startDate: e.target.value || null })} />}</Field>
                <Field label="Graduation">
                  {(p) => <Input {...p} type="month" value={item.graduationDate ?? ""} onChange={(e) => update({ graduationDate: e.target.value || null })} />}
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-ink-2 sm:col-span-2">
                <input type="checkbox" checked={item.graduationExpected} onChange={(e) => update({ graduationExpected: e.target.checked })} className="size-4 accent-[var(--carbon)]" />
                Graduation date is expected (not yet graduated)
              </label>
              <Field label="Honors and awards" hint="One per line." className="sm:col-span-2">
                {(p) => <Textarea {...p} rows={2} value={item.honors.join("\n")} onChange={(e) => update({ honors: e.target.value.split("\n") })} />}
              </Field>
            </div>
          )}
        />
      </Section>
      <FormFooter mode={mode} pending={pending} error={error} savedAt={savedAt} backHref={backHref} />
    </form>
  );
}
