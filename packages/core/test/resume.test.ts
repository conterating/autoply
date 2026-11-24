import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractText, sha256, sniffMimeType, DOCX, PDF } from "../src/documents/index.ts";
import { ReplayLlm, FakeLlm, ReplayMissError } from "../src/llm/index.ts";
import { emptyProfile, ProfileSchema } from "../src/profile/schema.ts";
import { heuristicParse, mergeParsedIntoProfile, parseResume, splitPhone, type ParsedResume } from "../src/resume/index.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "tests", "fixtures");
const pdfBytes = readFileSync(join(FIXTURES, "resumes", "sample-resume.pdf"));
const docxBytes = readFileSync(join(FIXTURES, "resumes", "sample-resume.docx"));

describe("document extraction", () => {
  it("sniffs PDF and DOCX by content", () => {
    expect(sniffMimeType("x.pdf", pdfBytes)).toBe(PDF);
    expect(sniffMimeType("x.docx", docxBytes)).toBe(DOCX);
    expect(sniffMimeType("x.exe", Buffer.from("MZ...."))).toBeNull();
  });

  it("extracts text from the PDF", async () => {
    const text = await extractText(pdfBytes, PDF);
    expect(text).toContain("Jordan Rivera");
    expect(text).toContain("jordan.rivera@example.com");
    expect(text).toContain("Northwind Labs");
  });

  it("extracts text from the DOCX", async () => {
    const text = await extractText(docxBytes, DOCX);
    expect(text).toContain("Jordan Rivera");
    expect(text).toContain("Teaching Assistant");
  });
});

describe("resume parsing", () => {
  it("replays the recorded parse for the sample PDF", async () => {
    const llm = new ReplayLlm(join(FIXTURES, "llm"));
    const parsed = await parseResume(llm, { sha256: sha256(pdfBytes), mimeType: PDF, bytes: pdfBytes, text: "" });
    expect(parsed.firstName).toBe("Jordan");
    expect(parsed.experience).toHaveLength(2);
  });

  it("fails loudly when a recording is missing", async () => {
    const llm = new ReplayLlm(join(FIXTURES, "llm"));
    await expect(parseResume(llm, { sha256: "nope", mimeType: PDF, text: "" })).rejects.toBeInstanceOf(ReplayMissError);
  });

  it("validates replayed output against the schema", async () => {
    const llm = new FakeLlm({ parse_resume: () => ({ firstName: 42 }) });
    await expect(parseResume(llm, { sha256: "x", mimeType: PDF, text: "" })).rejects.toThrow();
  });

  it("finds contact details heuristically without an LLM", async () => {
    const text = await extractText(pdfBytes, PDF);
    const p = heuristicParse(text);
    expect(p).toMatchObject({
      firstName: "Jordan",
      lastName: "Rivera",
      email: "jordan.rivera@example.com",
      linkedin: "https://linkedin.com/in/jordan-rivera-dev",
      github: "https://github.com/jrivera-dev",
    });
    expect(p.phone).toContain("555");
  });

  it.each([
    ["+1 (555) 010-4477", "+1", "(555) 010-4477"],
    ["+44 20 7946 0958", "+44", "20 7946 0958"],
    ["(555) 010-4477", null, "(555) 010-4477"],
  ])("splits phone %s", (raw, cc, num) => {
    expect(splitPhone(raw)).toEqual({ countryCode: cc, number: num });
  });
});

describe("mergeParsedIntoProfile", () => {
  async function sample(): Promise<ParsedResume> {
    const llm = new ReplayLlm(join(FIXTURES, "llm"));
    return parseResume(llm, { sha256: sha256(pdfBytes), mimeType: PDF, bytes: pdfBytes, text: "" });
  }

  it("adds parsed values as unconfirmed suggestions and produces a valid profile", async () => {
    const p = mergeParsedIntoProfile(emptyProfile(), await sample());
    expect(ProfileSchema.safeParse(p).success).toBe(true);
    expect(p.identity.legalFirstName).toEqual({ value: "Jordan", confirmedByUser: false });
    expect(p.identity.phoneCountryCode).toEqual({ value: "+1", confirmedByUser: false });
    expect(p.experience.map((e) => e.confirmedByUser)).toEqual([false, false]);
    expect(p.experience[1]).toMatchObject({ current: true, endDate: null });
    expect(p.education[0]).toMatchObject({ gpa: 3.7, graduationExpected: true, minor: "Mathematics" });
  });

  it("never overwrites a confirmed value", async () => {
    const base = emptyProfile();
    base.identity.legalFirstName = { value: "Jo", confirmedByUser: true };
    const p = mergeParsedIntoProfile(base, await sample());
    expect(p.identity.legalFirstName).toEqual({ value: "Jo", confirmedByUser: true });
  });

  it("never touches legal or EEO fields", async () => {
    const before = emptyProfile();
    const p = mergeParsedIntoProfile(before, await sample());
    expect(p.workAuthorization).toEqual(before.workAuthorization);
    expect(p.eeo).toEqual(before.eeo);
    expect(p.screening).toEqual(before.screening);
  });

  it("does not duplicate entries on re-upload", async () => {
    const parsed = await sample();
    const once = mergeParsedIntoProfile(emptyProfile(), parsed);
    const twice = mergeParsedIntoProfile(once, parsed);
    expect(twice.experience).toHaveLength(2);
    expect(twice.education).toHaveLength(1);
    expect(twice.languages).toHaveLength(2);
  });

  it("drops malformed dates and URLs instead of failing", () => {
    const parsed = heuristicParse("");
    parsed.experience = [{ company: "A", title: "B", location: null, startDate: "Summer 2024", endDate: "2024-13", current: false, bullets: [] }];
    parsed.projects = [{ name: "P", description: null, url: "not a url with spaces" }];
    const p = mergeParsedIntoProfile(emptyProfile(), parsed);
    expect(p.experience[0]).toMatchObject({ startDate: null, endDate: null });
    expect(ProfileSchema.safeParse(p).success).toBe(true);
  });
});
