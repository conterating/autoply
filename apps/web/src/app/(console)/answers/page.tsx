import { listAnswers } from "@autoply/core/db";
import { AnswerBankEditor } from "@/components/answers/answer-bank-editor";
import { PageHeader } from "@/components/shell/page-header";
import { db } from "@/lib/db";

export const metadata = { title: "Answer bank" };

export default function AnswersPage() {
  const answers = listAnswers(db()).map((a) => ({
    id: a.id,
    question: a.questionText,
    text: a.answer.text,
    timesUsed: a.timesUsed,
    updatedAt: a.updatedAt,
  }));
  return (
    <>
      <PageHeader title="Answer bank" meta={`${answers.length} saved ${answers.length === 1 ? "answer" : "answers"}`} />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <AnswerBankEditor answers={answers} />
      </div>
    </>
  );
}
