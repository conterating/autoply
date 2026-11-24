export type AtsName = "greenhouse" | "lever" | "ashby";

export type Submission = {
  id: string;
  ats: AtsName;
  board: string;
  jobId: string;
  fields: Record<string, string | string[]>;
  files: Record<string, { filename: string; size: number; contentType: string }>;
  at: string;
};

export type Parsed = Pick<Submission, "fields" | "files">;

export type Reply = { status: number; type?: string; body: string };

export type Ctx = {
  method: string;
  path: string;
  query: URLSearchParams;
  origin: string;
  /** Parsed POST body, null for non-POST requests. */
  form: Parsed | null;
  record(s: { ats: AtsName; board: string; jobId: string; parsed: Parsed }): Submission;
};

/** A server-side required-field rule. `when` makes it conditional on another field's value. */
export type Rule = { name: string; label: string; file?: boolean; when?: { name: string; value: string } };

export function fieldValue(form: Parsed, name: string): string {
  const v = form.fields[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export function validate(form: Parsed, rules: Rule[]): string[] {
  const errors: string[] = [];
  for (const r of rules) {
    if (r.when && fieldValue(form, r.when.name) !== r.when.value) continue;
    const ok = r.file ? (form.files[r.name]?.size ?? 0) > 0 : fieldValue(form, r.name) !== "";
    if (!ok) errors.push(`${r.label} is required`);
  }
  return errors;
}
