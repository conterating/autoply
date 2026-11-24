/**
 * Generates the fictional sample resume used by tests, as PDF and DOCX.
 * Run: node scripts/make-sample-resume.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";

export const SAMPLE_LINES = [
  "Jordan Rivera",
  "jordan.rivera@example.com | +1 (555) 010-4477 | Austin, TX",
  "linkedin.com/in/jordan-rivera-dev | github.com/jrivera-dev",
  "",
  "EDUCATION",
  "University of Texas at Austin, B.S. Computer Science, Minor in Mathematics",
  "Expected May 2026. GPA 3.7/4.0. Dean's List (2023, 2024).",
  "",
  "EXPERIENCE",
  "Software Engineer Intern, Northwind Labs, Austin, TX (May 2025 - Aug 2025)",
  "- Built a TypeScript service that cut report generation time from 40s to 6s.",
  "- Added integration tests for the billing API, raising coverage from 52% to 81%.",
  "Teaching Assistant, UT Austin Department of Computer Science (Jan 2024 - Present)",
  "- Lead weekly lab sections of 30 students for Data Structures.",
  "",
  "PROJECTS",
  "Trailhead - Route planner for hikers built with React and PostgreSQL. trailhead.example.com",
  "",
  "SKILLS",
  "TypeScript, Python, React, Node.js, PostgreSQL, Docker, Git",
  "",
  "LANGUAGES",
  "English (native), Spanish (professional working)",
];

const out = join(import.meta.dirname, "..", "tests", "fixtures", "resumes");
mkdirSync(out, { recursive: true });

const pdf = await PDFDocument.create();
// Fixed metadata so the file (and its sha256 replay key) is byte-for-byte reproducible.
const epoch = new Date("2026-01-01T00:00:00Z");
pdf.setCreationDate(epoch);
pdf.setModificationDate(epoch);
pdf.setProducer("autoply-fixtures");
pdf.setCreator("autoply-fixtures");
const page = pdf.addPage([612, 792]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
let y = 740;
for (const [i, line] of SAMPLE_LINES.entries()) {
  const isHeading = i === 0 || /^[A-Z ]+$/.test(line);
  page.drawText(line, { x: 56, y, size: i === 0 ? 18 : isHeading ? 11 : 10, font: isHeading ? bold : font });
  y -= i === 0 ? 24 : 15;
}
writeFileSync(join(out, "sample-resume.pdf"), await pdf.save({ useObjectStreams: false }));

const docx = new Document({
  creator: "autoply-fixtures",
  sections: [{ children: SAMPLE_LINES.map((l, i) => new Paragraph({ children: [new TextRun({ text: l, bold: i === 0 })] })) }],
});
writeFileSync(join(out, "sample-resume.docx"), await Packer.toBuffer(docx));
console.log(`Wrote sample resumes to ${out}`);
