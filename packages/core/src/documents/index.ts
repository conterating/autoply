import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { documents, type DOCUMENT_KINDS } from "../db/schema.ts";
import { ensureDataDirs } from "../paths.ts";

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const PDF = "application/pdf";
export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const ACCEPTED_RESUME_TYPES = [PDF, DOCX] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function sniffMimeType(filename: string, bytes: Uint8Array): string | null {
  // %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return PDF;
  // ZIP container + .docx extension
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && extname(filename).toLowerCase() === ".docx") return DOCX;
  if (extname(filename).toLowerCase() === ".txt") return "text/plain";
  return null;
}

export async function extractText(bytes: Uint8Array, mimeType: string): Promise<string> {
  if (mimeType === PDF) {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await pdfText(pdf, { mergePages: true });
    return normalizeWhitespace(text);
  }
  if (mimeType === DOCX) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return normalizeWhitespace(value);
  }
  return normalizeWhitespace(Buffer.from(bytes).toString("utf8"));
}

function normalizeWhitespace(s: string) {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Stores an uploaded file under ~/.autoply/documents and records it. */
export async function storeDocument(
  db: Db,
  input: { kind: DocumentKind; filename: string; bytes: Uint8Array; label?: string; makeDefault?: boolean },
) {
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("Files must be 10 MB or smaller.");
  const mimeType = sniffMimeType(input.filename, input.bytes);
  if (!mimeType) throw new Error("Upload a PDF or Word (.docx) file.");
  const hash = sha256(input.bytes);
  const ext = mimeType === PDF ? ".pdf" : mimeType === DOCX ? ".docx" : ".txt";
  const storedPath = `${hash}${ext}`;
  writeFileSync(join(ensureDataDirs().documents, storedPath), input.bytes, { mode: 0o600 });
  const extractedText = await extractText(input.bytes, mimeType);

  const isFirstOfKind = !db.select({ id: documents.id }).from(documents).where(eq(documents.kind, input.kind)).get();
  const makeDefault = input.makeDefault ?? isFirstOfKind;
  if (makeDefault) db.update(documents).set({ isDefault: false }).where(eq(documents.kind, input.kind)).run();

  return db
    .insert(documents)
    .values({
      kind: input.kind,
      label: input.label ?? input.filename.replace(/\.[^.]+$/, ""),
      filename: input.filename,
      storedPath,
      mimeType,
      sha256: hash,
      sizeBytes: input.bytes.byteLength,
      extractedText,
      isDefault: makeDefault,
    })
    .returning()
    .get();
}

export function documentPath(doc: { storedPath: string }) {
  return join(ensureDataDirs().documents, doc.storedPath);
}

export function readDocumentBytes(doc: { storedPath: string }) {
  return readFileSync(documentPath(doc));
}

export function listDocuments(db: Db) {
  return db.select().from(documents).orderBy(documents.kind, documents.id).all();
}

export function getDocument(db: Db, id: number) {
  return db.select().from(documents).where(eq(documents.id, id)).get() ?? null;
}

export function defaultResume(db: Db) {
  const all = db.select().from(documents).where(eq(documents.kind, "resume")).all();
  return all.find((d) => d.isDefault) ?? all[0] ?? null;
}

export function setDefaultDocument(db: Db, id: number) {
  const doc = getDocument(db, id);
  if (!doc) return;
  db.transaction((tx) => {
    tx.update(documents).set({ isDefault: false }).where(eq(documents.kind, doc.kind)).run();
    tx.update(documents).set({ isDefault: true }).where(eq(documents.id, id)).run();
  });
}

export function deleteDocument(db: Db, id: number) {
  const doc = getDocument(db, id);
  if (!doc) return;
  db.delete(documents).where(eq(documents.id, id)).run();
  const stillUsed = db.select().from(documents).where(eq(documents.storedPath, doc.storedPath)).get();
  if (!stillUsed) rmSync(documentPath(doc), { force: true });
  if (doc.isDefault) {
    const next = db.select().from(documents).where(eq(documents.kind, doc.kind)).get();
    if (next) setDefaultDocument(db, next.id);
  }
}
