import { EmptyState, PageHeader } from "@/components/shell/page-header";

export const metadata = { title: "Answer bank" };

export default function Page() {
  return (
    <>
      <PageHeader title="Answer bank" />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <EmptyState title="No saved answers yet">Answers you give in Needs input are saved here and reused whenever the same question comes up.</EmptyState>
      </div>
    </>
  );
}
