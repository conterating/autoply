"use client";

import { LanguageProficiency, type Profile } from "@autoply/core";
import { useState } from "react";
import { Field, Input, Section, Select, TagInput, Textarea } from "@/components/ui/field";
import { FormFooter } from "./form-footer";
import { ListEditor, monthLabel, newId } from "./list-editor";
import { useStepForm, type FormMode } from "./use-step-form";

const PROFICIENCY: Record<(typeof LanguageProficiency.options)[number], string> = {
  elementary: "Elementary",
  limited_working: "Limited working",
  professional_working: "Professional working",
  full_professional: "Full professional",
  native: "Native or bilingual",
};

export function SkillsForm({ profile, mode, backHref }: { profile: Profile; mode: FormMode; backHref?: string }) {
  const { submit, pending, issue, error, savedAt } = useStepForm("skills", mode);
  const [skills, setSkills] = useState(profile.skills.value ?? []);
  const [languages, setLanguages] = useState(profile.languages);
  const [certs, setCerts] = useState(profile.certifications);
  const [projects, setProjects] = useState(profile.projects);
  const [pubs, setPubs] = useState(profile.publications);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit({ skills, languages, certifications: certs, projects, publications: pubs });
      }}
      className="flex flex-col gap-8"
    >
      <Section title="Skills" description="Languages, frameworks, tools. Press Enter or type a comma to add each one.">
        <Field label="Skills" suggested={!profile.skills.confirmedByUser && skills.length > 0}>
          {(p) => <TagInput {...p} value={skills} onChange={setSkills} placeholder="TypeScript, SQL, Figma…" />}
        </Field>
      </Section>

      <Section title="Languages">
        <ListEditor
          items={languages}
          onChange={setLanguages}
          title={(l) => l.language}
          subtitle={(l) => PROFICIENCY[l.proficiency]}
          create={() => ({ id: newId(), language: "", proficiency: "professional_working" as const, confirmedByUser: false })}
          addLabel="Add a language"
          empty="No languages added."
          hasError={(i) => Boolean(issue(`languages.${i}`))}
          render={(l, update, i) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Language" required error={issue(`languages.${i}.language`)}>
                {(p) => <Input {...p} value={l.language} onChange={(e) => update({ language: e.target.value })} />}
              </Field>
              <Field label="Proficiency">
                {(p) => (
                  <Select {...p} value={l.proficiency} onChange={(e) => update({ proficiency: e.target.value as typeof l.proficiency })}>
                    {LanguageProficiency.options.map((o) => (
                      <option key={o} value={o}>
                        {PROFICIENCY[o]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}
        />
      </Section>

      <Section title="Certifications">
        <ListEditor
          items={certs}
          onChange={setCerts}
          title={(c) => c.name}
          subtitle={(c) => [c.issuer, monthLabel(c.date)].filter(Boolean).join(" · ")}
          create={() => ({ id: newId(), name: "", issuer: "", date: null, confirmedByUser: false })}
          addLabel="Add a certification"
          empty="No certifications added."
          hasError={(i) => Boolean(issue(`certifications.${i}`))}
          render={(c, update, i) => (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" required error={issue(`certifications.${i}.name`)}>
                {(p) => <Input {...p} value={c.name} onChange={(e) => update({ name: e.target.value })} />}
              </Field>
              <Field label="Issuer">{(p) => <Input {...p} value={c.issuer} onChange={(e) => update({ issuer: e.target.value })} />}</Field>
              <Field label="Date">{(p) => <Input {...p} type="month" value={c.date ?? ""} onChange={(e) => update({ date: e.target.value || null })} />}</Field>
            </div>
          )}
        />
      </Section>

      <Section title="Projects">
        <ListEditor
          items={projects}
          onChange={setProjects}
          title={(x) => x.name}
          subtitle={(x) => x.url ?? ""}
          create={() => ({ id: newId(), name: "", description: "", url: null, skills: [], confirmedByUser: false })}
          addLabel="Add a project"
          empty="No projects added."
          hasError={(i) => Boolean(issue(`projects.${i}`))}
          render={(x, update, i) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={issue(`projects.${i}.name`)}>
                {(p) => <Input {...p} value={x.name} onChange={(e) => update({ name: e.target.value })} />}
              </Field>
              <Field label="URL" error={issue(`projects.${i}.url`)}>
                {(p) => <Input {...p} type="url" value={x.url ?? ""} onChange={(e) => update({ url: e.target.value || null })} />}
              </Field>
              <Field label="Description" className="sm:col-span-2">
                {(p) => <Textarea {...p} rows={2} value={x.description} onChange={(e) => update({ description: e.target.value })} />}
              </Field>
              <Field label="Skills used" className="sm:col-span-2">
                {(p) => <TagInput {...p} value={x.skills} onChange={(v) => update({ skills: v })} />}
              </Field>
            </div>
          )}
        />
      </Section>

      <Section title="Publications">
        <ListEditor
          items={pubs}
          onChange={setPubs}
          title={(x) => x.title}
          subtitle={(x) => [x.venue, monthLabel(x.date)].filter(Boolean).join(" · ")}
          create={() => ({ id: newId(), title: "", venue: "", date: null, url: null, confirmedByUser: false })}
          addLabel="Add a publication"
          empty="No publications added."
          hasError={(i) => Boolean(issue(`publications.${i}`))}
          render={(x, update, i) => (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" required error={issue(`publications.${i}.title`)} className="sm:col-span-2">
                {(p) => <Input {...p} value={x.title} onChange={(e) => update({ title: e.target.value })} />}
              </Field>
              <Field label="Venue">{(p) => <Input {...p} value={x.venue} onChange={(e) => update({ venue: e.target.value })} />}</Field>
              <Field label="Date">{(p) => <Input {...p} type="month" value={x.date ?? ""} onChange={(e) => update({ date: e.target.value || null })} />}</Field>
              <Field label="URL" error={issue(`publications.${i}.url`)} className="sm:col-span-2">
                {(p) => <Input {...p} type="url" value={x.url ?? ""} onChange={(e) => update({ url: e.target.value || null })} />}
              </Field>
            </div>
          )}
        />
      </Section>
      <FormFooter mode={mode} pending={pending} error={error} savedAt={savedAt} backHref={backHref} />
    </form>
  );
}
