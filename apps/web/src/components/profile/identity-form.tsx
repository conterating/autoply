"use client";

import type { Profile } from "@autoply/core";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Section } from "@/components/ui/field";
import { FormFooter } from "./form-footer";
import { useStepForm, type FormMode } from "./use-step-form";

type F = { value: unknown; confirmedByUser: boolean };
const str = (f: F) => (typeof f.value === "string" ? f.value : "");
const suggested = (f: F) => !f.confirmedByUser && f.value !== null && f.value !== "";

const IDENTITY = [
  { key: "legalFirstName", label: "Legal first name", required: true, auto: "given-name" },
  { key: "legalMiddleName", label: "Legal middle name", auto: "additional-name" },
  { key: "legalLastName", label: "Legal last name", required: true, auto: "family-name" },
  { key: "preferredName", label: "Preferred name", hint: "Used where forms ask what you go by." },
  { key: "pronouns", label: "Pronouns", hint: "Only entered where a form asks." },
] as const;

const CONTACT = [
  { key: "email", label: "Email", required: true, type: "email", auto: "email" },
  { key: "phoneCountryCode", label: "Country code", hint: "e.g. +1", auto: "tel-country-code" },
  { key: "phoneNumber", label: "Phone number", required: true, type: "tel", auto: "tel-national" },
] as const;

const ADDRESS = [
  { key: "addressLine1", label: "Street address", auto: "address-line1", wide: true },
  { key: "addressLine2", label: "Apartment, suite, etc.", auto: "address-line2", wide: true },
  { key: "city", label: "City", auto: "address-level2" },
  { key: "state", label: "State / province", auto: "address-level1" },
  { key: "postalCode", label: "ZIP / postal code", auto: "postal-code" },
  { key: "country", label: "Country", auto: "country-name" },
] as const;

const LINKS = [
  { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/in/…" },
  { key: "github", label: "GitHub", placeholder: "https://github.com/…" },
  { key: "portfolio", label: "Portfolio", placeholder: "https://…" },
  { key: "website", label: "Personal site", placeholder: "https://…" },
] as const;

export function IdentityForm({ profile, mode, backHref }: { profile: Profile; mode: FormMode; backHref?: string }) {
  const { submit, pending, issue, error, savedAt, formProps } = useStepForm("identity", mode);
  const ident = profile.identity as unknown as Record<string, F>;
  const links = profile.links as unknown as Record<string, F>;
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(Object.entries(ident).map(([k, f]) => [k, str(f)])),
    ...Object.fromEntries(LINKS.map(({ key }) => [`links.${key}`, str(links[key]!)])),
  }));
  const [other, setOther] = useState(profile.links.other.value ?? []);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit({
      identity: Object.fromEntries(Object.keys(ident).map((k) => [k, values[k] ?? ""])),
      links: {
        ...Object.fromEntries(LINKS.map(({ key }) => [key, values[`links.${key}`] ?? ""])),
        other: other.filter((o) => o.label.trim() && o.url.trim()),
      },
    });
  }

  const text = (
    section: "identity" | "links",
    f: { key: string; label: string; required?: boolean; hint?: string; type?: string; auto?: string; placeholder?: string; wide?: boolean },
  ) => {
    const k = section === "identity" ? f.key : `links.${f.key}`;
    const src = section === "identity" ? ident[f.key]! : links[f.key]!;
    return (
      <Field
        key={k}
        label={f.label}
        required={f.required}
        hint={f.hint}
        error={issue(`${section}.${f.key}`)}
        suggested={suggested(src)}
        className={f.wide ? "sm:col-span-2" : undefined}
      >
        {(p) => (
          <Input {...p} type={f.type ?? (section === "links" ? "url" : "text")} autoComplete={f.auto} placeholder={f.placeholder} value={values[k] ?? ""} onChange={set(k)} />
        )}
      </Field>
    );
  };

  return (
    <form {...formProps} onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
      <Section title="Name" description="Use your legal name exactly as it appears on ID. Background checks match against it.">
        <div className="grid gap-4 sm:grid-cols-3">{IDENTITY.map((f) => text("identity", f))}</div>
      </Section>
      <Section title="Contact">
        <div className="grid gap-4 sm:grid-cols-[2fr_8.5rem_2fr]">{CONTACT.map((f) => text("identity", f))}</div>
      </Section>
      <Section title="Address" description="Many forms ask for at least your city and state. A full address is only entered where required.">
        <div className="grid gap-4 sm:grid-cols-2">{ADDRESS.map((f) => text("identity", f))}</div>
      </Section>
      <Section title="Links">
        <div className="grid gap-4 sm:grid-cols-2">{LINKS.map((f) => text("links", f))}</div>
        {other.map((o, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
            <Field label="Link label">
              {(p) => <Input {...p} value={o.label} onChange={(e) => setOther(other.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />}
            </Field>
            <Field label="URL" error={issue(`links.other.${i}`)}>
              {(p) => <Input {...p} type="url" value={o.url} onChange={(e) => setOther(other.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />}
            </Field>
            <Button type="button" variant="ghost" aria-label={`Remove link ${o.label || i + 1}`} onClick={() => setOther(other.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" size="sm" onClick={() => setOther([...other, { label: "", url: "" }])}>
            <Plus aria-hidden /> Add another link
          </Button>
        </div>
      </Section>
      <FormFooter mode={mode} pending={pending} error={error} savedAt={savedAt} backHref={backHref} />
    </form>
  );
}
