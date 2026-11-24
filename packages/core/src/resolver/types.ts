/** Form field shapes shared by the resolver and the ATS adapters. */
export type FieldType = "text" | "textarea" | "select" | "radio" | "checkbox" | "file" | "date" | "email" | "tel" | "number";

/** A form field as it appears on the page. */
export type FormField = {
  /** Stable id within the form (input name / id). */
  id: string;
  label: string;
  helpText?: string;
  type: FieldType;
  required: boolean;
  options?: { value: string; label: string }[];
  /** Multi-select checkboxes / multi selects. */
  multiple?: boolean;
  /** Page number in multi-page flows (0-based). */
  page?: number;
};

export type FieldAnswer =
  | { kind: "text"; value: string }
  | { kind: "option"; values: string[] }
  | { kind: "boolean"; value: boolean }
  | { kind: "file"; path: string; filename: string };
