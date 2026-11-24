import { pendingQuestions } from "@autoply/core/db";
import { NeedsInputQueue } from "@/components/needs-input/queue";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { db } from "@/lib/db";

export const metadata = { title: "Needs input" };
export const dynamic = "force-dynamic";

export default function NeedsInputPage() {
  const questions = pendingQuestions(db());
  const blocked = new Set(questions.map((q) => q.example.applicationId)).size;
  return (
    <>
      <PageHeader
        title="Needs input"
        meta={questions.length ? `${questions.length} ${questions.length === 1 ? "question" : "questions"} · answer once, reused everywhere` : undefined}
      />
      <div className="mx-auto max-w-3xl px-6 py-6">
        {questions.length === 0 ? (
          <EmptyState title="Nothing needs you right now">
            When a form asks something Autoply can’t answer from your profile, the question waits here. Answer it once and it’s saved for every future
            application.
          </EmptyState>
        ) : (
          <NeedsInputQueue questions={questions} blockedHint={blocked} />
        )}
      </div>
    </>
  );
}
