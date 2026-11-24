"use client";

import {
  ClearanceLevel,
  type Gender,
  type RaceEthnicity,
  type SexualOrientation,
  type VeteranStatus,
  type YesNoDecline,
  type Profile,
} from "@autoply/core";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Choice, Field, Input, MultiChoice, Section, Select, TagInput, Textarea } from "@/components/ui/field";
import { FormFooter } from "./form-footer";
import { useStepForm, type FormMode } from "./use-step-form";

const YES_NO = [
  { value: true, label: "Yes" },
  { value: false, label: "No" },
] as const;

type Props = { profile: Profile; mode: FormMode; backHref?: string };

// ------------------------------------------------------------ work authorization

const CLEARANCE: Record<(typeof ClearanceLevel.options)[number], string> = {
  none: "None",
  public_trust: "Public Trust",
  confidential: "Confidential",
  secret: "Secret",
  top_secret: "Top Secret",
  ts_sci: "TS/SCI",
};

export function AuthorizationForm({ profile, mode, backHref }: Props) {
  const { submit, pending, issue, error, savedAt, formProps } = useStepForm("authorization", mode);
  const wa = profile.workAuthorization;
  const [countries, setCountries] = useState<{ country: string; authorized: boolean | null }[]>(
    wa.authorizedCountries.value?.length ? wa.authorizedCountries.value : [{ country: "US", authorized: null }],
  );
  const [now, setNow] = useState(wa.requiresSponsorshipNow.value);
  const [future, setFuture] = useState(wa.requiresSponsorshipFuture.value);
  const [visa, setVisa] = useState(wa.visaType.value ?? "");
  const [citizenship, setCitizenship] = useState(wa.citizenship.value ?? []);
  const [clearance, setClearance] = useState(wa.securityClearance.value ?? "");
  const [rowError, setRowError] = useState<string | null>(null);

  return (
    <form
      {...formProps}
      noValidate
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        const rows = countries.filter((c) => c.country.trim());
        if (rows.some((r) => r.authorized === null)) {
          setRowError("Answer yes or no for every country, or remove it.");
          return;
        }
        setRowError(null);
        submit({
          workAuthorization: {
            authorizedCountries: rows.map((r) => ({ country: r.country.trim().toUpperCase(), authorized: r.authorized })),
            requiresSponsorshipNow: now,
            requiresSponsorshipFuture: future,
            visaType: visa,
            citizenship,
            securityClearance: clearance || null,
          },
        });
      }}
    >
      <Section
        title="Where you can work"
        description="Applications ask this as a yes/no legal statement. Autoply answers it only from what you confirm here."
      >
        <div className="flex flex-col gap-3">
          {countries.map((c, i) => (
            <div key={i} className="flex flex-wrap items-end gap-4">
              <Field label="Country code" hint="Two letters, e.g. US, CA, GB" className="w-32">
                {(p) => (
                  <Input
                    {...p}
                    maxLength={3}
                    value={c.country}
                    onChange={(e) => setCountries(countries.map((x, j) => (j === i ? { ...x, country: e.target.value } : x)))}
                  />
                )}
              </Field>
              <Choice
                name={`authorized-${i}`}
                legend={`Legally authorized to work in ${c.country.toUpperCase() || "this country"}?`}
                options={YES_NO}
                value={c.authorized}
                onChange={(v) => setCountries(countries.map((x, j) => (j === i ? { ...x, authorized: v } : x)))}
              />
              {countries.length > 1 && (
                <Button type="button" variant="ghost" aria-label={`Remove ${c.country || "country"}`} onClick={() => setCountries(countries.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden />
                </Button>
              )}
            </div>
          ))}
          {(rowError || issue("workAuthorization.authorizedCountries")) && (
            <p className="text-2xs font-medium text-bad">{rowError ?? issue("workAuthorization.authorizedCountries")}</p>
          )}
          <div>
            <Button type="button" size="sm" onClick={() => setCountries([...countries, { country: "", authorized: null }])}>
              <Plus aria-hidden /> Add a country
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Sponsorship">
        <Choice
          name="sponsor-now"
          legend="Do you now require visa sponsorship to work?"
          options={YES_NO}
          value={now}
          onChange={setNow}
          required
          error={issue("workAuthorization.requiresSponsorshipNow")}
        />
        <Choice
          name="sponsor-future"
          legend="Will you require sponsorship in the future (for example, H-1B after OPT)?"
          options={YES_NO}
          value={future}
          onChange={setFuture}
          required
          error={issue("workAuthorization.requiresSponsorshipFuture")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current visa or status" hint="e.g. F-1 OPT, H-1B, Green card. Leave blank if not applicable.">
            {(p) => <Input {...p} value={visa} onChange={(e) => setVisa(e.target.value)} />}
          </Field>
          <Field label="Citizenship" hint="Countries of citizenship. Only entered where a form asks.">
            {(p) => <TagInput {...p} value={citizenship} onChange={setCitizenship} placeholder="e.g. US" />}
          </Field>
        </div>
      </Section>

      <Section title="Security clearance">
        <Field label="Active clearance" className="max-w-xs">
          {(p) => (
            <Select {...p} value={clearance} onChange={(e) => setClearance(e.target.value as typeof clearance)}>
              <option value="">Not answered</option>
              {ClearanceLevel.options.map((c) => (
                <option key={c} value={c}>
                  {CLEARANCE[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Section>
      <FormFooter mode={mode} pending={pending} error={error} savedAt={savedAt} backHref={backHref} />
    </form>
  );
}

// ------------------------------------------------------------ voluntary self-identification

const DECLINE_LABEL = "Decline to answer";
const GENDER: Record<(typeof Gender.options)[number], string> = { male: "Man", female: "Woman", non_binary: "Non-binary", decline: DECLINE_LABEL };
const RACE: Record<(typeof RaceEthnicity.options)[number], string> = {
  american_indian_alaska_native: "American Indian or Alaska Native",
  asian: "Asian",
  black_african_american: "Black or African American",
  native_hawaiian_pacific_islander: "Native Hawaiian or Other Pacific Islander",
  white: "White",
  two_or_more: "Two or more races",
  decline: DECLINE_LABEL,
};
const YND: Record<(typeof YesNoDecline.options)[number], string> = { yes: "Yes", no: "No", decline: DECLINE_LABEL };
const VETERAN: Record<(typeof VeteranStatus.options)[number], string> = {
  protected_veteran: "I identify as a protected veteran",
  not_protected_veteran: "I am not a protected veteran",
  decline: DECLINE_LABEL,
};
const ORIENTATION: Record<(typeof SexualOrientation.options)[number], string> = {
  heterosexual: "Heterosexual / straight",
  gay: "Gay",
  lesbian: "Lesbian",
  bisexual: "Bisexual",
  queer: "Queer",
  asexual: "Asexual",
  pansexual: "Pansexual",
  other: "Other",
  decline: DECLINE_LABEL,
};

const opts = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

export function EeoForm({ profile, mode, backHref }: Props) {
  const { submit, pending, issue, error, savedAt, formProps } = useStepForm("eeo", mode);
  const e0 = profile.eeo;
  const [gender, setGender] = useState(e0.gender.value);
  const [race, setRace] = useState(e0.raceEthnicity.value ?? ["decline"]);
  const [hispanic, setHispanic] = useState(e0.hispanicLatino.value);
  const [veteran, setVeteran] = useState(e0.veteranStatus.value);
  const [disability, setDisability] = useState(e0.disabilityStatus.value);
  const [orientation, setOrientation] = useState(e0.sexualOrientation.value);
  const [trans, setTrans] = useState(e0.transgender.value);

  return (
    <form
      {...formProps}
      noValidate
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        submit({
          eeo: {
            gender,
            raceEthnicity: race.length ? race : ["decline"],
            hispanicLatino: hispanic,
            veteranStatus: veteran,
            disabilityStatus: disability,
            sexualOrientation: orientation,
            transgender: trans,
          },
        });
      }}
    >
      <Section
        title="Voluntary self-identification"
        description="US employers ask these for equal-opportunity reporting. They’re optional and can’t be used in hiring decisions. Each is set to “Decline to answer”; change any you want to share. Autoply enters exactly what you choose here, on every application."
      >
        <Choice name="gender" legend="Gender" options={opts(GENDER)} value={gender} onChange={setGender} error={issue("eeo.gender")} />
        <MultiChoice
          legend="Race / ethnicity"
          options={opts(RACE)}
          value={race}
          onChange={setRace}
          exclusive="decline"
          hint="Choose all that apply."
          error={issue("eeo.raceEthnicity")}
        />
        <Choice name="hispanic" legend="Hispanic or Latino" options={opts(YND)} value={hispanic} onChange={setHispanic} error={issue("eeo.hispanicLatino")} />
        <Choice
          name="veteran"
          legend="Veteran status"
          options={opts(VETERAN)}
          value={veteran}
          onChange={setVeteran}
          hint="Protected veterans include disabled veterans, recently separated veterans, active duty wartime or campaign badge veterans, and Armed Forces service medal veterans."
          error={issue("eeo.veteranStatus")}
        />
        <Choice name="disability" legend="Do you have a disability?" options={opts(YND)} value={disability} onChange={setDisability} error={issue("eeo.disabilityStatus")} />
        <Field label="Sexual orientation" className="max-w-xs" error={issue("eeo.sexualOrientation")}>
          {(p) => (
            <Select {...p} value={orientation ?? "decline"} onChange={(e) => setOrientation(e.target.value as typeof orientation)}>
              {opts(ORIENTATION).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Choice name="transgender" legend="Do you identify as transgender?" options={opts(YND)} value={trans} onChange={setTrans} error={issue("eeo.transgender")} />
      </Section>
      <FormFooter mode={mode} pending={pending} error={error} savedAt={savedAt} backHref={backHref} />
    </form>
  );
}

// ------------------------------------------------------------ screening

export function ScreeningForm({ profile, mode, backHref }: Props) {
  const { submit, pending, issue, error, savedAt, formProps } = useStepForm("screening", mode);
  const s = profile.screening;
  const [over18, setOver18] = useState(s.over18.value);
  const [convicted, setConvicted] = useState(s.hasCriminalConviction.value);
  const [explanation, setExplanation] = useState(s.criminalConvictionExplanation.value ?? "");
  const [prevEmployers, setPrevEmployers] = useState(s.previousEmployers.value ?? []);
  const [nonCompete, setNonCompete] = useState(s.hasNonCompete.value);
  const [nonCompeteDetails, setNonCompeteDetails] = useState(s.nonCompeteDetails.value ?? "");
  const [relatives, setRelatives] = useState(s.relativesAtCompanies.value ?? []);
  const [heard, setHeard] = useState(s.howDidYouHear.value ?? "");
  const [bg, setBg] = useState(s.willingBackgroundCheck.value);
  const [drug, setDrug] = useState(s.willingDrugTest.value);
  const [years, setYears] = useState(s.skillYears.value ?? []);
  const [attest, setAttest] = useState(s.acceptAttestations.value);

  return (
    <form
      {...formProps}
      noValidate
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        submit({
          screening: {
            over18,
            hasCriminalConviction: convicted,
            criminalConvictionExplanation: convicted ? explanation : "",
            previousEmployers: prevEmployers,
            hasNonCompete: nonCompete,
            nonCompeteDetails: nonCompete ? nonCompeteDetails : "",
            relativesAtCompanies: relatives,
            howDidYouHear: heard,
            willingBackgroundCheck: bg,
            willingDrugTest: drug,
            skillYears: years.filter((y) => y.skill.trim()),
            acceptAttestations: attest,
          },
        });
      }}
    >
      <Section title="Eligibility" description="Legal statements. Anything you leave blank is asked per application in Needs input, never guessed.">
        <Choice name="over18" legend="Are you 18 or older?" options={YES_NO} value={over18} onChange={setOver18} required error={issue("screening.over18")} />
        <Choice
          name="convicted"
          legend="Have you ever been convicted of a felony?"
          options={YES_NO}
          value={convicted}
          onChange={setConvicted}
          hint="Many states and cities bar employers from asking this. Autoply only answers where a form asks."
        />
        {convicted && (
          <Field label="Explanation, if a form asks for one">
            {(p) => <Textarea {...p} rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} />}
          </Field>
        )}
        <Choice name="bg" legend="Willing to undergo a background check?" options={YES_NO} value={bg} onChange={setBg} />
        <Choice name="drug" legend="Willing to take a drug test?" options={YES_NO} value={drug} onChange={setDrug} />
      </Section>

      <Section
        title="Attestations and signatures"
        description="Most forms end with “I certify the information above is true” or a privacy-policy consent, and some ask you to type your name as a signature."
      >
        <Choice
          name="attest"
          legend="Let Autoply accept these for you?"
          options={[
            { value: true, label: "Yes, accept them and sign with my legal name" },
            { value: false, label: "No, ask me each time" },
          ]}
          value={attest}
          onChange={setAttest}
          hint="Covers truthfulness certifications, privacy and data-processing consents, and e-signatures with your confirmed legal name. Anything else (for example arbitration agreements) is always asked in Needs input."
        />
      </Section>

      <Section title="Conflicts">
        <Choice name="noncompete" legend="Are you bound by a non-compete or non-solicitation agreement?" options={YES_NO} value={nonCompete} onChange={setNonCompete} />
        {nonCompete && (
          <Field label="Details">
            {(p) => <Textarea {...p} rows={2} value={nonCompeteDetails} onChange={(e) => setNonCompeteDetails(e.target.value)} />}
          </Field>
        )}
        <Field label="Companies you’ve worked for before" hint="Beyond your work history: contracts, agencies, short stints. Used for “Have you worked here before?”">
          {(p) => <TagInput {...p} value={prevEmployers} onChange={setPrevEmployers} />}
        </Field>
        <Field label="Companies where a relative works" hint="Used for “Do you have relatives employed here?”">
          {(p) => <TagInput {...p} value={relatives} onChange={setRelatives} />}
        </Field>
      </Section>

      <Section title="Common questions">
        <Field label="How did you hear about us?" hint="Default answer, e.g. “Company careers page”." className="max-w-md">
          {(p) => <Input {...p} value={heard} onChange={(e) => setHeard(e.target.value)} />}
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-xs font-medium text-ink-2">Years of experience by skill</legend>
          {years.map((y, i) => (
            <div key={i} className="flex items-end gap-3">
              <Field label="Skill" className="flex-1">
                {(p) => <Input {...p} value={y.skill} onChange={(e) => setYears(years.map((x, j) => (j === i ? { ...x, skill: e.target.value } : x)))} />}
              </Field>
              <Field label="Years" className="w-24" error={issue(`screening.skillYears.${i}`)}>
                {(p) => (
                  <Input {...p} inputMode="decimal" value={y.years} onChange={(e) => setYears(years.map((x, j) => (j === i ? { ...x, years: Number(e.target.value) || 0 } : x)))} />
                )}
              </Field>
              <Button type="button" variant="ghost" aria-label={`Remove ${y.skill || "skill"}`} onClick={() => setYears(years.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" size="sm" onClick={() => setYears([...years, { skill: "", years: 0 }])}>
              <Plus aria-hidden /> Add a skill
            </Button>
          </div>
        </fieldset>
      </Section>
      <FormFooter mode={mode} pending={pending} error={error} savedAt={savedAt} backHref={backHref} />
    </form>
  );
}
