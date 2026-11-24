import "server-only";
import { listApplicationAnswers, schema, type Db } from "@autoply/core/db";
import { asc, eq } from "drizzle-orm";

export function getApplicationView(db: Db, id: number) {
  const { applications: a, postings: p, documents, applicationEvents: ev } = schema;
  const row = db
    .select({ application: a, posting: p })
    .from(a)
    .innerJoin(p, eq(p.id, a.postingId))
    .where(eq(a.id, id))
    .get();
  if (!row) return null;
  const resume = row.application.resumeDocumentId
    ? (db.select({ id: documents.id, label: documents.label, filename: documents.filename }).from(documents).where(eq(documents.id, row.application.resumeDocumentId)).get() ?? null)
    : null;
  return {
    application: row.application,
    posting: row.posting,
    resume,
    answers: listApplicationAnswers(db, id),
    events: db.select().from(ev).where(eq(ev.applicationId, id)).orderBy(asc(ev.at), asc(ev.id)).all(),
  };
}
