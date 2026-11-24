import { getProfile, getSettings, listAnswers, schema } from "@autoply/core/db";
import { getTableColumns } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Everything Autoply stores, as JSON. The Claude API key is never included. */
export function GET() {
  const d = db();
  const s = schema;
  const { extractedText, ...docCols } = getTableColumns(s.documents);
  void extractedText;
  const body = {
    exportedAt: new Date().toISOString(),
    profile: getProfile(d),
    settings: getSettings(d),
    answerBank: listAnswers(d),
    sources: d.select().from(s.sources).all(),
    documents: d.select(docCols).from(s.documents).all(),
    postings: d.select().from(s.postings).all(),
    applications: d.select().from(s.applications).all(),
    applicationAnswers: d.select().from(s.applicationAnswers).all(),
    applicationEvents: d.select().from(s.applicationEvents).all(),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="autoply-export-${stamp}.json"`,
      "cache-control": "no-store",
    },
  });
}
